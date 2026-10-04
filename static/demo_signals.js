// demo_signals.js — synthetic SEEG for the demo (Wendling model + pink noise).
// Exposed as window.ConcordDemoSignals. Requires synth.js (window.ConcordSynth).

(function () {
    "use strict";

    var FS = 500;   // synth.js integrates at 10 kHz and decimates by round(10000/fs): 500 is exact
    var DURATION = 30;

    // Electrode layouts (MNI-approximate, mm). Contact 1 is deepest.
    var LAYOUTS = {
        "bilateral-amygdala": [
            { name: "LA1", x: -20, y: -4, z: -18 }, { name: "LA2", x: -27, y: -8, z: -13 }, { name: "LA3", x: -34, y: -12, z: -8 },
            { name: "RA1", x: 21, y: -3, z: -17 },  { name: "RA2", x: 28, y: 0, z: -12 },   { name: "RA3", x: 35, y: 3, z: -7 },
        ],
        "left-temporal": [
            { name: "LA1", x: -24, y: -5, z: -22 }, { name: "LA2", x: -26, y: -4, z: -20 }, { name: "LA3", x: -28, y: -4, z: -19 },
            { name: "LA4", x: -29, y: -3, z: -17 },
            { name: "LH1", x: -28, y: -22, z: -12 }, { name: "LH2", x: -32, y: -24, z: -9 }, { name: "LH3", x: -37, y: -25, z: -7 },
            { name: "LH4", x: -42, y: -26, z: -5 },
            { name: "LOF1", x: -18, y: 28, z: -18 }, { name: "LOF2", x: -22, y: 32, z: -15 }, { name: "LOF3", x: -26, y: 35, z: -12 },
        ],
        "bilateral-hippocampus": [
            { name: "LH1", x: -28, y: -22, z: -12 }, { name: "LH2", x: -32, y: -24, z: -9 }, { name: "LH3", x: -37, y: -25, z: -7 },
            { name: "RH1", x: 28, y: -21, z: -12 },  { name: "RH2", x: 32, y: -23, z: -9 },  { name: "RH3", x: 37, y: -24, z: -7 },
        ],
    };

    // ── Seeded PRNG + pink noise ───────────────────────────────────────────

    function Mulberry32(seed) { this.s = seed >>> 0; }
    Mulberry32.prototype.next = function () {
        var t = (this.s += 0x6D2B79F5) >>> 0;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    Mulberry32.prototype.nextGaussian = function () {
        var u, v;
        do { u = this.next(); v = this.next(); } while (u < 1e-10);
        return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    };

    // Paul Kellet's pink noise filter, scaled to targetRms.
    function pinkNoise(n, prng, targetRms) {
        var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        var out = new Float32Array(n);
        for (var i = 0; i < n; i++) {
            var w = prng.nextGaussian();
            b0 = 0.99886 * b0 + w * 0.0555179;
            b1 = 0.99332 * b1 + w * 0.0750759;
            b2 = 0.96900 * b2 + w * 0.1538520;
            b3 = 0.86650 * b3 + w * 0.3104856;
            b4 = 0.55000 * b4 + w * 0.5329522;
            b5 = -0.7616 * b5 - w * 0.0168980;
            out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
            b6 = w * 0.115926;
        }
        var rms = 0;
        for (var j = 0; j < n; j++) rms += out[j] * out[j];
        rms = Math.sqrt(rms / n);
        if (rms > 1e-10) {
            var s = targetRms / rms;
            for (var k = 0; k < n; k++) out[k] *= s;
        }
        return out;
    }

    // ── One channel ────────────────────────────────────────────────────────

    function meanOf(sig, a, b) {
        var m = 0;
        for (var i = a; i < b; i++) m += sig[i];
        return m / Math.max(b - a, 1);
    }

    // Simulate, zero-mean per regime segment, scale to ~50 µV background,
    // soft-clip, cap ictal amplitude, and add 1/f noise.
    function makeChannel(post, onset, seed) {
        var Synth = window.ConcordSynth;
        var targetRMS = 0.05e-3;
        var sig = Synth.simulateTransition(DURATION, FS, Synth.REGIMES.normal, Synth.REGIMES[post], onset, seed).signal;
        var sw = Math.round(onset * FS);
        var pre = Math.min(Math.max(sw, 1), sig.length);

        var preMean = meanOf(sig, 0, pre);
        var ictMean = pre < sig.length ? meanOf(sig, pre, sig.length) : preMean;
        var preRMS = 0;
        for (var i = 0; i < pre; i++) preRMS += (sig[i] - preMean) * (sig[i] - preMean);
        preRMS = Math.sqrt(preRMS / pre);
        if (preRMS < 1e-10) preRMS = 1;
        var scale = targetRMS / preRMS;

        var out = new Float32Array(sig.length);
        for (var a = 0; a < pre; a++) out[a] = (sig[a] - preMean) * scale;
        for (var b = pre; b < sig.length; b++) out[b] = (sig[b] - ictMean) * scale;

        var clip = targetRMS * 3.0;
        for (var c = 0; c < out.length; c++) out[c] = clip * Math.tanh(out[c] / clip);

        var ictLen = out.length - sw;
        if (ictLen > 0 && sw > 0) {
            var ictRMS = 0;
            for (var d = sw; d < out.length; d++) ictRMS += out[d] * out[d];
            ictRMS = Math.sqrt(ictRMS / ictLen);
            var maxRMS = targetRMS * 1.5;
            if (ictRMS > maxRMS) {
                var ictScale = maxRMS / ictRMS;
                for (var e = sw; e < out.length; e++) {
                    var t = Math.min((e - sw) / FS, 1.0);
                    out[e] *= 1.0 - t * (1.0 - ictScale);
                }
            }
        }

        var pink = pinkNoise(out.length, new Mulberry32(seed + 50000), targetRMS * 0.35);
        for (var f = 0; f < out.length; f++) out[f] += pink[f];
        return out;
    }

    // ── One recording ──────────────────────────────────────────────────────
    // spec: { layout, seed, task: "ictal"|"interictal", run, soz: [names], onset }

    function generate(spec) {
        var layout = LAYOUTS[spec.layout];
        var ictal = spec.task === "ictal";
        var runSeed = spec.seed * 1000 + parseInt(spec.run || "1", 10) * 100;
        var soz = {};
        spec.soz.forEach(function (n) { soz[n] = true; });

        var channels = layout.map(function (c, i) {
            var seizes = ictal && soz[c.name];
            return {
                name: c.name, x: c.x, y: c.y, z: c.z, soz: !!soz[c.name],
                data: makeChannel(seizes ? "spike_wave" : "normal", seizes ? spec.onset : 999, runSeed + i),
            };
        });
        var events = ictal ? [{ onset: spec.onset, label: "Seizure onset (" + spec.soz.join(", ") + ")" }] : [];
        return { fs: FS, duration: DURATION, channels: channels, events: events };
    }

    window.ConcordDemoSignals = { FS: FS, DURATION: DURATION, LAYOUTS: LAYOUTS, generate: generate };
})();
