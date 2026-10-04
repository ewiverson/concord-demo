// dsp.js — Client-side spectral processing for Concord demo.
// Includes vendored fft.js (MIT, github.com/indutny/fft.js).
// Exposed as window.ConcordDSP.

(function () {
    "use strict";

    // ── Vendored FFT (fft.js 4.0.4, MIT license) ───────────────────────────
    // Inlined to avoid CDN dependency and CommonJS module.exports issues.

    var FFT = (typeof window !== "undefined" && window.FFT) || (function () {
        function FFT(size) {
            this.size = size | 0;
            if (this.size <= 1 || (this.size & (this.size - 1)) !== 0)
                throw new Error("FFT size must be a power of two and bigger than 1");
            this._csize = size << 1;
            var table = new Array(this.size * 2);
            for (var i = 0; i < table.length; i += 2) {
                var angle = Math.PI * i / this.size;
                table[i] = Math.cos(angle);
                table[i + 1] = -Math.sin(angle);
            }
            this.table = table;
            var power = 0;
            for (var t = 1; this.size > t; t <<= 1) power++;
            this._width = power % 2 === 0 ? power - 1 : power;
            this._bitrev = new Array(1 << this._width);
            for (var j = 0; j < this._bitrev.length; j++) {
                this._bitrev[j] = 0;
                for (var shift = 0; shift < this._width; shift += 2) {
                    var revShift = this._width - shift - 2;
                    this._bitrev[j] |= ((j >>> shift) & 3) << revShift;
                }
            }
            this._out = null;
            this._data = null;
            this._inv = 0;
        }
        FFT.prototype.createComplexArray = function () {
            var res = new Array(this._csize);
            for (var i = 0; i < res.length; i++) res[i] = 0;
            return res;
        };
        FFT.prototype.realTransform = function (out, data) {
            if (out === data) throw new Error("Input and output buffers must be different");
            this._out = out; this._data = data; this._inv = 0;
            this._realTransform4();
            this._out = null; this._data = null;
        };
        FFT.prototype._realTransform4 = function () {
            var out = this._out, size = this._csize;
            var width = this._width, step = 1 << width, len = (size / step) << 1;
            var outOff, t, bitrev = this._bitrev;
            if (len === 4) {
                for (outOff = 0, t = 0; outOff < size; outOff += len, t++) {
                    this._singleRealTransform2(outOff, bitrev[t] >>> 1, step >>> 1);
                }
            } else {
                for (outOff = 0, t = 0; outOff < size; outOff += len, t++) {
                    this._singleRealTransform4(outOff, bitrev[t] >>> 1, step >>> 1);
                }
            }
            var inv = this._inv ? -1 : 1, table = this.table;
            for (step >>= 2; step >= 2; step >>= 2) {
                len = (size / step) << 1;
                var halfLen = len >>> 1, quarterLen = halfLen >>> 1, hquarterLen = quarterLen >>> 1;
                for (outOff = 0; outOff < size; outOff += len) {
                    for (var i = 0, k = 0; i <= hquarterLen; i += 2, k += step) {
                        var A = outOff + i, B = A + quarterLen, C = B + quarterLen, D = C + quarterLen;
                        var Ar = out[A], Ai = out[A+1], Br = out[B], Bi = out[B+1];
                        var Cr = out[C], Ci = out[C+1], Dr = out[D], Di = out[D+1];
                        var MAr = Ar, MAi = Ai;
                        var tableBr = table[k], tableBi = inv * table[k+1];
                        var MBr = Br*tableBr - Bi*tableBi, MBi = Br*tableBi + Bi*tableBr;
                        var tableCr = table[2*k], tableCi = inv * table[2*k+1];
                        var MCr = Cr*tableCr - Ci*tableCi, MCi = Cr*tableCi + Ci*tableCr;
                        var tableDr = table[3*k], tableDi = inv * table[3*k+1];
                        var MDr = Dr*tableDr - Di*tableDi, MDi = Dr*tableDi + Di*tableDr;
                        var T0r = MAr+MCr, T0i = MAi+MCi, T1r = MAr-MCr, T1i = MAi-MCi;
                        var T2r = MBr+MDr, T2i = MBi+MDi;
                        var T3r = inv*(MBr-MDr), T3i = inv*(MBi-MDi);
                        out[A] = T0r+T2r; out[A+1] = T0i+T2i;
                        out[B] = T1r+T3i; out[B+1] = T1i-T3r;
                        if (i === 0) { out[C] = T0r-T2r; out[C+1] = T0i-T2i; continue; }
                        if (i === hquarterLen) continue;
                        var ST0r=T1r, ST0i=-T1i, ST1r=T0r, ST1i=-T0i;
                        var ST2r=-inv*T3i, ST2i=-inv*T3r, ST3r=-inv*T2i, ST3i=-inv*T2r;
                        var SA = outOff+quarterLen-i, SB = outOff+halfLen-i;
                        out[SA] = ST0r+ST2r; out[SA+1] = ST0i+ST2i;
                        out[SB] = ST1r+ST3i; out[SB+1] = ST1i-ST3r;
                    }
                }
            }
        };
        FFT.prototype._singleRealTransform2 = function (outOff, off, step) {
            var out = this._out, data = this._data;
            var evenR = data[off], oddR = data[off + step];
            out[outOff] = evenR + oddR; out[outOff+1] = 0;
            out[outOff+2] = evenR - oddR; out[outOff+3] = 0;
        };
        FFT.prototype._singleRealTransform4 = function (outOff, off, step) {
            var out = this._out, data = this._data, inv = this._inv ? -1 : 1;
            var step2 = step*2, step3 = step*3;
            var Ar = data[off], Br = data[off+step], Cr = data[off+step2], Dr = data[off+step3];
            var T0r = Ar+Cr, T1r = Ar-Cr, T2r = Br+Dr, T3r = inv*(Br-Dr);
            out[outOff] = T0r+T2r; out[outOff+1] = 0;
            out[outOff+2] = T1r; out[outOff+3] = -T3r;
            out[outOff+4] = T0r-T2r; out[outOff+5] = 0;
            out[outOff+6] = T1r; out[outOff+7] = T3r;
        };
        return FFT;
    })();

    // ── Hann window (cached by length) ──────────────────────────────────────

    var _hannCache = {};

    function hannWindow(n) {
        if (_hannCache[n]) return _hannCache[n];
        var w = new Float64Array(n);
        var f = 2.0 * Math.PI / (n - 1);
        for (var i = 0; i < n; i++) w[i] = 0.5 * (1.0 - Math.cos(f * i));
        _hannCache[n] = w;
        return w;
    }

    // ── Next power of 2 ─────────────────────────────────────────────────────

    function nextPow2(n) {
        var p = 1;
        while (p < n) p <<= 1;
        return p;
    }

    // ── Welch PSD ───────────────────────────────────────────────────────────
    // Returns { freqs: Float64Array, power: Float64Array } in V^2/Hz.

    function welchPSD(signal, fs, windowS, overlap) {
        if (windowS === undefined) windowS = 4.0;
        if (overlap === undefined) overlap = 0.5;

        var nperseg = Math.round(windowS * fs);
        var nfft = nextPow2(nperseg);
        var step = Math.round(nperseg * (1.0 - overlap));
        var win = hannWindow(nperseg);

        // Window normalization factor
        var winSS = 0;
        for (var i = 0; i < nperseg; i++) winSS += win[i] * win[i];

        var nfreqs = Math.floor(nfft / 2) + 1;
        var accum = new Float64Array(nfreqs);
        var nSegments = 0;

        var fft = new FFT(nfft);
        var padded = new Float64Array(nfft);
        var out = fft.createComplexArray();

        for (var start = 0; start + nperseg <= signal.length; start += step) {
            // Apply window and zero-pad
            for (var i = 0; i < nperseg; i++) padded[i] = signal[start + i] * win[i];
            for (var i = nperseg; i < nfft; i++) padded[i] = 0;

            fft.realTransform(out, padded);

            // Accumulate |X(f)|^2
            for (var k = 0; k < nfreqs; k++) {
                var re = out[2 * k];
                var im = out[2 * k + 1];
                accum[k] += re * re + im * im;
            }
            nSegments++;
        }

        if (nSegments === 0) {
            return { freqs: new Float64Array(0), power: new Float64Array(0) };
        }

        // Normalize: PSD = mean(|X|^2) / (fs * sum(win^2))
        var scale = 1.0 / (fs * winSS * nSegments);
        var power = new Float64Array(nfreqs);
        power[0] = accum[0] * scale;                  // DC — no doubling
        for (var k = 1; k < nfreqs - 1; k++) {
            power[k] = accum[k] * scale * 2.0;        // one-sided doubling
        }
        power[nfreqs - 1] = accum[nfreqs - 1] * scale; // Nyquist — no doubling

        var freqs = new Float64Array(nfreqs);
        var df = fs / nfft;
        for (var k = 0; k < nfreqs; k++) freqs[k] = k * df;

        return { freqs: freqs, power: power };
    }

    // ── Spectrogram ─────────────────────────────────────────────────────────
    // Returns { times, freqs, power } where power[t][f] is in dB.

    function spectrogram(signal, fs, windowS, overlap, maxFreq, maxTimes) {
        if (windowS === undefined) windowS = 1.0;
        if (overlap === undefined) overlap = 0.5;
        if (maxFreq === undefined) maxFreq = 100;
        if (maxTimes === undefined) maxTimes = 200;

        var nperseg = Math.round(windowS * fs);
        var nfft = nextPow2(nperseg);
        var step = Math.round(nperseg * (1.0 - overlap));
        var win = hannWindow(nperseg);

        var winSS = 0;
        for (var i = 0; i < nperseg; i++) winSS += win[i] * win[i];

        var nfreqs = Math.floor(nfft / 2) + 1;
        var df = fs / nfft;

        // Limit frequency bins
        var maxBin = Math.min(nfreqs, Math.floor(maxFreq / df) + 1);

        var fft_obj = new FFT(nfft);
        var padded = new Float64Array(nfft);
        var out = fft_obj.createComplexArray();

        // Collect all time slices
        var allSlices = [];
        var allTimes = [];
        for (var start = 0; start + nperseg <= signal.length; start += step) {
            for (var i = 0; i < nperseg; i++) padded[i] = signal[start + i] * win[i];
            for (var i = nperseg; i < nfft; i++) padded[i] = 0;

            fft_obj.realTransform(out, padded);

            var scale = 1.0 / (fs * winSS);
            var slice = new Float64Array(maxBin);
            slice[0] = (out[0] * out[0] + out[1] * out[1]) * scale;
            for (var k = 1; k < maxBin; k++) {
                var re = out[2 * k], im = out[2 * k + 1];
                slice[k] = (re * re + im * im) * scale * 2.0;
            }
            allSlices.push(slice);
            allTimes.push((start + nperseg / 2) / fs);
        }

        // Downsample time axis if needed
        var timeStep = 1;
        if (allSlices.length > maxTimes) {
            timeStep = Math.ceil(allSlices.length / maxTimes);
        }

        var times = [];
        var power = [];
        for (var t = 0; t < allSlices.length; t += timeStep) {
            times.push(allTimes[t]);
            var row = new Array(maxBin);
            for (var k = 0; k < maxBin; k++) {
                row[k] = 10.0 * Math.log10(Math.max(allSlices[t][k], 1e-30));
            }
            power.push(row);
        }

        var freqs = new Array(maxBin);
        for (var k = 0; k < maxBin; k++) freqs[k] = k * df;

        return { times: times, freqs: freqs, power: power };
    }

    // ── Band power ──────────────────────────────────────────────────────────
    // Trapezoidal integration over standard frequency bands.

    var BAND_DEFS = [
        { name: "delta",      lo: 0.5, hi: 4   },
        { name: "theta",      lo: 4,   hi: 8   },
        { name: "alpha",      lo: 8,   hi: 13  },
        { name: "beta",       lo: 13,  hi: 30  },
        { name: "gamma",      lo: 30,  hi: 80  },
        { name: "high_gamma", lo: 80,  hi: 150 },
    ];

    function bandPower(freqs, power) {
        var result = {};
        for (var b = 0; b < BAND_DEFS.length; b++) {
            var band = BAND_DEFS[b];
            var total = 0;
            var count = 0;
            for (var k = 1; k < freqs.length; k++) {
                if (freqs[k - 1] >= band.lo && freqs[k] <= band.hi) {
                    var df = freqs[k] - freqs[k - 1];
                    total += 0.5 * (power[k - 1] + power[k]) * df;
                    count++;
                }
            }
            result[band.name] = total;
        }
        return result;
    }

    // ── Windowed band power timeseries ──────────────────────────────────────
    // Returns { times, bands, values[bandIdx][timeIdx] }

    function bandPowerTimeseries(signal, fs, windowS, stepS) {
        if (windowS === undefined) windowS = 1.0;
        if (stepS === undefined) stepS = windowS;

        var winLen = Math.round(windowS * fs);
        var step = Math.round(stepS * fs);
        var bands = BAND_DEFS.map(function (b) { return b.name; });
        var times = [];
        var values = bands.map(function () { return []; });

        for (var start = 0; start + winLen <= signal.length; start += step) {
            times.push((start + winLen / 2) / fs);
            var seg = signal.slice(start, start + winLen);
            var psd = welchPSD(seg, fs, windowS, 0.5);
            var bp = bandPower(psd.freqs, psd.power);
            for (var b = 0; b < bands.length; b++) {
                values[b].push(bp[bands[b]]);
            }
        }

        return { times: times, bands: bands, values: values };
    }

    // ── Notch filter ────────────────────────────────────────────────────────
    // Zero-phase 2nd-order IIR notch filter.
    // Matches scipy.signal.iirnotch(freq, quality, fs) + sosfiltfilt.

    function _iirOnce(signal, b0, b1, b2, a1, a2) {
        var len = signal.length;
        var out = new Float64Array(len);
        var s1 = 0, s2 = 0;
        for (var i = 0; i < len; i++) {
            var x = signal[i];
            var y = b0 * x + s1;
            out[i] = y;
            s1 = b1 * x - a1 * y + s2;
            s2 = b2 * x - a2 * y;
        }
        return out;
    }

    function notchFilter(signal, fs, freq, Q) {
        if (Q === undefined) Q = 30.0;
        if (freq <= 0 || freq >= fs / 2) return signal;
        var w0  = 2.0 * Math.PI * freq / fs;
        var k   = Math.tan(w0 / (2.0 * Q));
        var n   = 1.0 / (1.0 + k);
        var b0  = n;
        var b1  = -2.0 * n * Math.cos(w0);
        var b2  = n;
        var a1  = b1;                      // same as b1 for 2nd-order notch
        var a2  = (1.0 - k) * n;

        // Forward pass
        var fwd = _iirOnce(signal, b0, b1, b2, a1, a2);
        // Reverse
        var rev = new Float64Array(fwd.length);
        for (var i = 0; i < fwd.length; i++) rev[i] = fwd[fwd.length - 1 - i];
        // Backward pass
        var bwd = _iirOnce(rev, b0, b1, b2, a1, a2);
        // Reverse result into Float32Array
        var out = new Float32Array(bwd.length);
        for (var i = 0; i < bwd.length; i++) out[i] = bwd[bwd.length - 1 - i];
        return out;
    }

    // Apply 50 or 60 Hz notch (+ 2nd harmonic) matching the server pipeline.
    function applyNotchMode(signal, fs, mode) {
        if (!mode || mode === "none") return signal;
        var freq = mode === "notch50" ? 50.0 : 60.0;
        var nyq  = fs / 2.0;
        var out  = signal;
        if (freq < nyq)          out = notchFilter(out, fs, freq);
        if (freq * 2.0 < nyq)    out = notchFilter(out, fs, freq * 2.0);
        return out;
    }

    // ── Public API ──────────────────────────────────────────────────────────

    window.ConcordDSP = {
        welchPSD: welchPSD,
        spectrogram: spectrogram,
        bandPower: bandPower,
        bandPowerTimeseries: bandPowerTimeseries,
        notchFilter: notchFilter,
        applyNotchMode: applyNotchMode,
        BAND_DEFS: BAND_DEFS,
    };
})();
