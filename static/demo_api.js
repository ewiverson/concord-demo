// demo_api.js — mock concord-server API for the demo. Patches window.fetch for /api/*.
// Requires dsp.js, synth.js, demo_signals.js, demo_dataset.js (loaded before app.js).

(function () {
    "use strict";

    var DSP = window.ConcordDSP;
    var Signals = window.ConcordDemoSignals;
    var Dataset = window.ConcordDemoDataset;

    // ── Current recording (what /api/load last opened) ─────────────────────

    var cur = null;       // { path, fs, duration, n, names, meta, raw, events, montage, notch }
    var recCache = {};    // path → generated recording
    var spectral = {};    // spectral caches for `cur`, reset on load / notch change

    function resetCaches() { spectral = { psd: {}, spect: {}, bp: {}, bpTs: null }; }

    function openRecording(path, parsed) {
        var rec = recCache[path];
        if (!rec) {
            var gen = Signals.generate(parsed.spec);
            rec = {
                path: path, fs: gen.fs, duration: gen.duration, n: gen.fs * gen.duration,
                names: gen.channels.map(function (c) { return c.name; }),
                meta: {}, raw: gen.channels.map(function (c) { return c.data; }), events: gen.events,
            };
            gen.channels.forEach(function (c) {
                rec.meta[c.name] = { status: "good", status_description: c.soz ? "soz" : null, x: c.x, y: c.y, z: c.z };
            });
            recCache[path] = rec;
        }
        cur = rec;
        cur.montage = "monopolar";
        cur.notch = "none";
        resetCaches();
        return cur;
    }

    // ── Montage helpers ────────────────────────────────────────────────────

    function bipolarPairs() {
        var groups = {};
        cur.names.forEach(function (ch) {
            var prefix = ch.replace(/\d+$/, "");
            (groups[prefix] = groups[prefix] || []).push(ch);
        });
        var pairs = [];
        Object.keys(groups).forEach(function (k) {
            for (var i = 0; i < groups[k].length - 1; i++) pairs.push([groups[k][i], groups[k][i + 1]]);
        });
        return pairs;
    }

    function activeChannels() {
        if (cur.montage === "bipolar") return bipolarPairs().map(function (p) { return p[0] + "-" + p[1]; });
        return cur.names.slice();
    }

    function montaged() {
        var raw = cur.raw, n = cur.n, out;
        if (cur.montage === "bipolar") {
            out = bipolarPairs().map(function (pair) {
                var a = raw[cur.names.indexOf(pair[0])], b = raw[cur.names.indexOf(pair[1])];
                var d = new Float32Array(n);
                for (var i = 0; i < n; i++) d[i] = a[i] - b[i];
                return d;
            });
        } else if (cur.montage === "car") {
            var mean = new Float32Array(n);
            raw.forEach(function (ch) { for (var i = 0; i < n; i++) mean[i] += ch[i]; });
            for (var i = 0; i < n; i++) mean[i] /= raw.length;
            out = raw.map(function (ch) {
                var r = new Float32Array(n);
                for (var j = 0; j < n; j++) r[j] = ch[j] - mean[j];
                return r;
            });
        } else {
            out = raw;
        }
        if (cur.notch === "none") return out;
        return out.map(function (sig) { return DSP.applyNotchMode(sig, cur.fs, cur.notch); });
    }

    function channelMeta(channels, anodes) {
        var meta = {};
        channels.forEach(function (ch, idx) {
            var m = cur.meta[(anodes ? anodes[idx] : ch).replace(/-.*/, "")] || {};
            meta[ch] = {
                status: m.status || "good", status_description: m.status_description || null,
                x: m.x != null ? m.x : null, y: m.y != null ? m.y : null, z: m.z != null ? m.z : null,
            };
        });
        return meta;
    }

    // ── Downsampling (LTTB) ────────────────────────────────────────────────

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
            for (var k = rS; k < rE; k++) {
                var area = Math.abs((ax - avgX) * (ys[k] - ay) - (ax - xs[k]) * (avgY - ay)) * 0.5;
                if (area > maxA) { maxA = area; maxIdx = k; }
            }
            rx.push(xs[maxIdx]); ry.push(ys[maxIdx]);
            a = maxIdx;
        }
        rx.push(xs[len - 1]); ry.push(ys[len - 1]);
        return [rx, ry];
    }

    // ── Metrics ────────────────────────────────────────────────────────────

    function windowStarts(windowS) {
        var winLen = Math.round(windowS * cur.fs), starts = [];
        for (var s = 0; s + winLen <= cur.n; s += winLen) starts.push(s);
        return starts;
    }

    function windowTimes(starts, winLen) {
        return starts.map(function (s) { return (s + winLen / 2) / cur.fs; });
    }

    function lineLength(sig, start, len) {
        var ll = 0;
        for (var i = start + 1; i < start + len; i++) ll += Math.abs(sig[i] - sig[i - 1]);
        return ll;
    }

    function hjorth(sig, start, len) {
        var mx = 0, i;
        for (i = start; i < start + len; i++) mx += sig[i];
        mx /= len;
        var varX = 0, varDx = 0, varD2x = 0;
        for (i = start; i < start + len; i++) varX += (sig[i] - mx) * (sig[i] - mx);
        varX /= len;
        for (i = start; i < start + len - 1; i++) varDx += (sig[i + 1] - sig[i]) * (sig[i + 1] - sig[i]);
        varDx /= (len - 1);
        for (i = start; i < start + len - 2; i++) {
            var d2 = sig[i + 2] - 2 * sig[i + 1] + sig[i];
            varD2x += d2 * d2;
        }
        varD2x /= (len - 2);
        var mobility = varX > 1e-30 ? Math.sqrt(varDx / varX) : 0;
        var complexity = varDx > 1e-30 && mobility ? Math.sqrt(varD2x / varDx) / mobility : 0;
        return [varX, mobility, complexity];
    }

    // ── Spectral (computed on first request, cached) ───────────────────────

    function monoSignal(name) { return DSP.applyNotchMode(cur.raw[cur.names.indexOf(name)], cur.fs, cur.notch); }

    function getPSD(name) {
        if (!spectral.psd[name]) spectral.psd[name] = DSP.welchPSD(monoSignal(name), cur.fs, 4.0, 0.5);
        return spectral.psd[name];
    }

    function getSpectrogram(name) {
        if (!spectral.spect[name]) spectral.spect[name] = DSP.spectrogram(monoSignal(name), cur.fs, 1.0, 0.5, 100, 200);
        return spectral.spect[name];
    }

    function getBandPower(name) {
        if (!spectral.bp[name]) {
            var psd = getPSD(name);
            var bp = DSP.bandPower(psd.freqs, psd.power);
            var bands = DSP.BAND_DEFS.map(function (b) { return b.name; });
            spectral.bp[name] = { bands: bands, values: bands.map(function (b) { return bp[b]; }) };
        }
        return spectral.bp[name];
    }

    function getBandPowerTimeseries() {
        if (!spectral.bpTs) {
            var bands = DSP.BAND_DEFS.map(function (b) { return b.name; });
            var times = null;
            var values = cur.names.map(function (name) {
                var bpt = DSP.bandPowerTimeseries(monoSignal(name), cur.fs, 1.0, 1.0);
                if (!times) times = bpt.times;
                return bpt.values;
            });
            spectral.bpTs = { channels: cur.names, times: times, bands: bands, values: values };
        }
        return spectral.bpTs;
    }

    // ── Response helpers ───────────────────────────────────────────────────

    function ok(data) {
        return Promise.resolve(new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    function fail(code, msg) {
        return Promise.resolve(new Response(JSON.stringify({ detail: msg }), { status: code, headers: { "Content-Type": "application/json" } }));
    }
    function needRecording() { return fail(400, "No recording loaded. POST /api/load first."); }

    function selectChannels(params) {
        var active = activeChannels();
        var req = params.get("channels");
        var sel = req ? req.split(",").filter(function (c) { return active.indexOf(c) >= 0; }) : active;
        return sel.length ? sel : active;
    }

    // ── Recording handlers ─────────────────────────────────────────────────

    function handleLoad(body) {
        var path = body && body.path;
        var parsed = Dataset.parsePath(path);
        if (!parsed) return fail(404, "File not found: " + path);
        if (!Dataset.isDownloaded(parsed.subject.id)) return fail(400, parsed.subject.id + " has not been downloaded yet.");
        openRecording(path, parsed);
        var channels = activeChannels();
        return ok({
            path: path, channels: channels, n_channels: channels.length, fs: cur.fs, duration: cur.duration,
            montage: "monopolar", channel_metadata: channelMeta(channels), events: cur.events,
        });
    }

    function handleMontage(body) {
        if (!cur) return needRecording();
        var m = (body && body.montage) || "monopolar";
        if (["monopolar", "bipolar", "car"].indexOf(m) < 0) return fail(400, "Unknown montage: " + m);
        cur.montage = m;
        var channels = activeChannels();
        var anodes = m === "bipolar" ? bipolarPairs().map(function (p) { return p[0]; }) : null;
        return ok({ montage: m, channels: channels, channel_metadata: channelMeta(channels, anodes) });
    }

    function handleNotch(body) {
        if (!cur) return needRecording();
        var mode = (body && body.mode) || "none";
        if (["none", "notch50", "notch60"].indexOf(mode) < 0) return fail(400, "Invalid notch mode: " + mode);
        cur.notch = mode;
        resetCaches();
        return ok({ mode: mode });
    }

    function handleTimeseries(params) {
        if (!cur) return needRecording();
        var t0 = parseFloat(params.get("t_start") || "0");
        var t1 = parseFloat(params.get("t_end") || String(cur.duration));
        var maxPoints = parseInt(params.get("max_points") || "2000", 10);
        var active = activeChannels(), data = montaged(), sel = selectChannels(params);

        var i0 = Math.max(0, Math.round(t0 * cur.fs)), i1 = Math.min(cur.n, Math.round(t1 * cur.fs));
        var rawTimes = [];
        for (var k = 0; k < i1 - i0; k++) rawTimes.push((i0 + k) / cur.fs);

        var first = data[active.indexOf(sel[0])].slice(i0, i1);
        var times = rawTimes.length > maxPoints ? lttb(rawTimes, first, maxPoints)[0] : rawTimes;
        var idx = times.map(function (t) { return Math.min(i1 - i0 - 1, Math.round((t - i0 / cur.fs) * cur.fs)); });
        var values = sel.map(function (name) {
            var sig = data[active.indexOf(name)];
            return idx.map(function (oi) { return sig[i0 + oi]; });
        });
        var events = cur.events.filter(function (e) { return e.onset >= t0 && e.onset <= t1; });
        return ok({ channels: sel, times: times, values: values, events: events });
    }

    function handlePSD(params) {
        if (!cur) return needRecording();
        var sel = selectChannels(params), freqs = null;
        var power = sel.map(function (name) {
            var psd = getPSD(name.split("-")[0]);
            if (!freqs) freqs = Array.from(psd.freqs);
            return Array.from(psd.power);
        });
        return ok({ channels: sel, freqs: freqs || [], power: power });
    }

    function handleSpectrogram(params) {
        if (!cur) return needRecording();
        var channel = (params.get("channel") || cur.names[0]).split("-")[0];
        return ok(getSpectrogram(channel));
    }

    function windowedMetric(params, fn, extra) {
        if (!cur) return needRecording();
        var windowS = parseFloat(params.get("window_s") || "1.0");
        var winLen = Math.round(windowS * cur.fs), starts = windowStarts(windowS);
        var data = montaged();
        var out = { channels: activeChannels(), times: windowTimes(starts, winLen),
                    values: data.map(function (sig) { return starts.map(function (s) { return fn(sig, s, winLen); }); }) };
        return ok(Object.assign(out, extra || {}));
    }

    function handleBandPower() {
        if (!cur) return needRecording();
        var active = activeChannels();
        var bands = DSP.BAND_DEFS.map(function (b) { return b.name; });
        return ok({ channels: active, bands: bands, values: active.map(function (n) { return getBandPower(n.split("-")[0]).values; }) });
    }

    function handleElectrodePositions() {
        if (!cur) return needRecording();
        return ok({
            electrodes: cur.names.map(function (name) {
                var m = cur.meta[name];
                return { name: name, x: m.x, y: m.y, z: m.z, status: m.status, status_description: m.status_description };
            }),
        });
    }

    function handleBrainTimeseries(params) {
        if (!cur) return needRecording();
        var metric = params.get("metric") || "line_length";
        var component = parseInt(params.get("component") || "0", 10);
        var windowS = parseFloat(params.get("window_s") || "1.0");
        var winLen = Math.round(windowS * cur.fs), starts = windowStarts(windowS);
        var times = windowTimes(starts, winLen), active = activeChannels(), data = montaged();

        if (metric === "band_power" || metric === "band") {
            var bpt = getBandPowerTimeseries();
            var band = Math.min(component, bpt.bands.length - 1);
            return ok({
                channels: active, times: bpt.times,
                values: active.map(function (n) {
                    var ci = bpt.channels.indexOf(n.split("-")[0]);
                    return ci >= 0 ? bpt.values[ci][band] : bpt.times.map(function () { return 0; });
                }),
            });
        }
        var pick = null;
        if (metric === "line_length") pick = function (sig, s) { return lineLength(sig, s, winLen); };
        else if (metric === "hjorth_activity" || (metric === "hjorth" && component === 0)) pick = function (sig, s) { return hjorth(sig, s, winLen)[0]; };
        else if (metric === "hjorth_mobility" || (metric === "hjorth" && component === 1)) pick = function (sig, s) { return hjorth(sig, s, winLen)[1]; };
        return ok({
            channels: active, times: times,
            values: data.map(function (sig) {
                return pick ? starts.map(function (s) { return pick(sig, s); }) : times.map(function () { return 0; });
            }),
        });
    }

    // ── Server admin: nothing to administer in a static demo ───────────────

    function handleServerInfo() {
        return ok({
            demo: true, pid: 0, host: location.hostname, port: Number(location.port) || 443, uptime_s: 0,
            auto_reload_active: false, data_root: Dataset.ROOT, python: "n/a", config_path: "",
            settings: { host: "", port: 0, data_root: "", reload: false },
        });
    }

    // ── Routing ────────────────────────────────────────────────────────────

    function route(path, method, params, body) {
        if (path === "/api/load" && method === "POST") return handleLoad(body);
        if (path === "/api/montage" && method === "POST") return handleMontage(body);
        if (path === "/api/notch" && method === "POST") return handleNotch(body);
        if (path === "/api/timeseries") return handleTimeseries(params);
        if (path === "/api/psd") return handlePSD(params);
        if (path === "/api/spectrogram") return handleSpectrogram(params);
        if (path === "/api/metric/line_length") return windowedMetric(params, lineLength);
        if (path === "/api/metric/hjorth") return windowedMetric(params, hjorth, { params: ["activity", "mobility", "complexity"] });
        if (path === "/api/metric/band_power") return handleBandPower();
        if (path === "/api/electrode_positions") return handleElectrodePositions();
        if (path === "/api/brain_timeseries") return handleBrainTimeseries(params);
        if (path === "/api/events") return cur ? ok({ events: cur.events }) : needRecording();

        if (path === "/api/bids/datasets") return ok(Dataset.datasets(params.get("root")));
        if (path === "/api/bids/subjects") return ok(Dataset.subjects());
        if (path === "/api/bids/sessions") return ok(Dataset.sessions(params.get("subject")));
        if (path === "/api/bids/recordings") return ok(Dataset.recordings(params.get("subject")));
        if (path === "/api/browse_dirs") return ok(Dataset.browseDirs(params.get("path")));

        if (path === "/api/server/info") return handleServerInfo();
        if (path.indexOf("/api/server/") === 0 || path === "/api/shutdown") return fail(400, "Not available in the demo.");
        return null;
    }

    var realFetch = window.fetch.bind(window);
    window.fetch = function (url, opts) {
        var u;
        try { u = new URL(typeof url === "string" ? url : url.toString(), location.href); } catch (e) { return realFetch(url, opts); }
        if (u.origin !== location.origin || u.pathname.indexOf("/api/") !== 0) return realFetch(url, opts);

        var method = ((opts && opts.method) || "GET").toUpperCase();
        var body = null;
        if (opts && opts.body) {
            try { body = JSON.parse(opts.body); } catch (e) { body = null; }
        }
        return route(u.pathname, method, u.searchParams, body) || fail(404, "Not found in demo: " + u.pathname);
    };
})();
