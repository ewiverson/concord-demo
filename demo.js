// demo.js — Montage Concord demo mode (synthetic SEEG)
// Generates multi-channel Wendling model data on load, patches window.fetch
// to mock all /api/* endpoints. Requires synth.js, dsp.js, and fft.js.
// Must be loaded as a plain <script> BEFORE app.js (which is type="module").

(function () {
    "use strict";

    // ── Synthetic data generation ──────────────────────────────────────────

    var FS       = 512;
    var DURATION = 30;
    var N        = FS * DURATION;
    var SEED     = 42;

    // 6 channels across 2 electrode groups — mimics a typical SEEG layout.
    // LA = Left Amygdala, RA = Right Amygdala — common SEEG targets in temporal lobe epilepsy.
    // All channels show normal alpha background; LA2 transitions to LVFA seizure at t=10s.
    // MNI-approximate SEEG coordinates. LA enters from posterior-lateral temporal bone
    // aimed at amygdala (steep medial angle). RA enters from a slightly more anterior
    // lateral trajectory — trajectories are non-parallel to reflect realistic implant geometry.
    // Contact 1 deepest (amygdala body), contact 3 shallowest (temporal cortex).
    var CHANNEL_DEFS = [
        { name: "LA1", pre: "normal", post: "normal", onset: 999, seed: 42,  x: -20, y:  -4, z: -18, soz: false },
        { name: "LA2", pre: "normal", post: "spike_wave", onset: 10, seed: 43,  x: -27, y:  -8, z: -13, soz: true  },
        { name: "LA3", pre: "normal", post: "normal", onset: 999, seed: 44,  x: -34, y: -12, z:  -8, soz: false },
        { name: "RA1", pre: "normal", post: "normal", onset: 999, seed: 100, x:  21, y:  -3, z: -17, soz: false },
        { name: "RA2", pre: "normal", post: "normal", onset: 999, seed: 101, x:  28, y:   0, z: -12, soz: false },
        { name: "RA3", pre: "normal", post: "normal", onset: 999, seed: 102, x:  35, y:   3, z:  -7, soz: false },
    ];

    var CHANNELS = CHANNEL_DEFS.map(function (d) { return d.name; });

    var EVENTS = [
        { onset: 10, label: "Seizure onset (LA2)" },
    ];

    // Generate all channels
    var _rawData = null;
    function generateData() {
        if (_rawData) return _rawData;
        var Synth = window.ConcordSynth;
        var targetRMS = 0.05e-3; // 50 µV — typical SEEG background

        _rawData = CHANNEL_DEFS.map(function (def) {
            var result = Synth.simulateTransition(
                DURATION, FS,
                Synth.REGIMES[def.pre],
                Synth.REGIMES[def.post],
                def.onset,
                def.seed
            );
            var sig = result.signal;
            var switchSample = Math.round(def.onset * FS);
            var preSamples = Math.min(Math.max(switchSample, 1), sig.length);

            // Zero-mean per segment to eliminate DC shifts between regimes,
            // then scale so pre-seizure RMS = targetRMS (50 µV).
            var preMean = 0;
            for (var i = 0; i < preSamples; i++) preMean += sig[i];
            preMean /= preSamples;

            var ictMean = preMean; // default: same as pre (no seizure channels)
            if (preSamples < sig.length) {
                ictMean = 0;
                for (var i = preSamples; i < sig.length; i++) ictMean += sig[i];
                ictMean /= (sig.length - preSamples);
            }

            var preRMS = 0;
            for (var i = 0; i < preSamples; i++) preRMS += (sig[i] - preMean) * (sig[i] - preMean);
            preRMS = Math.sqrt(preRMS / preSamples);
            if (preRMS < 1e-10) preRMS = 1;

            var scale = targetRMS / preRMS;
            var out = new Float32Array(sig.length);
            for (var i = 0; i < preSamples; i++) out[i] = (sig[i] - preMean) * scale;
            for (var i = preSamples; i < sig.length; i++) out[i] = (sig[i] - ictMean) * scale;

            // Soft-clip to suppress rare large-amplitude transients.
            var clipThreshold = targetRMS * 3.0; // 150 µV
            for (var i = 0; i < out.length; i++) {
                out[i] = clipThreshold * Math.tanh(out[i] / clipThreshold);
            }

            // Cap ictal RMS: if it exceeds maxIctalFactor * targetRMS, rescale the
            // ictal portion down. Fade in over 1 s to avoid a hard discontinuity.
            var maxIctalFactor = 1.5;
            var ictStart = switchSample;
            var ictLen = out.length - ictStart;
            if (ictLen > 0 && ictStart > 0) {
                var ictRMS = 0;
                for (var i = ictStart; i < out.length; i++) ictRMS += out[i] * out[i];
                ictRMS = Math.sqrt(ictRMS / ictLen);
                var maxIctRMS = targetRMS * maxIctalFactor;
                if (ictRMS > maxIctRMS) {
                    var ictScale = maxIctRMS / ictRMS;
                    var fadeLen = Math.round(FS); // 1 s fade
                    for (var i = ictStart; i < out.length; i++) {
                        var t = Math.min((i - ictStart) / fadeLen, 1.0);
                        out[i] *= 1.0 - t * (1.0 - ictScale);
                    }
                }
            }

            // Add 1/f (pink) noise to simulate realistic background neural activity.
            var pinkRng = new Mulberry32(def.seed + 50000);
            var pink = generatePinkNoise(out.length, pinkRng, targetRMS * 0.35);
            for (var i = 0; i < out.length; i++) out[i] += pink[i];

            return out;
        });
        return _rawData;
    }

    // ── Seeded PRNG for pink noise (Mulberry32 — tiny, fast, seeded) ──────────

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

    // Paul Kellet's pink noise IIR filter (approximates 1/f spectrum).
    // Returns a Float32Array with the specified target RMS amplitude.
    function generatePinkNoise(n, prng, targetRms) {
        var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        var out = new Float32Array(n);
        for (var i = 0; i < n; i++) {
            var w = prng.nextGaussian();
            b0 = 0.99886 * b0 + w * 0.0555179;
            b1 = 0.99332 * b1 + w * 0.0750759;
            b2 = 0.96900 * b2 + w * 0.1538520;
            b3 = 0.86650 * b3 + w * 0.3104856;
            b4 = 0.55000 * b4 + w * 0.5329522;
            b5 = -0.7616  * b5 - w * 0.0168980;
            out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
            b6 = w * 0.115926;
        }
        var rms = 0;
        for (var i = 0; i < n; i++) rms += out[i] * out[i];
        rms = Math.sqrt(rms / n);
        if (rms > 1e-10) {
            var s = targetRms / rms;
            for (var i = 0; i < n; i++) out[i] *= s;
        }
        return out;
    }

    // Channel metadata
    var CHANNEL_META = {};
    CHANNEL_DEFS.forEach(function (d) {
        CHANNEL_META[d.name] = {
            status: "good",
            status_description: d.soz ? "soz" : null,
            x: d.x, y: d.y, z: d.z,
        };
    });

    // ── Montage state & helpers ────────────────────────────────────────────

    var _montage = "monopolar";
    var _notchMode = "none";

    function getBipolarPairs() {
        var groups = {};
        for (var i = 0; i < CHANNELS.length; i++) {
            var ch = CHANNELS[i];
            var prefix = ch.replace(/\d+$/, "");
            if (!groups[prefix]) groups[prefix] = [];
            groups[prefix].push(ch);
        }
        var pairs = [];
        var keys = Object.keys(groups);
        for (var k = 0; k < keys.length; k++) {
            var grp = groups[keys[k]];
            for (var i = 0; i < grp.length - 1; i++) pairs.push([grp[i], grp[i + 1]]);
        }
        return pairs;
    }

    function getActiveChannels() {
        if (_montage === "bipolar") {
            return getBipolarPairs().map(function (p) { return p[0] + "-" + p[1]; });
        }
        return CHANNELS.slice();
    }

    function getActiveData() {
        var raw = generateData();
        var montaged;
        if (_montage === "bipolar") {
            montaged = getBipolarPairs().map(function (pair) {
                var ia = CHANNELS.indexOf(pair[0]), ib = CHANNELS.indexOf(pair[1]);
                var diff = new Float32Array(N);
                for (var i = 0; i < N; i++) diff[i] = raw[ia][i] - raw[ib][i];
                return diff;
            });
        } else if (_montage === "car") {
            var mean = new Float32Array(N);
            for (var c = 0; c < raw.length; c++)
                for (var i = 0; i < N; i++) mean[i] += raw[c][i];
            for (var i = 0; i < N; i++) mean[i] /= raw.length;
            montaged = raw.map(function (ch) {
                var r = new Float32Array(N);
                for (var i = 0; i < N; i++) r[i] = ch[i] - mean[i];
                return r;
            });
        } else {
            montaged = raw;
        }
        if (_notchMode === "none") return montaged;
        return montaged.map(function (sig) { return DSP.applyNotchMode(sig, FS, _notchMode); });
    }

    function buildChannelMeta(channels, anodes) {
        var meta = {};
        for (var idx = 0; idx < channels.length; idx++) {
            var ch  = channels[idx];
            var src = anodes ? anodes[idx] : ch;
            var key = src.replace(/-.*/, "");
            var m   = CHANNEL_META[key] || {};
            meta[ch] = {
                status: m.status || "good",
                status_description: m.status_description || null,
                x: m.x != null ? m.x : null,
                y: m.y != null ? m.y : null,
                z: m.z != null ? m.z : null,
            };
        }
        return meta;
    }

    // ── LTTB downsampling ──────────────────────────────────────────────────

    function lttb(xs, ys, n) {
        var len = xs.length;
        if (len <= n) return [Array.from(xs), Array.from(ys)];
        var rx = [xs[0]], ry = [ys[0]];
        var bs = (len - 2) / (n - 2);
        var a = 0;
        for (var i = 0; i < n - 2; i++) {
            var avgS = Math.floor((i + 1) * bs) + 1;
            var avgE = Math.min(Math.floor((i + 2) * bs) + 1, len);
            var avgX = 0, avgY = 0;
            for (var j = avgS; j < avgE; j++) { avgX += xs[j]; avgY += ys[j]; }
            avgX /= (avgE - avgS); avgY /= (avgE - avgS);
            var rS = Math.floor(i * bs) + 1;
            var rE = Math.min(Math.floor((i + 1) * bs) + 1, len);
            var maxA = -1, maxIdx = rS;
            var ax = xs[a], ay = ys[a];
            for (var j = rS; j < rE; j++) {
                var area = Math.abs((ax - avgX) * (ys[j] - ay) - (ax - xs[j]) * (avgY - ay)) * 0.5;
                if (area > maxA) { maxA = area; maxIdx = j; }
            }
            rx.push(xs[maxIdx]); ry.push(ys[maxIdx]);
            a = maxIdx;
        }
        rx.push(xs[len - 1]); ry.push(ys[len - 1]);
        return [rx, ry];
    }

    // ── Metric computation ─────────────────────────────────────────────────

    function windowIndices(windowS, stepS) {
        var winLen = Math.round(windowS * FS);
        var step   = Math.round((stepS || windowS) * FS);
        var indices = [];
        for (var s = 0; s + winLen <= N; s += step) indices.push(s);
        return indices;
    }

    function windowCenterTimes(starts, winLen) {
        return starts.map(function (s) { return (s + winLen / 2) / FS; });
    }

    function lineLength(sig, start, len) {
        var ll = 0;
        for (var i = start + 1; i < start + len; i++) ll += Math.abs(sig[i] - sig[i - 1]);
        return ll;
    }

    function hjorth(sig, start, len) {
        var mx = 0;
        for (var i = start; i < start + len; i++) mx += sig[i];
        mx /= len;
        var varX = 0;
        for (var i = start; i < start + len; i++) varX += (sig[i] - mx) * (sig[i] - mx);
        varX /= len;
        var varDx = 0;
        for (var i = start; i < start + len - 1; i++) varDx += (sig[i + 1] - sig[i]) * (sig[i + 1] - sig[i]);
        varDx /= (len - 1);
        var varD2x = 0;
        for (var i = start; i < start + len - 2; i++) varD2x += (sig[i + 2] - 2 * sig[i + 1] + sig[i]) * (sig[i + 2] - 2 * sig[i + 1] + sig[i]);
        varD2x /= (len - 2);
        var activity   = varX;
        var mobility   = varX  > 1e-30 ? Math.sqrt(varDx  / varX)  : 0;
        var complexity = varDx > 1e-30 ? Math.sqrt(varD2x / varDx) / mobility : 0;
        return [activity, mobility, complexity];
    }

    // ── DSP reference (loaded before this script) ───────────────────────

    var DSP = window.ConcordDSP;

    // ── Cached spectral results ────────────────────────────────────────────

    var _psdCache = {};       // channel name → { freqs, power }
    var _spectCache = {};     // channel name → { times, freqs, power }
    var _bpCache = {};        // channel name → { bands: [...], values: [...] }
    var _bpTsCache = null;    // { channels, times, bands, values[ch][band][t] }

    function getPSD(channelName) {
        if (_psdCache[channelName]) return _psdCache[channelName];
        var idx = CHANNELS.indexOf(channelName);
        if (idx < 0) return { freqs: [], power: [] };
        var sig = DSP.applyNotchMode(generateData()[idx], FS, _notchMode);
        var result = DSP.welchPSD(sig, FS, 4.0, 0.5);
        _psdCache[channelName] = result;
        return result;
    }

    function getSpectrogram(channelName) {
        if (_spectCache[channelName]) return _spectCache[channelName];
        var idx = CHANNELS.indexOf(channelName);
        if (idx < 0) return { times: [], freqs: [], power: [] };
        var sig = DSP.applyNotchMode(generateData()[idx], FS, _notchMode);
        var result = DSP.spectrogram(sig, FS, 1.0, 0.5, 100, 200);
        _spectCache[channelName] = result;
        return result;
    }

    function getBandPower(channelName) {
        if (_bpCache[channelName]) return _bpCache[channelName];
        var psd = getPSD(channelName);
        var bp = DSP.bandPower(psd.freqs, psd.power);
        var bands = DSP.BAND_DEFS.map(function (b) { return b.name; });
        var values = bands.map(function (name) { return bp[name]; });
        _bpCache[channelName] = { bands: bands, values: values };
        return _bpCache[channelName];
    }

    function getBandPowerTimeseries() {
        if (_bpTsCache) return _bpTsCache;
        var bands = DSP.BAND_DEFS.map(function (b) { return b.name; });
        var allValues = [];
        var times = null;
        for (var ci = 0; ci < CHANNELS.length; ci++) {
            var sig = DSP.applyNotchMode(generateData()[ci], FS, _notchMode);
            var bpt = DSP.bandPowerTimeseries(sig, FS, 1.0, 1.0);
            if (!times) times = bpt.times;
            allValues.push(bpt.values); // values[bandIdx][timeIdx]
        }
        _bpTsCache = { channels: CHANNELS, times: times, bands: bands, values: allValues };
        return _bpTsCache;
    }

    // ── Mock response helpers ──────────────────────────────────────────────

    function ok(data) {
        return Promise.resolve(new Response(JSON.stringify(data), {
            status: 200, headers: { "Content-Type": "application/json" },
        }));
    }
    function fail(code, msg) {
        return Promise.resolve(new Response(JSON.stringify({ detail: msg }), {
            status: code, headers: { "Content-Type": "application/json" },
        }));
    }

    // ── API handler implementations ────────────────────────────────────────

    function handleLoad(body) {
        _montage = "monopolar";
        var channels = getActiveChannels();
        return ok({
            path: body && body.path ? body.path : "synthetic-wendling",
            channels: channels,
            n_channels: channels.length,
            fs: FS,
            duration: DURATION,
            montage: "monopolar",
            channel_metadata: buildChannelMeta(channels),
            events: EVENTS,
        });
    }

    function handleMontage(body) {
        var m = (body && body.montage) ? body.montage : "monopolar";
        if (["monopolar","bipolar","car"].indexOf(m) < 0) return fail(400, "Unknown montage: " + m);
        _montage = m;
        var channels = getActiveChannels();
        var anodes = m === "bipolar" ? getBipolarPairs().map(function (p) { return p[0]; }) : null;
        return ok({ montage: m, channels: channels, channel_metadata: buildChannelMeta(channels, anodes) });
    }

    function handleNotch(body) {
        var mode = (body && body.mode) ? body.mode : "none";
        if (["none", "notch50", "notch60"].indexOf(mode) < 0) mode = "none";
        _notchMode = mode;
        // Spectral caches depend on notch state — invalidate them.
        _psdCache   = {};
        _spectCache = {};
        _bpCache    = {};
        _bpTsCache  = null;
        return ok({ notch: mode });
    }

    function handleTimeseries(params) {
        var t0 = parseFloat(params.get("t_start") || "0");
        var t1 = parseFloat(params.get("t_end") || String(DURATION));
        var reqChannels = params.get("channels");
        var maxPoints   = parseInt(params.get("max_points") || "2000");

        var activeCh   = getActiveChannels();
        var activeData = getActiveData();
        var selNames = reqChannels ? reqChannels.split(",").filter(function (c) { return activeCh.indexOf(c) >= 0; }) : activeCh;
        if (!selNames.length) selNames = activeCh;

        var i0 = Math.max(0, Math.round(t0 * FS));
        var i1 = Math.min(N, Math.round(t1 * FS));
        var rawTimes = [];
        for (var k = 0; k < i1 - i0; k++) rawTimes.push((i0 + k) / FS);

        var firstIdx = activeCh.indexOf(selNames[0]);
        var firstSig = firstIdx >= 0 ? activeData[firstIdx].slice(i0, i1) : new Float32Array(i1-i0);
        var times = rawTimes.length > maxPoints ? lttb(rawTimes, firstSig, maxPoints)[0] : rawTimes;

        var outIdx = times.map(function (t) { return Math.min(i1 - i0 - 1, Math.round((t - i0 / FS) * FS)); });
        var values = selNames.map(function (name) {
            var ci = activeCh.indexOf(name);
            if (ci < 0) return times.map(function () { return 0; });
            var sig = activeData[ci];
            return outIdx.map(function (oi) { return sig[i0 + oi]; });
        });

        var events = EVENTS.filter(function (e) { return e.onset >= t0 && e.onset <= t1; });
        return ok({ channels: selNames, times: times, values: values, events: events });
    }

    function handlePSD(params) {
        var reqChannels = params.get("channels");
        var activeCh = getActiveChannels();
        var selNames = reqChannels ? reqChannels.split(",").filter(function (c) { return activeCh.indexOf(c) >= 0; }) : activeCh;
        if (!selNames.length) selNames = activeCh;

        // Compute PSD for each selected channel from raw monopolar data
        var allFreqs = null;
        var power = selNames.map(function (name) {
            var monoName = name.split("-")[0];
            var psd = getPSD(monoName);
            if (!allFreqs) allFreqs = Array.from(psd.freqs);
            return Array.from(psd.power);
        });
        return ok({ channels: selNames, freqs: allFreqs || [], power: power });
    }

    function handleSpectrogram(params) {
        var channel  = params.get("channel") || CHANNELS[0];
        var monoName = channel.split("-")[0];
        var spect    = getSpectrogram(monoName);
        return ok(spect);
    }

    function handleMetricLineLength(params) {
        var windowS = parseFloat(params.get("window_s") || "1.0");
        var winLen  = Math.round(windowS * FS);
        var starts  = windowIndices(windowS, windowS);
        var times   = windowCenterTimes(starts, winLen);

        var activeCh   = getActiveChannels();
        var activeData = getActiveData();
        var values = activeCh.map(function (_, ci) {
            var sig = activeData[ci];
            return starts.map(function (s) { return lineLength(sig, s, winLen); });
        });
        return ok({ channels: activeCh, times: times, values: values });
    }

    function handleMetricHjorth(params) {
        var windowS = parseFloat(params.get("window_s") || "1.0");
        var winLen  = Math.round(windowS * FS);
        var starts  = windowIndices(windowS, windowS);
        var times   = windowCenterTimes(starts, winLen);

        var activeCh   = getActiveChannels();
        var activeData = getActiveData();
        var values = activeCh.map(function (_, ci) {
            var sig = activeData[ci];
            return starts.map(function (s) { return hjorth(sig, s, winLen); });
        });
        return ok({ channels: activeCh, times: times, params: ["activity","mobility","complexity"], values: values });
    }

    function handleMetricBandPower() {
        var activeCh = getActiveChannels();
        var bands = DSP.BAND_DEFS.map(function (b) { return b.name; });
        var values = activeCh.map(function (name) {
            var monoName = name.split("-")[0];
            var bp = getBandPower(monoName);
            return bp.values;
        });
        return ok({ channels: activeCh, bands: bands, values: values });
    }

    function handleElectrodePositions() {
        var electrodes = CHANNELS.map(function (name) {
            var m = CHANNEL_META[name] || {};
            return {
                name: name,
                x: m.x != null ? m.x : null,
                y: m.y != null ? m.y : null,
                z: m.z != null ? m.z : null,
                status: m.status || "good",
                status_description: m.status_description || null,
            };
        });
        return ok({ electrodes: electrodes });
    }

    function handleBrainTimeseries(params) {
        var metric    = params.get("metric") || "line_length";
        var component = parseInt(params.get("component") || "0");
        var windowS   = parseFloat(params.get("window_s") || "1.0");
        var winLen    = Math.round(windowS * FS);
        var starts    = windowIndices(windowS, windowS);
        var times     = windowCenterTimes(starts, winLen);

        var activeCh   = getActiveChannels();
        var activeData = getActiveData();

        if (metric === "band_power" || metric === "band") {
            var bpt = getBandPowerTimeseries();
            var bandIdx = Math.min(component, bpt.bands.length - 1);
            var values = activeCh.map(function (name) {
                var monoName = name.split("-")[0];
                var ci = bpt.channels.indexOf(monoName);
                return ci >= 0 ? bpt.values[ci][bandIdx] : bpt.times.map(function () { return 0; });
            });
            return ok({ channels: activeCh, times: bpt.times, values: values });
        }

        var values = activeCh.map(function (_, ci) {
            var sig = activeData[ci];
            if (metric === "line_length") {
                return starts.map(function (s) { return lineLength(sig, s, winLen); });
            }
            if (metric === "hjorth_activity" || (metric === "hjorth" && component === 0)) {
                return starts.map(function (s) { return hjorth(sig, s, winLen)[0]; });
            }
            if (metric === "hjorth_mobility" || (metric === "hjorth" && component === 1)) {
                return starts.map(function (s) { return hjorth(sig, s, winLen)[1]; });
            }
            return times.map(function () { return 0; });
        });
        return ok({ channels: activeCh, times: times, values: values });
    }

    function handleEvents() {
        return ok({ events: EVENTS });
    }

    function handleBrowse() {
        return ok({
            path: "/synthetic",
            parent: null,
            entries: [
                { name: "wendling-seizure-simulation.synth", is_dir: false, size: null },
            ],
        });
    }

    // ── Fetch patch ────────────────────────────────────────────────────────

    var _origFetch = window.fetch.bind(window);
    window.fetch = function (url, opts) {
        if (!opts) opts = {};
        var str = typeof url === "string" ? url : url.toString();
        var path, params;
        try {
            var u = new URL(str, location.href);
            path   = u.pathname;
            params = u.searchParams;
        } catch (e) {
            return _origFetch(url, opts);
        }

        if (path.indexOf("/api/") !== 0) return _origFetch(url, opts);

        var method = ((opts && opts.method) || "GET").toUpperCase();
        var body = null;
        if (opts && opts.body) {
            try { body = JSON.parse(opts.body); } catch (e) { body = null; }
        }

        if (path === "/api/load"              && method === "POST") return handleLoad(body);
        if (path === "/api/montage"           && method === "POST") return handleMontage(body);
        if (path === "/api/notch"             && method === "POST") return handleNotch(body);
        if (path === "/api/timeseries")                             return handleTimeseries(params);
        if (path === "/api/psd")                                    return handlePSD(params);
        if (path === "/api/spectrogram")                            return handleSpectrogram(params);
        if (path === "/api/metric/line_length")                     return handleMetricLineLength(params);
        if (path === "/api/metric/hjorth")                          return handleMetricHjorth(params);
        if (path === "/api/metric/band_power")                      return handleMetricBandPower();
        if (path === "/api/electrode_positions")                    return handleElectrodePositions();
        if (path === "/api/brain_timeseries")                       return handleBrainTimeseries(params);
        if (path === "/api/events")                                 return handleEvents();
        if (path === "/api/browse")                                 return handleBrowse();
        if (path === "/api/shutdown"          && method === "POST") return ok({ status: "demo" });

        return _origFetch(url, opts);
    };

    // ── UI adjustments ─────────────────────────────────────────────────────

    document.addEventListener("DOMContentLoaded", function () {
        // Set up UI first (before data generation, so errors don't block the banner)
        var banner = document.createElement("div");
        banner.id = "demo-banner";
        banner.style.cssText = "background:#5b8dee;color:#0f1117;text-align:center;padding:5px 12px;font-size:12px;font-weight:700;letter-spacing:0.05em;z-index:1000;flex-shrink:0;";
        banner.textContent = "DEMO \u2014 synthetic SEEG \u00b7 Wendling neural mass model \u00b7 6 channels \u00b7 LA2 spike-wave seizure at t=10 s";
        var topbar = document.getElementById("topbar");
        if (topbar) topbar.insertAdjacentElement("afterend", banner);
        else document.body.prepend(banner);

        var pathInput = document.getElementById("path-input");
        if (pathInput) {
            pathInput.value = "wendling-seizure-simulation.synth";
            pathInput.style.color = "#5b8dee";
        }

        var stopBtn = document.getElementById("shutdown-btn");
        if (stopBtn) {
            stopBtn.textContent = "Demo";
            stopBtn.title = "Running in demo mode \u2014 no server";
            stopBtn.disabled = true;
            stopBtn.style.opacity = "0.4";
        }

        // Generate synthetic data, then auto-click Load
        try {
            generateData();
        } catch (e) {
            banner.textContent = "DEMO ERROR: " + e.message;
            banner.style.background = "#e55";
            console.error("Concord demo data generation failed:", e);
        }

        var loadBtn = document.getElementById("load-btn");
        if (loadBtn) setTimeout(function () { loadBtn.click(); }, 400);
    });

})();
