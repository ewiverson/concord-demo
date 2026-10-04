// app.js — main controller: wires UI, sidebar, montage, panels, and chart rendering.

import { renderTimeSeries, onZoomPan } from "./timeseries.js";
import { renderPSD, renderSpectrogram } from "./spectral.js";
import { renderLineLength, renderHjorth, renderBandPower } from "./metrics.js";
import { renderBrain3DPanel } from "./brain.js";
import {
    registerPanel,
    applyLayout,
    rerenderAll,
    loadLayout,
    saveLayout,
    initLayoutModal,
} from "./panels.js";
import { initServerSettings } from "./server_settings.js";
import { initFontScale } from "./fontscale.js";
import { initBrowser, showBrowser, hideBrowser, setDataRoot, getBrowserState } from "./browser.js";

// ---- App state --------------------------------------------------------------
const state = {
    info: null,
    eventShapes: [],
    channels: [],
    channelMetadata: {},
    spectChannel: null,
    montage: "monopolar",
    notchMode: "none",
    viewStart: null,
    viewEnd: null,
    tsOffset: undefined,
    activeMetric: "line_length",
    datasetName: null,
    subjectId: null,
    sessionId: null,
    recordingLabel: null,
};

const _zoomHandledDivs = new WeakSet();

// ---- Helpers ----------------------------------------------------------------

function setStatus(msg, isError = false) {
    const el = document.getElementById("status-msg");
    el.textContent = msg;
    el.style.color = isError ? "var(--error)" : "var(--text-muted)";
}

async function apiFetch(url) {
    const resp = await fetch(url);
    if (!resp.ok) {
        const body = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(body.detail || resp.statusText);
    }
    return resp.json();
}

function buildEventShapes(events) {
    const color = getComputedStyle(document.documentElement).getPropertyValue("--event").trim();
    const labelFont = { size: 9, color };
    const rgb = color.replace("#", "").match(/../g).map(h => parseInt(h, 16)).join(",");
    const fill = `rgba(${rgb},0.08)`;
    return events.map(a => {
        const isPoint = !a.duration || a.duration < 0.5;
        if (isPoint) {
            return {
                type: "line", xref: "x", yref: "paper",
                x0: a.onset, x1: a.onset, y0: 0, y1: 1,
                line: { color, width: 2, dash: "dot" },
                label: { text: a.label, font: labelFont, yanchor: "top" },
            };
        }
        return {
            type: "rect", xref: "x", yref: "paper",
            x0: a.onset, x1: a.onset + a.duration, y0: 0, y1: 1,
            fillcolor: fill,
            line: { color, width: 1.5 },
            label: { text: a.label, font: labelFont, yanchor: "top" },
        };
    });
}

// ---- Render functions (accept div param) ------------------------------------

async function renderTS(div) {
    if (!state.channels.length) {
        div.innerHTML = '<div class="placeholder">Select channels to view.</div>';
        return;
    }
    const chParam = encodeURIComponent(state.channels.join(","));
    const tParams = state.viewStart !== null
        ? `&t_start=${state.viewStart}&t_end=${state.viewEnd}`
        : "";
    try {
        const data = await apiFetch(`/api/timeseries?channels=${chParam}${tParams}&max_points=1000`);
        const xRange = state.viewStart !== null ? [state.viewStart, state.viewEnd] : null;
        state.tsOffset = renderTimeSeries(div, data, state.eventShapes, state.tsOffset, xRange);

        if (!_zoomHandledDivs.has(div)) {
            onZoomPan(div, (t0, t1) => {
                state.viewStart = t0;
                state.viewEnd = t1;
                renderTS(div);
            });
            _zoomHandledDivs.add(div);
        }
    } catch (e) {
        setStatus(`Time series error: ${e.message}`, true);
    }
}

async function renderPSDPanel(div) {
    if (!state.channels.length) {
        div.innerHTML = '<div class="placeholder">—</div>';
        return;
    }
    const chParam = encodeURIComponent(state.channels.join(","));
    try {
        const data = await apiFetch(`/api/psd?channels=${chParam}&fmin=1&fmax=150`);
        renderPSD(div, data);
    } catch (e) {
        setStatus(`PSD error: ${e.message}`, true);
    }
}

async function renderSpectPanel(div) {
    // Move channel select into the panel header (once per panel instantiation).
    const header = div.previousElementSibling;
    if (header && header.classList.contains("panel-header")) {
        const sel = document.getElementById("spect-channel-select");
        if (sel && !header.contains(sel)) {
            sel.removeAttribute("hidden");
            header.appendChild(sel);
        }
    }

    if (!state.spectChannel) {
        div.innerHTML = '<div class="placeholder">—</div>';
        return;
    }
    try {
        const data = await apiFetch(
            `/api/spectrogram?channel=${encodeURIComponent(state.spectChannel)}&fmin=1&fmax=150`
        );
        renderSpectrogram(div, data, state.spectChannel);
    } catch (e) {
        setStatus(`Spectrogram error: ${e.message}`, true);
    }
}

async function renderMetricPanel(div, metric) {
    try {
        if (metric === "line_length") {
            const data = await apiFetch("/api/metric/line_length?window_s=1");
            renderLineLength(div, data);
        } else if (metric === "hjorth") {
            const data = await apiFetch("/api/metric/hjorth?window_s=1");
            renderHjorth(div, data, 0);
        } else if (metric === "band_power") {
            const data = await apiFetch("/api/metric/band_power?window_s=4");
            renderBandPower(div, data);
        }
    } catch (e) {
        setStatus(`Metric error: ${e.message}`, true);
    }
}

// ---- Panel registry ---------------------------------------------------------

registerPanel("timeseries",  div => renderTS(div));
registerPanel("psd",         div => renderPSDPanel(div));
registerPanel("spectrogram", div => renderSpectPanel(div));
registerPanel("line_length", div => renderMetricPanel(div, "line_length"));
registerPanel("hjorth",      div => renderMetricPanel(div, "hjorth"));
registerPanel("band_power",  div => renderMetricPanel(div, "band_power"));
registerPanel("brain3d",     div => renderBrain3DPanel(div));

// ---- Sidebar ----------------------------------------------------------------

function parsePrefix(name) {
    const m = name.match(/^(.+?)\d+$/);
    return m ? m[1] : name;
}

function getStatusClass(meta) {
    if (!meta) return "status-unknown";
    const desc = (meta.status_description || "").toLowerCase();
    const status = (meta.status || "good").toLowerCase();
    if (desc.includes("soz")) return "status-soz";
    if (desc.includes("resect")) return "status-resect";
    if (status === "bad") return "status-bad";
    if (status === "good") return "status-good";
    return "status-unknown";
}

function buildSidebar(channels, channelMetadata) {
    state.channels = [...channels];
    state.channelMetadata = channelMetadata || {};

    const list = document.getElementById("channel-list");
    list.innerHTML = "";

    // Group by electrode prefix
    const groups = new Map();
    for (const ch of channels) {
        const prefix = parsePrefix(ch);
        if (!groups.has(prefix)) groups.set(prefix, []);
        groups.get(prefix).push(ch);
    }

    for (const [prefix, chs] of groups) {
        const groupDiv = document.createElement("div");
        groupDiv.className = "ch-group";

        const headerDiv = document.createElement("div");
        headerDiv.className = "ch-group-header";

        const toggle = document.createElement("span");
        toggle.className = "ch-group-toggle";
        toggle.textContent = "▾";

        const labelSpan = document.createElement("span");
        labelSpan.className = "ch-group-label";
        labelSpan.textContent = `${prefix} (${chs.length})`;

        const dotsDiv = document.createElement("div");
        dotsDiv.className = "ch-group-dots";
        chs.forEach(ch => {
            const dot = document.createElement("span");
            dot.className = "status-dot " + getStatusClass(channelMetadata[ch]);
            dotsDiv.appendChild(dot);
        });

        headerDiv.appendChild(toggle);
        headerDiv.appendChild(labelSpan);
        headerDiv.appendChild(dotsDiv);

        const contactsDiv = document.createElement("div");
        contactsDiv.className = "ch-contacts";

        // Group header toggles all contacts
        headerDiv.addEventListener("click", e => {
            if (e.target === toggle) return; // handled below
            const allSel = chs.every(ch => state.channels.includes(ch));
            if (allSel) {
                state.channels = state.channels.filter(ch => !chs.includes(ch));
                if (state.channels.length === 0) state.channels = [...channels]; // never empty
            } else {
                state.channels = [...new Set([...state.channels, ...chs])];
            }
            updateSidebarSelection();
            onChannelSelectionChange();
        });

        toggle.addEventListener("click", e => {
            e.stopPropagation();
            const collapsed = contactsDiv.style.display === "none";
            contactsDiv.style.display = collapsed ? "" : "none";
            toggle.textContent = collapsed ? "▾" : "▸";
        });

        for (const ch of chs) {
            const contactDiv = document.createElement("div");
            contactDiv.className = "ch-contact";
            contactDiv.dataset.channel = ch;

            const dot = document.createElement("span");
            dot.className = "status-dot " + getStatusClass(channelMetadata[ch]);

            const nameSpan = document.createElement("span");
            nameSpan.textContent = ch;

            const meta = channelMetadata[ch] || {};
            const descSpan = document.createElement("span");
            descSpan.className = "ch-status-desc";
            if (meta.status_description) {
                descSpan.textContent = meta.status_description.toUpperCase();
            }

            contactDiv.appendChild(dot);
            contactDiv.appendChild(nameSpan);
            contactDiv.appendChild(descSpan);

            contactDiv.addEventListener("click", () => {
                const idx = state.channels.indexOf(ch);
                if (idx >= 0) {
                    if (state.channels.length > 1) state.channels.splice(idx, 1);
                } else {
                    state.channels.push(ch);
                }
                updateSidebarSelection();
                onChannelSelectionChange();
            });

            contactsDiv.appendChild(contactDiv);
        }

        groupDiv.appendChild(headerDiv);
        groupDiv.appendChild(contactsDiv);
        list.appendChild(groupDiv);
    }

    // Populate spectrogram channel selector
    const spectSel = document.getElementById("spect-channel-select");
    spectSel.innerHTML = "";
    const sozDefault = channels.find(ch => {
        const meta = state.channelMetadata[ch];
        return meta && (meta.status_description || "").toLowerCase().includes("soz");
    }) || channels[0] || null;
    channels.forEach(ch => {
        const opt = document.createElement("option");
        opt.value = ch;
        opt.textContent = ch;
        if (ch === sozDefault) opt.selected = true;
        spectSel.appendChild(opt);
    });
    state.spectChannel = sozDefault;

    updateSidebarSelection();
}

function updateSidebarSelection() {
    document.querySelectorAll(".ch-contact").forEach(el => {
        el.classList.toggle("selected", state.channels.includes(el.dataset.channel));
    });
}

function applySidebarFilter(filter) {
    document.querySelectorAll(".ch-contact").forEach(el => {
        const ch = el.dataset.channel;
        const meta = state.channelMetadata[ch] || {};
        const desc = (meta.status_description || "").toLowerCase();
        const status = (meta.status || "good").toLowerCase();
        let visible = false;
        if (filter === "all") {
            visible = true;
        } else if (filter === "soz") {
            visible = desc.includes("soz");
        } else if (filter === "good") {
            visible = status === "good" && !desc.includes("soz") && !desc.includes("resect");
        }
        el.style.display = visible ? "" : "none";
    });

    // Update selected channels to match visible contacts
    if (filter !== "all") {
        const visibleChannels = [];
        document.querySelectorAll(".ch-contact:not([style*='display: none'])").forEach(el => {
            visibleChannels.push(el.dataset.channel);
        });
        if (visibleChannels.length > 0) {
            state.channels = visibleChannels;
            updateSidebarSelection();
            onChannelSelectionChange();
        }
    }

    // Hide groups where all contacts are hidden
    document.querySelectorAll(".ch-group").forEach(group => {
        const anyVisible = group.querySelector(".ch-contact:not([style*='display: none'])");
        group.style.display = anyVisible ? "" : "none";
    });
}

function onChannelSelectionChange() {
    state.tsOffset = undefined;
    // Re-render time series and PSD panels that are currently in the layout
    document.querySelectorAll('.panel-body[data-panel-type="timeseries"]').forEach(div => renderTS(div));
    document.querySelectorAll('.panel-body[data-panel-type="psd"]').forEach(div => renderPSDPanel(div));
}

// ---- Breadcrumb -------------------------------------------------------------

function updateBreadcrumb() {
    const bc = document.getElementById("recording-breadcrumb");
    bc.innerHTML = "";

    const parts = [
        { label: state.datasetName, level: "dataset" },
        { label: state.subjectId ? state.subjectId.replace(/^sub-/, "") : null, level: "subject" },
        { label: state.sessionId ? state.sessionId.replace(/^ses-/, "") : null, level: "session" },
        { label: state.recordingLabel, level: "recording" },
    ].filter(p => p.label);

    parts.forEach((part, i) => {
        if (i > 0) {
            const sep = document.createElement("span");
            sep.className = "breadcrumb-sep";
            sep.textContent = " / ";
            bc.appendChild(sep);
        }
        const span = document.createElement("span");
        span.className = "breadcrumb-segment";
        span.textContent = part.label;
        if (i < parts.length - 1) {
            span.classList.add("breadcrumb-clickable");
            span.addEventListener("click", () => showBrowser());
        }
        bc.appendChild(span);
    });
}

async function loadRecordingFromBrowser(rec, bState) {
    state.datasetName = bState.selectedDataset ? bState.selectedDataset.name : null;
    state.subjectId = bState.selectedSubject ? bState.selectedSubject.participant_id : null;
    state.sessionId = bState.selectedSession ? bState.selectedSession.session_id : null;
    state.recordingLabel = [rec.task, rec.run ? `run-${rec.run}` : ""].filter(Boolean).join(" ") || rec.filename;

    state.tsOffset = undefined;
    state.viewStart = null;
    state.viewEnd = null;

    setStatus("Loading…");

    try {
        const resp = await fetch("/api/load", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: rec.path }),
        });
        if (!resp.ok) {
            const body = await resp.json().catch(() => ({ detail: resp.statusText }));
            throw new Error(body.detail || resp.statusText);
        }
        const info = await resp.json();
        showAnalysisView(info);
    } catch (e) {
        setStatus(`Load failed: ${e.message}`, true);
    }
}

function showAnalysisView(info) {
    state.info = info;
    state.montage = info.montage;
    state.notchMode = "none";
    state.eventShapes = buildEventShapes(info.events ?? []);

    // Reset montage buttons to monopolar
    document.querySelectorAll(".montage-btn").forEach(b => {
        b.classList.toggle("active", b.dataset.montage === "monopolar");
    });

    // Reset and enable notch filter dropdown
    const notchSel = document.getElementById("notch-select");
    notchSel.value = "none";
    notchSel.removeAttribute("disabled");

    buildSidebar(info.channels, info.channel_metadata || {});
    setStatus(`Loaded: ${info.n_channels} ch, ${info.fs} Hz, ${info.duration.toFixed(1)}s`);

    updateBreadcrumb();
    hideBrowser();
    applyLayout(loadLayout());
}

// ---- Montage switching ------------------------------------------------------

async function switchMontage(montage) {
    if (montage === state.montage) return;
    try {
        setStatus(`Switching to ${montage}…`);
        const resp = await fetch("/api/montage", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ montage }),
        });
        if (!resp.ok) {
            const body = await resp.json().catch(() => ({ detail: resp.statusText }));
            throw new Error(body.detail || resp.statusText);
        }
        const data = await resp.json();
        state.montage = montage;
        state.tsOffset = undefined;
        state.viewStart = null;
        state.viewEnd = null;

        buildSidebar(data.channels, data.channel_metadata);
        setStatus(`Montage: ${montage}`);
        applyLayout(loadLayout());
    } catch (e) {
        setStatus(`Montage error: ${e.message}`, true);
    }
}

// ---- Notch filter switching -------------------------------------------------

async function switchNotch(mode) {
    if (mode === state.notchMode) return;
    try {
        const label = { none: "No Filter", notch50: "50 Hz Notch", notch60: "60 Hz Notch" }[mode] ?? mode;
        setStatus(`Applying ${label}…`);
        const resp = await fetch("/api/notch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode }),
        });
        if (!resp.ok) {
            const body = await resp.json().catch(() => ({ detail: resp.statusText }));
            throw new Error(body.detail || resp.statusText);
        }
        state.notchMode = mode;
        state.tsOffset = undefined;
        state.viewStart = null;
        state.viewEnd = null;
        setStatus(`Filter: ${label}`);
        applyLayout(loadLayout());
    } catch (e) {
        setStatus(`Filter error: ${e.message}`, true);
        // Revert select to current state
        document.getElementById("notch-select").value = state.notchMode;
    }
}

// ---- DOM refs & event wiring ------------------------------------------------

// Browse button — return to browser view
document.getElementById("browse-btn").addEventListener("click", () => showBrowser());

// Sidebar collapse toggle
const sidebarToggle = document.getElementById("sidebar-toggle");
const sidebar = document.getElementById("sidebar");
sidebarToggle.addEventListener("click", () => {
    const collapsed = sidebar.classList.toggle("collapsed");
    sidebarToggle.textContent = collapsed ? "▶" : "◀";
});

// Montage buttons
document.querySelectorAll(".montage-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".montage-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        switchMontage(btn.dataset.montage);
    });
});

// Filter buttons
document.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        applySidebarFilter(btn.dataset.filter);
    });
});

// Notch filter dropdown
document.getElementById("notch-select").addEventListener("change", e => {
    switchNotch(e.target.value);
});

// Spectrogram channel selector
document.getElementById("spect-channel-select").addEventListener("change", e => {
    state.spectChannel = e.target.value;
    document.querySelectorAll('.panel-body[data-panel-type="spectrogram"]').forEach(div => renderSpectPanel(div));
});

// Layout modal
initLayoutModal();
initServerSettings();
initFontScale(rerenderAll);

// ---- Init -------------------------------------------------------------------

// Initialize browser and fetch data root from server
initBrowser(loadRecordingFromBrowser);

// Auto-detect data root from server if not already saved
(async () => {
    try {
        const data = await apiFetch("/api/bids/datasets");
        if (data.root && !localStorage.getItem("concord_dataset_root")) {
            setDataRoot(data.root);
        }
    } catch (_) {}
})();
