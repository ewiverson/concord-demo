// brain.js — 3D electrode scatter with metric-colored spheres and time scrubber.
//
// Two-resolution strategy:
//   Scrub data  (window_s=1.0) — fetched on panel open; fast load, ~1 frame/s
//   Play data   (window_s=0.25) — fetched lazily on first ▶ press; 4× finer

const SCRUB_WINDOW_S = 1.0;
const PLAY_WINDOW_S  = 0.25;

const BRAIN_METRICS = [
    { id: "line_length",           label: "Line Length",         metric: "line_length", component: null },
    { id: "hjorth_activity",       label: "Hjorth Activity",     metric: "hjorth",      component: "activity" },
    { id: "hjorth_mobility",       label: "Hjorth Mobility",     metric: "hjorth",      component: "mobility" },
    { id: "band_power_high_gamma", label: "Band Power (High γ)", metric: "band_power",  component: "high_gamma" },
    { id: "band_power_gamma",      label: "Band Power (γ)",      metric: "band_power",  component: "gamma" },
    { id: "band_power_beta",       label: "Band Power (β)",      metric: "band_power",  component: "beta" },
];

async function _apiFetch(url) {
    const resp = await fetch(url);
    if (!resp.ok) {
        const body = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(body.detail || resp.statusText);
    }
    return resp.json();
}

function _metricUrl(chosen, window_s) {
    let url = `/api/brain_timeseries?metric=${chosen.metric}&window_s=${window_s}`;
    if (chosen.component) url += `&component=${chosen.component}`;
    return url;
}

// ---- Color helpers ----------------------------------------------------------

/**
 * Compute global [cmin, cmax] from a metric dataset over all channels and times.
 * Ensures cmin < cmax so Plotly colorscale is always well-defined.
 */
function _colorRange(metricData) {
    let lo = Infinity, hi = -Infinity;
    for (const chVals of metricData.values) {
        for (const v of chVals) {
            if (v != null && isFinite(v)) {
                if (v < lo) lo = v;
                if (v > hi) hi = v;
            }
        }
    }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (lo === hi) { lo -= Math.abs(lo) * 0.1 || 0.5; hi += Math.abs(hi) * 0.1 || 0.5; }
    return [lo, hi];
}

/**
 * Build a colors array (one entry per electrode) for a given time index.
 * Null / missing values are replaced by `fallback` so Plotly never sees null
 * (which renders scatter3d markers as transparent).
 */
function _colorsAtTime(electrodes, metricData, tIdx, fallback) {
    const valMap = {};
    metricData.channels.forEach((ch, i) => {
        const vals = metricData.values[i];
        const v = vals[Math.min(tIdx, vals.length - 1)];
        valMap[ch] = (v != null && isFinite(v)) ? v : null;
    });
    return electrodes.electrodes.map(e => {
        const v = valMap[e.name];
        return (v !== undefined && v !== null) ? v : fallback;
    });
}

// ---- Brain surface ----------------------------------------------------------

/**
 * Build a transparent ellipsoid surface trace approximating the MNI brain.
 * Gives spatial context for electrode positions without requiring mesh data.
 */
function _brainSurface() {
    const N = 28;
    const cx = 0, cy = -10, cz = 30;  // approximate MNI brain center
    const rx = 70, ry = 85, rz = 65;  // approximate half-axes (mm)
    const x = [], y = [], z = [];
    for (let i = 0; i < N; i++) {
        const theta = Math.PI * i / (N - 1);
        const xr = [], yr = [], zr = [];
        for (let j = 0; j < N; j++) {
            const phi = 2 * Math.PI * j / (N - 1);
            xr.push(cx + rx * Math.sin(theta) * Math.cos(phi));
            yr.push(cy + ry * Math.sin(theta) * Math.sin(phi));
            zr.push(cz + rz * Math.cos(theta));
        }
        x.push(xr); y.push(yr); z.push(zr);
    }
    return {
        type: "surface",
        x, y, z,
        colorscale: [[0, "rgba(150,130,110,0.10)"], [1, "rgba(150,130,110,0.10)"]],
        showscale: false,
        hoverinfo: "skip",
        lighting: { ambient: 0.9, diffuse: 0.2 },
        contours: { x: { highlight: false }, y: { highlight: false }, z: { highlight: false } },
    };
}

// ---- Plotly helpers ---------------------------------------------------------

function _plotColors() {
    const s = getComputedStyle(document.documentElement);
    return {
        bg:    s.getPropertyValue("--plot-bg").trim(),
        paper: s.getPropertyValue("--plot-paper").trim(),
        grid:  s.getPropertyValue("--plot-grid").trim(),
        text:  s.getPropertyValue("--plot-text").trim(),
    };
}

function _render(electrodes, metricData, cmin, cmax, plotDiv, timeLabel) {
    const elecs = electrodes.electrodes;
    if (!elecs.length) {
        plotDiv.innerHTML = `<div style="color:var(--text-muted);padding:16px;font-size:12px">No electrode positions available.</div>`;
        return;
    }

    timeLabel.textContent = `t = ${(metricData.times[0] ?? 0).toFixed(1)}s`;
    const colors = _colorsAtTime(electrodes, metricData, 0, cmin);

    const sizes = elecs.map(e => {
        const desc = (e.status_description || "").toLowerCase();
        return desc.includes("soz") ? 10 : 7;
    });

    const texts = elecs.map((e, i) => {
        const c = colors[i];
        return `${e.name}<br>status: ${e.status || "—"}<br>${c != null ? c.toFixed(4) : "—"}`;
    });

    const trace = {
        type: "scatter3d",
        mode: "markers",
        x: elecs.map(e => e.x),
        y: elecs.map(e => e.y),
        z: elecs.map(e => e.z),
        text: texts,
        hovertemplate: "%{text}<extra></extra>",
        marker: {
            size: sizes,
            color: colors,
            colorscale: "Plasma",
            showscale: true,
            colorbar: { thickness: 12, len: 0.7, tickfont: { size: 9 } },
            cmin,
            cmax,
        },
    };

    const { bg, paper, grid, text } = _plotColors();
    const layout = {
        paper_bgcolor: paper,
        scene: {
            bgcolor: bg,
            xaxis: { color: text, gridcolor: grid },
            yaxis: { color: text, gridcolor: grid },
            zaxis: { color: text, gridcolor: grid },
        },
        margin: { t: 4, b: 4, l: 4, r: 4 },
        showlegend: false,
    };

    Plotly.react(plotDiv, [_brainSurface(), trace], layout, { responsive: true });
}

function _updateColors(plotDiv, electrodes, metricData, tIdx, cmin, cmax) {
    const colors = _colorsAtTime(electrodes, metricData, tIdx, cmin);
    // Always include cmin/cmax so the colorscale doesn't auto-rescale per frame
    Plotly.restyle(plotDiv, {
        "marker.color": [colors],
        "marker.cmin": cmin,
        "marker.cmax": cmax,
    }, [1]);
}

// ---- Main panel -------------------------------------------------------------

/**
 * Render a 3D brain map panel inside div.
 * @param {HTMLElement} div - The panel-body element.
 */
export async function renderBrain3DPanel(div) {
    div.innerHTML = "";
    div.style.display = "flex";
    div.style.flexDirection = "column";

    const metricSel = document.createElement("select");
    metricSel.className = "brain-metric-select";
    BRAIN_METRICS.forEach(m => {
        const opt = document.createElement("option");
        opt.value = m.id;
        opt.textContent = m.label;
        metricSel.appendChild(opt);
    });

    // Move metric label + select into the panel header.
    const header = div.previousElementSibling;
    if (header && header.classList.contains("panel-header")) {
        const metricLabel = document.createElement("span");
        metricLabel.textContent = "Metric:";
        metricLabel.style.cssText = "font-size:11px;color:var(--text-muted);white-space:nowrap";
        header.appendChild(metricLabel);
        header.appendChild(metricSel);
    }

    // 3D plot container
    const plotDiv = document.createElement("div");
    plotDiv.style.flex = "1";
    plotDiv.style.minHeight = "0";
    div.appendChild(plotDiv);

    // Scrubber + playback row
    const scrubRow = document.createElement("div");
    scrubRow.className = "brain-scrub-row";

    const playBtn = document.createElement("button");
    playBtn.className = "brain-play-btn";
    playBtn.textContent = "▶";
    playBtn.title = "Play (fetches 0.25s windows for higher temporal resolution on first press)";

    const scrubber = document.createElement("input");
    scrubber.type = "range";
    scrubber.min = 0;
    scrubber.max = 0;
    scrubber.value = 0;
    scrubber.className = "brain-scrubber";

    const timeLabel = document.createElement("span");
    timeLabel.className = "brain-time-label";
    timeLabel.textContent = "t = —";

    const speedSel = document.createElement("select");
    speedSel.className = "brain-speed-select";
    [["0.2×", 0.2], ["0.5×", 0.5], ["1×", 1.0]].forEach(([label, val]) => {
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = label;
        if (val === 1.0) opt.selected = true;
        speedSel.appendChild(opt);
    });

    const resLabel = document.createElement("span");
    resLabel.style.cssText = "font-size:10px;color:var(--text-muted);margin-left:auto;white-space:nowrap";

    scrubRow.appendChild(playBtn);
    scrubRow.appendChild(scrubber);
    scrubRow.appendChild(timeLabel);
    scrubRow.appendChild(speedSel);
    scrubRow.appendChild(resLabel);
    div.appendChild(scrubRow);

    // ---- Panel state ---------------------------------------------------------
    let cachedElectrodes = null;
    let scrubData  = null;  // coarse data + its color range
    let scrubRange = [0, 1];
    let playData   = null;  // hi-res data + its color range
    let playRange  = [0, 1];
    let _playTimer = null;
    let _playFetching = false;

    // ---- Playback ------------------------------------------------------------

    function _stopPlayback() {
        if (_playTimer !== null) {
            clearInterval(_playTimer);
            _playTimer = null;
        }
        playBtn.textContent = "▶";
    }

    function _startTimer(data, [cmin, cmax]) {
        const nTimes = data.times.length;
        if (nTimes < 2) { resLabel.textContent = "single frame"; return; }

        const windowS = data.times[1] - data.times[0];
        const speed = parseFloat(speedSel.value);
        const intervalMs = (windowS / speed) * 1000;

        // Map current scrubber position into the hi-res time axis
        const currentTime = scrubData ? (scrubData.times[parseInt(scrubber.value)] ?? 0) : 0;
        let tIdx = data.times.findIndex(t => t >= currentTime);
        if (tIdx < 0) tIdx = 0;

        scrubber.max = nTimes - 1;
        scrubber.value = tIdx;
        playBtn.textContent = "⏸";
        resLabel.textContent = `${windowS.toFixed(2)}s/frame`;

        _playTimer = setInterval(() => {
            tIdx = (tIdx + 1) % nTimes;
            scrubber.value = tIdx;
            timeLabel.textContent = `t = ${(data.times[tIdx] ?? 0).toFixed(2)}s`;
            if (cachedElectrodes) _updateColors(plotDiv, cachedElectrodes, data, tIdx, cmin, cmax);
        }, intervalMs);
    }

    async function _startPlayback() {
        if (_playFetching) return;

        if (playData) {
            _startTimer(playData, playRange);
            return;
        }

        _playFetching = true;
        playBtn.textContent = "…";
        playBtn.disabled = true;
        resLabel.textContent = "loading hi-res…";
        try {
            const chosen = BRAIN_METRICS.find(m => m.id === metricSel.value) || BRAIN_METRICS[0];
            playData = await _apiFetch(_metricUrl(chosen, PLAY_WINDOW_S));
            playRange = _colorRange(playData);
        } catch (e) {
            resLabel.textContent = "hi-res failed";
            playBtn.textContent = "▶";
            playBtn.disabled = false;
            _playFetching = false;
            return;
        }
        playBtn.disabled = false;
        _playFetching = false;
        _startTimer(playData, playRange);
    }

    playBtn.addEventListener("click", () => {
        if (_playTimer !== null) {
            _stopPlayback();
            // Restore scrubber to coarse range
            if (scrubData) {
                scrubber.max = scrubData.times.length - 1;
                resLabel.textContent = "";
            }
        } else {
            _startPlayback();
        }
    });

    speedSel.addEventListener("change", () => {
        if (_playTimer !== null) {
            _stopPlayback();
            _startPlayback();
        }
    });

    // Scrubber always uses coarse data (not active during timer-driven playback)
    scrubber.addEventListener("input", () => {
        if (_playTimer !== null) return;
        if (!cachedElectrodes || !scrubData) return;
        const tIdx = parseInt(scrubber.value);
        timeLabel.textContent = `t = ${(scrubData.times[tIdx] ?? 0).toFixed(1)}s`;
        _updateColors(plotDiv, cachedElectrodes, scrubData, tIdx, ...scrubRange);
    });

    // ---- Load ----------------------------------------------------------------

    async function loadAndRender() {
        _stopPlayback();
        playData = null;
        resLabel.textContent = "";
        try {
            if (!cachedElectrodes) {
                cachedElectrodes = await _apiFetch("/api/electrode_positions");
            }
            const chosen = BRAIN_METRICS.find(m => m.id === metricSel.value) || BRAIN_METRICS[0];
            scrubData = await _apiFetch(_metricUrl(chosen, SCRUB_WINDOW_S));
            scrubRange = _colorRange(scrubData);
            scrubber.max = Math.max(0, scrubData.times.length - 1);
            scrubber.value = 0;
            _render(cachedElectrodes, scrubData, ...scrubRange, plotDiv, timeLabel);
        } catch (e) {
            plotDiv.innerHTML = `<div style="color:#e88;padding:16px;font-size:12px">Brain error: ${e.message}</div>`;
        }
    }

    metricSel.addEventListener("change", () => loadAndRender());

    await loadAndRender();
}
