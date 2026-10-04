// demo_dataset.js — a virtual BIDS dataset for the demo, with a simulated cloud download.
// Exposed as window.ConcordDemoDataset. Mirrors the shapes returned by concord-server's /api/bids/* routes.

(function () {
    "use strict";

    var ROOT = "/demo/datasets";
    var DS_ID = "ds-demo";
    var DS_PATH = ROOT + "/" + DS_ID;
    var STORE_KEY = "concord_demo_downloaded";
    var SESSION = "ses-presurgery";
    var DEFAULT_LOCAL = ["sub-DEMO01"];

    var FIELDS = {
        participant_id: { Description: "Participant identifier" },
        age: { Description: "Age at implantation", Units: "years" },
        sex: { Description: "Sex", Levels: { F: "Female", M: "Male" } },
        implant: { Description: "Implant type", Levels: { SEEG: "Stereo-EEG depth electrodes" } },
        target: { Description: "Implant target" },
        lesional: { Description: "MRI lesion", Levels: { yes: "Lesional", no: "MRI-negative" } },
        engel_outcome: {
            Description: "Engel surgical outcome",
            Levels: { "1A": "Completely seizure free", "1B": "Non-disabling simple partial seizures only", "2A": "Initially free, rare seizures now" },
        },
    };

    // Synthetic participants. `layout`, `soz`, `onset`, `seed` drive the signal generator.
    var SUBJECTS = [
        { id: "sub-DEMO01", age: 34, sex: "F", target: "Left temporal",        lesional: "yes", engel: "1A", layout: "bilateral-amygdala",    soz: ["LA2"],        onset: 10, seed: 1 },
        { id: "sub-DEMO02", age: 27, sex: "M", target: "Left mesial temporal", lesional: "no",  engel: "1B", layout: "left-temporal",         soz: ["LH1", "LH2"], onset: 12, seed: 2 },
        { id: "sub-DEMO03", age: 41, sex: "F", target: "Bilateral hippocampal", lesional: "no", engel: "2A", layout: "bilateral-hippocampus", soz: ["RH2"],        onset: 9,  seed: 3 },
        { id: "sub-DEMO04", age: 19, sex: "M", target: "Left temporal",        lesional: "yes", engel: "1A", layout: "left-temporal",         soz: ["LA1", "LA2"], onset: 14, seed: 4 },
        { id: "sub-DEMO05", age: 52, sex: "F", target: "Bilateral amygdala",   lesional: "no",  engel: "1A", layout: "bilateral-amygdala",    soz: ["RA1"],        onset: 11, seed: 5 },
        { id: "sub-DEMO06", age: 38, sex: "M", target: "Bilateral hippocampal", lesional: "yes", engel: "1B", layout: "bilateral-hippocampus", soz: ["LH3"],       onset: 13, seed: 6 },
    ];

    var RECORDINGS = [
        { task: "interictal", run: "01", has_events: false, mb: 11.8 },
        { task: "ictal",      run: "01", has_events: true,  mb: 12.4 },
        { task: "ictal",      run: "02", has_events: true,  mb: 12.1 },
    ];

    // ── Download state (persisted so a refresh keeps what you downloaded) ──

    function readStore() {
        try {
            var raw = JSON.parse(localStorage.getItem(STORE_KEY));
            if (Array.isArray(raw)) return raw;
        } catch (e) { /* storage unavailable */ }
        return DEFAULT_LOCAL.slice();
    }
    function writeStore(list) {
        try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
    }
    function isDownloaded(subjectId) { return readStore().indexOf(subjectId) >= 0; }
    function markDownloaded(subjectId) {
        var list = readStore();
        if (list.indexOf(subjectId) < 0) list.push(subjectId);
        writeStore(list);
    }
    function resetDownloads() { writeStore(DEFAULT_LOCAL.slice()); }

    // ── Lookups ────────────────────────────────────────────────────────────

    function findSubject(id) {
        for (var i = 0; i < SUBJECTS.length; i++) if (SUBJECTS[i].id === id) return SUBJECTS[i];
        return null;
    }

    function recordingBase(subjectId, rec) {
        return subjectId + "_" + SESSION + "_task-" + rec.task + "_acq-seeg_run-" + rec.run;
    }

    function recordingPath(subjectId, rec) {
        return DS_PATH + "/" + subjectId + "/" + SESSION + "/ieeg/" + recordingBase(subjectId, rec) + "_ieeg.edf";
    }

    // Parse a path produced by recordingPath(); returns { subject, rec, spec } or null.
    function parsePath(path) {
        var m = /\/(sub-DEMO\d+)\/ses-presurgery\/ieeg\/.*_task-([a-z]+)_acq-seeg_run-(\d+)_ieeg\.edf$/.exec(path || "");
        if (!m) return null;
        var subj = findSubject(m[1]);
        if (!subj) return null;
        var spec = { layout: subj.layout, seed: subj.seed, task: m[2], run: m[3], soz: subj.soz, onset: subj.onset + (m[3] === "02" ? 3 : 0) };
        return { subject: subj, task: m[2], run: m[3], spec: spec };
    }

    // ── Shapes matching /api/bids/* ────────────────────────────────────────

    function datasets(root) {
        var norm = (root || ROOT).replace(/\/+$/, "");
        if (norm !== ROOT) return { root: root, datasets: [] };
        return {
            root: ROOT,
            datasets: [{
                dataset_id: DS_ID,
                name: "Concord Demo Dataset (synthetic SEEG)",
                path: DS_PATH,
                description: "Concord Demo Dataset (synthetic SEEG)",
                bids_version: "1.9.0",
                n_subjects: SUBJECTS.length,
                source_label: "the simulated cloud",
                download_label: "Download (simulated)",
            }],
        };
    }

    function subjects() {
        return {
            dataset: DS_PATH,
            fields: FIELDS,
            subjects: SUBJECTS.map(function (s) {
                return {
                    participant_id: s.id, age: String(s.age), sex: s.sex, implant: "SEEG",
                    target: s.target, lesional: s.lesional, engel_outcome: s.engel,
                    downloaded: isDownloaded(s.id),
                };
            }),
        };
    }

    function sessions(subjectId) {
        if (!findSubject(subjectId)) return { sessions: [] };
        return { sessions: [{ session_id: SESSION, path: DS_PATH + "/" + subjectId + "/" + SESSION, modalities: ["ieeg"] }] };
    }

    function recordings(subjectId) {
        if (!findSubject(subjectId)) return { recordings: [] };
        var local = isDownloaded(subjectId);
        return {
            recordings: RECORDINGS.map(function (r) {
                return {
                    filename: recordingBase(subjectId, r) + "_ieeg.edf",
                    path: recordingPath(subjectId, r),
                    task: r.task, run: r.run, acquisition: "seeg", modality: "ieeg",
                    has_events: r.has_events, has_channels: true, downloaded: local,
                };
            }),
        };
    }

    // Folder-picker tree: / → demo → datasets → ds-demo
    function browseDirs(path) {
        var tree = { "/": ["demo"], "/demo": ["datasets"], "/demo/datasets": [DS_ID], "/demo/datasets/ds-demo": [] };
        var p = (path || ROOT).replace(/\/+$/, "") || "/";
        if (!tree[p]) return { path: p, dirs: [], error: "Not a directory" };
        var parent = p === "/" ? "/" : (p.substring(0, p.lastIndexOf("/")) || "/");
        return { path: p, parent: parent, dirs: tree[p] };
    }

    // ── Simulated download (replaces EventSource for /api/bids/download) ───

    function FakeEventSource(url) {
        var self = this;
        this._handlers = {};
        this._timers = [];
        this.readyState = 1;
        var subject = new URL(url, location.href).searchParams.get("subject");

        if (!findSubject(subject)) {
            this._at(50, "error", { message: "Unknown subject: " + subject });
            return;
        }
        var files = RECORDINGS.map(function (r) { return { name: recordingBase(subject, r) + "_ieeg.edf", mb: r.mb }; });
        var t = 150;
        this._at(t, "progress", { line: "Downloading " + subject + " from " + DS_ID + " (simulated; data is synthetic)..." });
        t += 600;
        this._at(t, "progress", { line: "Checking " + files.length + " files, downloading as needed (5 concurrent downloads)." });
        files.forEach(function (f) {
            t += 750;
            self._at(t, "progress", { line: "  " + f.name + "  " + f.mb.toFixed(1) + " MB  100%" });
        });
        t += 500;
        this._at(t, "progress", { line: "Finished downloading " + subject + " (" + files.length + " files)." });
        t += 200;
        this._timers.push(setTimeout(function () {
            markDownloaded(subject);
            self._emit("done", { success: true, subject: subject });
        }, t));
    }
    FakeEventSource.prototype._at = function (ms, type, data) {
        var self = this;
        this._timers.push(setTimeout(function () { self._emit(type, data); }, ms));
    };
    FakeEventSource.prototype._emit = function (type, data) {
        if (this.readyState === 2) return;
        var list = this._handlers[type] || [];
        for (var i = 0; i < list.length; i++) list[i]({ data: JSON.stringify(data) });
    };
    FakeEventSource.prototype.addEventListener = function (type, fn) {
        (this._handlers[type] = this._handlers[type] || []).push(fn);
    };
    FakeEventSource.prototype.close = function () {
        this.readyState = 2;
        this._timers.forEach(clearTimeout);
        this._timers = [];
    };

    var RealEventSource = window.EventSource;
    window.EventSource = function (url, opts) {
        if (String(url).indexOf("/api/bids/download") >= 0) return new FakeEventSource(url);
        return new RealEventSource(url, opts);
    };

    window.ConcordDemoDataset = {
        ROOT: ROOT, DS_ID: DS_ID,
        datasets: datasets, subjects: subjects, sessions: sessions, recordings: recordings, browseDirs: browseDirs,
        isDownloaded: isDownloaded, parsePath: parsePath, resetDownloads: resetDownloads,
    };
})();
