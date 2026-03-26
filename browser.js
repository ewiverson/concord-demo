// browser.js — BIDS dataset column browser

const ROOT_KEY = "concord_dataset_root";

const browserState = {
    root: "",
    datasets: [],
    selectedDataset: null,   // {name, path, ...}
    subjects: [],
    fields: {},
    selectedSubject: null,   // {participant_id, ...}
    sessions: [],
    selectedSession: null,   // {session_id, ...}
    recordings: [],
};

// Callbacks set by app.js
let _onRecordingSelect = null;

async function apiFetch(url) {
    const resp = await fetch(url);
    if (!resp.ok) {
        const body = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(body.detail || resp.statusText);
    }
    return resp.json();
}

function clearColumn(colId) {
    const col = document.querySelector(`#${colId} .col-body`);
    if (col) col.innerHTML = "";
}

function clearColumnsAfter(startColId) {
    const order = ["col-datasets", "col-subjects", "col-detail", "col-sessions", "col-recordings"];
    const idx = order.indexOf(startColId);
    for (let i = idx; i < order.length; i++) {
        clearColumn(order[i]);
    }
}

function makeItem(text, subtitle, onClick) {
    const div = document.createElement("div");
    div.className = "browser-item";
    const nameSpan = document.createElement("span");
    nameSpan.className = "browser-item-name";
    nameSpan.textContent = text;
    div.appendChild(nameSpan);
    if (subtitle) {
        const sub = document.createElement("span");
        sub.className = "browser-item-sub";
        sub.textContent = subtitle;
        div.appendChild(sub);
    }
    div.addEventListener("click", () => {
        div.parentElement.querySelectorAll(".browser-item").forEach(el => el.classList.remove("selected"));
        div.classList.add("selected");
        onClick();
    });
    return div;
}

async function loadDatasets(root) {
    browserState.root = root;
    browserState.selectedDataset = null;
    browserState.selectedSubject = null;
    browserState.selectedSession = null;
    clearColumnsAfter("col-datasets");

    if (!root) return;

    try {
        const data = await apiFetch(`/api/bids/datasets?root=${encodeURIComponent(root)}`);
        browserState.datasets = data.datasets;
        const body = document.querySelector("#col-datasets .col-body");
        if (data.datasets.length === 0) {
            body.innerHTML = '<div class="browser-empty">No BIDS datasets found</div>';
            return;
        }
        for (const ds of data.datasets) {
            const subtitle = `${ds.n_subjects} subject${ds.n_subjects !== 1 ? "s" : ""}`;
            body.appendChild(makeItem(ds.name, subtitle, () => selectDataset(ds)));
        }
    } catch (e) {
        document.querySelector("#col-datasets .col-body").innerHTML =
            `<div class="browser-empty">Error: ${e.message}</div>`;
    }
}

async function selectDataset(ds) {
    browserState.selectedDataset = ds;
    browserState.selectedSubject = null;
    browserState.selectedSession = null;
    clearColumnsAfter("col-subjects");

    try {
        const data = await apiFetch(`/api/bids/subjects?dataset=${encodeURIComponent(ds.path)}`);
        browserState.subjects = data.subjects;
        browserState.fields = data.fields || {};
        const body = document.querySelector("#col-subjects .col-body");
        if (data.subjects.length === 0) {
            body.innerHTML = '<div class="browser-empty">No subjects found</div>';
            return;
        }
        for (const subj of data.subjects) {
            const id = subj.participant_id || "?";
            const label = id.replace(/^sub-/, "");
            const implant = subj.implant || "";
            const item = makeItem(label, implant, () => selectSubject(subj));
            // Add downloaded/cloud badge
            const badge = document.createElement("span");
            badge.className = subj.downloaded ? "badge-downloaded" : "badge-cloud";
            badge.textContent = subj.downloaded ? "local" : "cloud";
            const nameEl = item.querySelector(".browser-item-name");
            nameEl.after(badge);
            body.appendChild(item);
        }
    } catch (e) {
        document.querySelector("#col-subjects .col-body").innerHTML =
            `<div class="browser-empty">Error: ${e.message}</div>`;
    }
}

async function selectSubject(subj) {
    browserState.selectedSubject = subj;
    browserState.selectedSession = null;
    clearColumnsAfter("col-detail");

    // Fill detail column
    const detailBody = document.querySelector("#col-detail .col-body");
    detailBody.innerHTML = "";
    const table = document.createElement("table");
    table.className = "metadata-table";
    const fields = browserState.fields;
    for (const [key, value] of Object.entries(subj)) {
        if (key === "participant_id" || key.startsWith("_") || value === null) continue;
        const tr = document.createElement("tr");
        const fieldInfo = fields[key] || {};
        const displayLabel = fieldInfo.Description || key;
        // Resolve level descriptions
        let displayValue = value;
        if (fieldInfo.Levels && fieldInfo.Levels[value]) {
            displayValue = `${value} — ${fieldInfo.Levels[value]}`;
        }
        if (fieldInfo.Units) {
            displayValue = `${displayValue} ${fieldInfo.Units}`;
        }
        tr.innerHTML = `<td class="meta-key">${displayLabel}</td><td class="meta-value">${displayValue}</td>`;
        table.appendChild(tr);
    }
    detailBody.appendChild(table);

    // Load sessions
    const subjectId = subj.participant_id;
    const dsPath = browserState.selectedDataset.path;
    try {
        const data = await apiFetch(
            `/api/bids/sessions?dataset=${encodeURIComponent(dsPath)}&subject=${encodeURIComponent(subjectId)}`
        );
        browserState.sessions = data.sessions;

        if (data.sessions.length === 0) {
            // No sessions — load recordings directly, skip sessions column
            clearColumn("col-sessions");
            document.querySelector("#col-sessions .col-body").innerHTML =
                '<div class="browser-empty">No sessions</div>';
            await loadRecordings(dsPath, subjectId, null);
        } else {
            const sessBody = document.querySelector("#col-sessions .col-body");
            clearColumn("col-recordings");
            for (const ses of data.sessions) {
                const label = ses.session_id.replace(/^ses-/, "");
                const mods = ses.modalities.join(", ");
                sessBody.appendChild(makeItem(label, mods, () => selectSession(ses)));
            }
        }
    } catch (e) {
        document.querySelector("#col-sessions .col-body").innerHTML =
            `<div class="browser-empty">Error: ${e.message}</div>`;
    }
}

async function selectSession(ses) {
    browserState.selectedSession = ses;
    clearColumn("col-recordings");
    const dsPath = browserState.selectedDataset.path;
    const subjectId = browserState.selectedSubject.participant_id;
    await loadRecordings(dsPath, subjectId, ses.session_id);
}

async function loadRecordings(dsPath, subjectId, sessionId) {
    try {
        let url = `/api/bids/recordings?dataset=${encodeURIComponent(dsPath)}&subject=${encodeURIComponent(subjectId)}`;
        if (sessionId) url += `&session=${encodeURIComponent(sessionId)}`;
        const data = await apiFetch(url);
        browserState.recordings = data.recordings;
        const body = document.querySelector("#col-recordings .col-body");
        if (data.recordings.length === 0) {
            body.innerHTML = '<div class="browser-empty">No recordings found</div>';
            return;
        }
        for (const rec of data.recordings) {
            const label = [rec.task, rec.run ? `run-${rec.run}` : ""].filter(Boolean).join(" ");
            const div = document.createElement("div");
            div.className = "browser-item recording-item";

            const nameSpan = document.createElement("span");
            nameSpan.className = "browser-item-name";
            nameSpan.textContent = label || rec.filename;
            div.appendChild(nameSpan);

            const badges = document.createElement("span");
            badges.className = "recording-badges";
            // Download status badge
            const dlBadge = document.createElement("span");
            dlBadge.className = rec.downloaded ? "badge-downloaded" : "badge-cloud";
            dlBadge.textContent = rec.downloaded ? "local" : "cloud";
            badges.appendChild(dlBadge);
            if (rec.has_events) {
                const b = document.createElement("span");
                b.className = "recording-badge badge-events";
                b.textContent = "events";
                badges.appendChild(b);
            }
            if (rec.has_channels) {
                const b = document.createElement("span");
                b.className = "recording-badge badge-channels";
                b.textContent = "channels";
                badges.appendChild(b);
            }
            div.appendChild(badges);

            const modSpan = document.createElement("span");
            modSpan.className = "browser-item-sub";
            modSpan.textContent = rec.modality || "";
            div.appendChild(modSpan);

            div.addEventListener("click", () => {
                body.querySelectorAll(".browser-item").forEach(el => el.classList.remove("selected"));
                div.classList.add("selected");
                if (rec.downloaded) {
                    if (_onRecordingSelect) _onRecordingSelect(rec, browserState);
                } else {
                    // Open download modal for the subject
                    openDownloadModal(browserState.selectedSubject);
                }
            });
            body.appendChild(div);
        }
    } catch (e) {
        document.querySelector("#col-recordings .col-body").innerHTML =
            `<div class="browser-empty">Error: ${e.message}</div>`;
    }
}

// ---- Folder picker ----------------------------------------------------------

let _fpCurrentPath = "";

async function fpNavigate(path) {
    const resp = await fetch(`/api/browse_dirs?path=${encodeURIComponent(path)}`);
    const data = await resp.json();
    _fpCurrentPath = data.path;
    document.getElementById("fp-path-input").value = data.path;

    const list = document.getElementById("fp-dir-list");
    list.innerHTML = "";
    if (data.error) {
        list.innerHTML = `<div class="browser-empty">${data.error}</div>`;
        return;
    }
    if (data.dirs.length === 0) {
        list.innerHTML = '<div class="browser-empty">No subdirectories</div>';
        return;
    }
    for (const name of data.dirs) {
        const div = document.createElement("div");
        div.className = "fb-entry fb-dir";
        div.textContent = name;
        div.addEventListener("click", () => {
            const child = _fpCurrentPath.replace(/\/+$/, "") + "/" + name;
            fpNavigate(child);
        });
        list.appendChild(div);
    }
}

function openFolderPicker() {
    const modal = document.getElementById("folder-picker-modal");
    modal.hidden = false;
    const startPath = document.getElementById("data-root-input").value.trim() || "";
    fpNavigate(startPath);
}

function closeFolderPicker() {
    document.getElementById("folder-picker-modal").hidden = true;
}

function initFolderPicker() {
    document.getElementById("folder-picker-close").addEventListener("click", closeFolderPicker);
    document.getElementById("folder-picker-modal").addEventListener("click", e => {
        if (e.target === e.currentTarget) closeFolderPicker();
    });
    document.getElementById("fp-up-btn").addEventListener("click", () => {
        // Go to parent
        const parts = _fpCurrentPath.replace(/\/+$/, "").split("/");
        if (parts.length > 1) {
            parts.pop();
            fpNavigate(parts.join("/") || "/");
        }
    });
    document.getElementById("fp-go-btn").addEventListener("click", () => {
        const val = document.getElementById("fp-path-input").value.trim();
        if (val) fpNavigate(val);
    });
    document.getElementById("fp-path-input").addEventListener("keydown", e => {
        if (e.key === "Enter") {
            const val = e.target.value.trim();
            if (val) fpNavigate(val);
        }
    });
    document.getElementById("fp-select-btn").addEventListener("click", () => {
        if (_fpCurrentPath) {
            setDataRoot(_fpCurrentPath);
            closeFolderPicker();
        }
    });
}

// ---- Init -------------------------------------------------------------------

function initBrowser(onRecordingSelect) {
    _onRecordingSelect = onRecordingSelect;

    const rootInput = document.getElementById("data-root-input");
    const setRootBtn = document.getElementById("set-root-btn");

    // Restore saved root
    const savedRoot = localStorage.getItem(ROOT_KEY) || "";
    rootInput.value = savedRoot;

    // "Set Root" button opens the folder picker dialog
    setRootBtn.addEventListener("click", () => openFolderPicker());

    // Enter in the text input still works directly
    rootInput.addEventListener("keydown", e => {
        if (e.key === "Enter") {
            const root = rootInput.value.trim();
            if (root) {
                localStorage.setItem(ROOT_KEY, root);
                loadDatasets(root);
            }
        }
    });

    initFolderPicker();
    initDownloadModal();

    // Initial load
    if (savedRoot) {
        loadDatasets(savedRoot);
    }
}

function showBrowser() {
    document.getElementById("browser-view").hidden = false;
    document.getElementById("analysis-view").hidden = true;
}

function hideBrowser() {
    document.getElementById("browser-view").hidden = true;
    document.getElementById("analysis-view").hidden = false;
}

function setDataRoot(root) {
    const rootInput = document.getElementById("data-root-input");
    rootInput.value = root;
    localStorage.setItem(ROOT_KEY, root);
    loadDatasets(root);
}

// ---- Download modal ---------------------------------------------------------

let _dlSubject = null;
let _dlEventSource = null;

function openDownloadModal(subj) {
    _dlSubject = subj;
    const ds = browserState.selectedDataset;
    const dsId = ds ? ds.dataset_id : "?";
    const pid = subj.participant_id || "?";

    document.getElementById("download-desc").textContent =
        `Download ${pid} from OpenNeuro dataset ${dsId}?`;
    document.getElementById("download-progress-area").hidden = true;
    document.getElementById("download-log").textContent = "";
    document.getElementById("download-start-btn").disabled = false;
    document.getElementById("download-start-btn").textContent = "Download from OpenNeuro";
    document.getElementById("download-progress-fill").className = "download-progress-fill";
    document.getElementById("download-progress-fill").style.width = "0%";
    document.getElementById("download-modal").hidden = false;
}

function closeDownloadModal() {
    document.getElementById("download-modal").hidden = true;
    if (_dlEventSource) {
        _dlEventSource.close();
        _dlEventSource = null;
    }
}

function startDownload() {
    const ds = browserState.selectedDataset;
    if (!ds || !_dlSubject) return;

    const dsId = ds.dataset_id;
    const pid = _dlSubject.participant_id;
    const dsPath = ds.path;

    document.getElementById("download-start-btn").disabled = true;
    document.getElementById("download-start-btn").textContent = "Downloading…";
    document.getElementById("download-progress-area").hidden = false;
    document.getElementById("download-progress-fill").className = "download-progress-fill indeterminate";

    const log = document.getElementById("download-log");
    const url = `/api/bids/download?dataset=${encodeURIComponent(dsPath)}&dataset_id=${encodeURIComponent(dsId)}&subject=${encodeURIComponent(pid)}`;
    const evtSource = new EventSource(url);
    _dlEventSource = evtSource;

    evtSource.addEventListener("progress", e => {
        const data = JSON.parse(e.data);
        log.textContent += data.line + "\n";
        log.scrollTop = log.scrollHeight;
    });

    evtSource.addEventListener("done", e => {
        evtSource.close();
        _dlEventSource = null;
        document.getElementById("download-progress-fill").className = "download-progress-fill";
        document.getElementById("download-progress-fill").style.width = "100%";
        document.getElementById("download-start-btn").textContent = "Done";
        log.textContent += "\nDownload complete.\n";
        log.scrollTop = log.scrollHeight;

        // Update subject status and refresh the subjects column
        if (_dlSubject) _dlSubject.downloaded = true;
        setTimeout(() => {
            closeDownloadModal();
            // Re-select the dataset to refresh badges
            if (browserState.selectedDataset) selectDataset(browserState.selectedDataset);
        }, 1200);
    });

    evtSource.addEventListener("error", e => {
        evtSource.close();
        _dlEventSource = null;
        document.getElementById("download-progress-fill").className = "download-progress-fill";
        document.getElementById("download-progress-fill").style.width = "0%";
        document.getElementById("download-start-btn").disabled = false;
        document.getElementById("download-start-btn").textContent = "Retry";
        let msg = "Connection lost";
        try { msg = JSON.parse(e.data).message; } catch (_) {}
        log.textContent += `\nError: ${msg}\n`;
        log.scrollTop = log.scrollHeight;
    });
}

function initDownloadModal() {
    document.getElementById("download-modal-close").addEventListener("click", closeDownloadModal);
    document.getElementById("download-modal").addEventListener("click", e => {
        if (e.target === e.currentTarget) closeDownloadModal();
    });
    document.getElementById("download-cancel-btn").addEventListener("click", closeDownloadModal);
    document.getElementById("download-start-btn").addEventListener("click", startDownload);
}

// ---- Exports ----------------------------------------------------------------

function getBrowserState() {
    return browserState;
}

export { initBrowser, showBrowser, hideBrowser, setDataRoot, getBrowserState };
