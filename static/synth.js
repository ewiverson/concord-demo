// Wendling 2002 neural mass model — client-side JS port.
// Matches concord-model-wendling Python implementation exactly.
// Exposed as window.ConcordSynth.

(function () {
    "use strict";

    // ── Seeded PRNG (SplitMix64 → Xorshift128+) ─────────────────────────────

    function splitmix64(seed) {
        // Returns a function that yields sequential 64-bit-grade values.
        // Used to seed xorshift128+.
        let s = BigInt(seed) & 0xFFFFFFFFFFFFFFFFn;
        return function () {
            s = (s + 0x9E3779B97F4A7C15n) & 0xFFFFFFFFFFFFFFFFn;
            let z = s;
            z = ((z ^ (z >> 30n)) * 0xBF58476D1CE4E5B9n) & 0xFFFFFFFFFFFFFFFFn;
            z = ((z ^ (z >> 27n)) * 0x94D049BB133111EBn) & 0xFFFFFFFFFFFFFFFFn;
            z = z ^ (z >> 31n);
            return z;
        };
    }

    function Xorshift128Plus(seed) {
        const sm = splitmix64(seed);
        this._s0 = sm();
        this._s1 = sm();
        this._spare = null; // for Box-Muller pair caching
    }

    Xorshift128Plus.prototype.nextUint64 = function () {
        let s1 = this._s0;
        const s0 = this._s1;
        this._s0 = s0;
        s1 = (s1 ^ ((s1 << 23n) & 0xFFFFFFFFFFFFFFFFn)) & 0xFFFFFFFFFFFFFFFFn;
        this._s1 = (s1 ^ s0 ^ (s1 >> 17n) ^ (s0 >> 26n)) & 0xFFFFFFFFFFFFFFFFn;
        return (this._s1 + s0) & 0xFFFFFFFFFFFFFFFFn;
    };

    Xorshift128Plus.prototype.nextFloat = function () {
        // Returns [0, 1) with 53 bits of precision.
        const v = this.nextUint64();
        return Number(v >> 11n) / 9007199254740992; // 2^53
    };

    Xorshift128Plus.prototype.nextGaussian = function () {
        // Box-Muller transform, caches the spare.
        if (this._spare !== null) {
            const s = this._spare;
            this._spare = null;
            return s;
        }
        let u, v, s;
        do {
            u = 2.0 * this.nextFloat() - 1.0;
            v = 2.0 * this.nextFloat() - 1.0;
            s = u * u + v * v;
        } while (s >= 1.0 || s === 0.0);
        const mul = Math.sqrt(-2.0 * Math.log(s) / s);
        this._spare = v * mul;
        return u * mul;
    };

    // ── Sigmoid ──────────────────────────────────────────────────────────────

    function sigmoid(v, e0, v0, r) {
        // S(v) = 2 * e0 / (1 + exp(r * (v0 - v)))
        let exponent = r * (v0 - v);
        if (exponent > 500.0) exponent = 500.0;
        else if (exponent < -500.0) exponent = -500.0;
        return 2.0 * e0 / (1.0 + Math.exp(exponent));
    }

    // ── Wendling ODE derivatives ─────────────────────────────────────────────

    function wendlingDerivatives(dy, y, t, pInput, A, B, G, a, b, g, C1, C2, C3, C4, C5, C6, C7, e0, v0, r) {
        // Positions = velocities
        dy[0] = y[5];
        dy[1] = y[6];
        dy[2] = y[7];
        dy[3] = y[8];
        dy[4] = y[9];

        // Block 0: Excitatory feedback -> pyramidal (He kernel)
        dy[5] = A * a * sigmoid(y[1] - y[2] - y[3], e0, v0, r) - 2.0 * a * y[5] - a * a * y[0];

        // Block 1: External input + pyramidal -> excitatory interneurons (He kernel)
        dy[6] = A * a * (pInput + C2 * sigmoid(C1 * y[0], e0, v0, r)) - 2.0 * a * y[6] - a * a * y[1];

        // Block 2: Slow inhibitory -> pyramidal (Hi kernel)
        dy[7] = B * b * C4 * sigmoid(C3 * y[0], e0, v0, r) - 2.0 * b * y[7] - b * b * y[2];

        // Block 3: Fast inhibitory -> pyramidal (Hg kernel)
        dy[8] = G * g * C7 * sigmoid(C5 * y[0] - C6 * y[4], e0, v0, r) - 2.0 * g * y[8] - g * g * y[3];

        // Block 4: Slow inhibitory -> fast inhibitory cross-inhibition (Hi kernel)
        dy[9] = B * b * sigmoid(C3 * y[0], e0, v0, r) - 2.0 * b * y[9] - b * b * y[4];
    }

    // ── RK4 integrator (allocation-free in hot loop) ─────────────────────────

    var _k1 = new Float64Array(10);
    var _k2 = new Float64Array(10);
    var _k3 = new Float64Array(10);
    var _k4 = new Float64Array(10);
    var _tmp = new Float64Array(10);

    function rk4Step(y, t, dt, pInput, A, B, G, a, b, g, C1, C2, C3, C4, C5, C6, C7, e0, v0, r) {
        var hdt = 0.5 * dt;

        wendlingDerivatives(_k1, y, t, pInput, A, B, G, a, b, g, C1, C2, C3, C4, C5, C6, C7, e0, v0, r);

        for (var i = 0; i < 10; i++) _tmp[i] = y[i] + hdt * _k1[i];
        wendlingDerivatives(_k2, _tmp, t + hdt, pInput, A, B, G, a, b, g, C1, C2, C3, C4, C5, C6, C7, e0, v0, r);

        for (var i = 0; i < 10; i++) _tmp[i] = y[i] + hdt * _k2[i];
        wendlingDerivatives(_k3, _tmp, t + hdt, pInput, A, B, G, a, b, g, C1, C2, C3, C4, C5, C6, C7, e0, v0, r);

        for (var i = 0; i < 10; i++) _tmp[i] = y[i] + dt * _k3[i];
        wendlingDerivatives(_k4, _tmp, t + dt, pInput, A, B, G, a, b, g, C1, C2, C3, C4, C5, C6, C7, e0, v0, r);

        var dt6 = dt / 6.0;
        for (var i = 0; i < 10; i++) {
            y[i] += dt6 * (_k1[i] + 2.0 * _k2[i] + 2.0 * _k3[i] + _k4[i]);
        }
    }

    // ── Anti-aliased decimation ──────────────────────────────────────────────

    function decimateAvg(signal, factor) {
        // Simple averaging decimation: box-car low-pass then downsample.
        var n = Math.floor(signal.length / factor);
        var out = new Float32Array(n);
        for (var i = 0; i < n; i++) {
            var sum = 0.0;
            var base = i * factor;
            for (var j = 0; j < factor; j++) sum += signal[base + j];
            out[i] = sum / factor;
        }
        return out;
    }

    // ── Simulation ───────────────────────────────────────────────────────────

    var DEFAULTS = {
        A: 5.0, B: 25.0, G: 10.0,
        a: 100.0, b: 50.0, g: 500.0,
        C: 135.0,
        e0: 2.5, v0: 6.0, r: 0.56,
        p: 90.0, sigma: 30.0,
    };

    // Wendling 2002 Table 1 regimes — only A, B, G differ from defaults.
    var REGIMES = {
        normal:      { A: 5, B: 50, G: 15 },
        preictal:    { A: 5, B: 35, G: 12 },  // lower B → visible alpha, natural preictal background
        spikes:      { A: 5, B: 40, G: 15 },
        spike_wave:  { A: 5, B: 25, G: 15 },
        slow:        { A: 5, B: 10, G: 15 },
        lvfa:        { A: 5, B: 5,  G: 25 },
        quasi_sin:   { A: 5, B: 15, G: 0  },
    };

    function mergeParams(overrides) {
        var p = {};
        for (var k in DEFAULTS) p[k] = DEFAULTS[k];
        if (overrides) {
            for (var k in overrides) p[k] = overrides[k];
        }
        return p;
    }

    function simulate(duration_s, fs, params, seed) {
        var P = mergeParams(params);
        var A = P.A, B = P.B, G = P.G;
        var a = P.a, b = P.b, g = P.g;
        var C = P.C;
        var e0 = P.e0, v0 = P.v0, r = P.r;
        var p_mean = P.p, sigma = P.sigma;

        var C1 = C, C2 = 0.8 * C, C3 = 0.25 * C, C4 = 0.25 * C;
        var C5 = 0.3 * C, C6 = 0.1 * C, C7 = 0.8 * C;

        var dt = 1e-4;
        var warmup_s = 1.0;
        var total_s = duration_s + warmup_s;
        var n_steps = Math.ceil(total_s / dt);
        var warmup_steps = Math.ceil(warmup_s / dt);

        var rng = new Xorshift128Plus(seed || 42);

        // Generate white Gaussian noise (all upfront, matching Python)
        var p_noise = new Float64Array(n_steps);
        for (var i = 0; i < n_steps; i++) {
            p_noise[i] = p_mean + sigma * rng.nextGaussian();
        }

        // Integrate
        var y = new Float64Array(10); // zeros
        var integration_fs = 1.0 / dt;
        var downsample_factor = Math.round(integration_fs / fs);
        var n_output_steps = n_steps - warmup_steps;
        var output_full = new Float64Array(n_output_steps);

        for (var i = 0; i < n_steps; i++) {
            rk4Step(y, i * dt, dt, p_noise[i], A, B, G, a, b, g, C1, C2, C3, C4, C5, C6, C7, e0, v0, r);
            if (i >= warmup_steps) {
                output_full[i - warmup_steps] = y[1] - y[2] - y[3];
            }
        }

        // Anti-aliased decimation
        var signal = downsample_factor > 1
            ? decimateAvg(output_full, downsample_factor)
            : new Float32Array(output_full);

        return { signal: signal, fs: fs, duration_s: duration_s };
    }

    function simulateTransition(duration_s, fs, paramsA, paramsB, switchTime_s, seed) {
        var PA = mergeParams(paramsA);
        var PB = mergeParams(paramsB);

        var dt = 1e-4;
        var warmup_s = 1.0;
        var total_s = duration_s + warmup_s;
        var n_steps = Math.ceil(total_s / dt);
        var warmup_steps = Math.ceil(warmup_s / dt);
        // Switch time is relative to output (after warmup discard)
        var switch_step = warmup_steps + Math.round(switchTime_s / dt);

        var rng = new Xorshift128Plus(seed || 42);

        // Generate noise for full duration
        var p_noise = new Float64Array(n_steps);
        for (var i = 0; i < n_steps; i++) {
            // Use paramsA noise mean/sigma before switch, paramsB after
            var P = (i < switch_step) ? PA : PB;
            p_noise[i] = P.p + P.sigma * rng.nextGaussian();
        }

        // Integrate with parameter switching
        var y = new Float64Array(10);
        var integration_fs = 1.0 / dt;
        var downsample_factor = Math.round(integration_fs / fs);
        var n_output_steps = n_steps - warmup_steps;
        var output_full = new Float64Array(n_output_steps);

        for (var i = 0; i < n_steps; i++) {
            var P = (i < switch_step) ? PA : PB;
            var A = P.A, B = P.B, G = P.G;
            var a = P.a, b = P.b, g = P.g;
            var C = P.C;
            var C1 = C, C2 = 0.8 * C, C3 = 0.25 * C, C4 = 0.25 * C;
            var C5 = 0.3 * C, C6 = 0.1 * C, C7 = 0.8 * C;

            rk4Step(y, i * dt, dt, p_noise[i], A, B, G, a, b, g, C1, C2, C3, C4, C5, C6, C7, P.e0, P.v0, P.r);
            if (i >= warmup_steps) {
                output_full[i - warmup_steps] = y[1] - y[2] - y[3];
            }
        }

        var signal = downsample_factor > 1
            ? decimateAvg(output_full, downsample_factor)
            : new Float32Array(output_full);

        return { signal: signal, fs: fs, duration_s: duration_s };
    }

    // ── Public API ───────────────────────────────────────────────────────────

    window.ConcordSynth = {
        simulate: simulate,
        simulateTransition: simulateTransition,
        mergeParams: mergeParams,
        DEFAULTS: DEFAULTS,
        REGIMES: REGIMES,
    };
})();
