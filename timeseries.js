// timeseries.js — converts neutral API data to Plotly traces and renders.

const _DARK_CHANNEL_COLORS = [
    "#4e9af1", "#f1884e", "#4ef1a0", "#f14e8a", "#c4f14e",
    "#8a4ef1", "#f1d44e", "#4ef1e8", "#f14e4e", "#9af14e",
];
const _LIGHT_CHANNEL_COLORS = [
    "#0072B2", "#D55E00", "#009E73", "#CC79A7", "#56B4E9",
    "#E69F00", "#7B2D8B", "#333333", "#D55E00", "#009E73",
];

function _channelColors() {
    return document.documentElement.dataset.theme === "light"
        ? _LIGHT_CHANNEL_COLORS : _DARK_CHANNEL_COLORS;
}

function _plotColors() {
    const s = getComputedStyle(document.documentElement);
    return {
        bg:    s.getPropertyValue("--plot-bg").trim(),
        paper: s.getPropertyValue("--plot-paper").trim(),
        grid:  s.getPropertyValue("--plot-grid").trim(),
        text:  s.getPropertyValue("--plot-text").trim(),
    };
}

/**
 * Compute a y-offset scale from the RMS of each channel's values.
 * @param {number[][]} values - Array of per-channel value arrays.
 * @returns {number} Offset spacing between channels.
 */
function computeOffset(values) {
    const rmsList = values.map(ch => {
        if (ch.length === 0) return 0;
        const mean = ch.reduce((a, b) => a + b, 0) / ch.length;
        const rms = Math.sqrt(ch.reduce((s, v) => s + (v - mean) ** 2, 0) / ch.length);
        return rms;
    });
    const medRms = rmsList.slice().sort((a, b) => a - b)[Math.floor(rmsList.length / 2)] || 1;
    return medRms * 6;
}

/**
 * Build Plotly traces from neutral timeseries JSON.
 * Each channel is offset vertically by its index * offset.
 * @param {object} data - {channels, times, values}
 * @param {number} [offsetOverride] - If provided, use this spacing instead of auto.
 * @returns {{traces: object[], offset: number, layout: object}}
 */
export function buildTimeseriesTraces(data, offsetOverride) {
    const offset = offsetOverride !== undefined ? offsetOverride : computeOffset(data.values);
    const colors = _channelColors();
    const traces = data.channels.map((ch, i) => {
        const yOff = i * offset;
        return {
            x: data.times,
            y: data.values[i].map(v => v + yOff),
            type: "scattergl",
            mode: "lines",
            name: ch,
            line: { width: 0.8, color: colors[i % colors.length] },
            hovertemplate: `%{x:.3f}s  ${ch}: %{customdata:.4g}<extra></extra>`,
            customdata: data.values[i],
        };
    });

    const tickvals = data.channels.map((_, i) => i * offset);
    const ticktext = data.channels;
    const { bg, paper, grid, text } = _plotColors();

    const layout = {
        paper_bgcolor: paper,
        plot_bgcolor: bg,
        margin: { t: 8, b: 36, l: 80, r: 8 },
        xaxis: {
            color: text,
            gridcolor: grid,
            title: { text: "Time (s)", font: { size: 11 } },
        },
        yaxis: {
            color: text,
            gridcolor: grid,
            tickvals,
            ticktext,
            tickfont: { size: 10 },
            zeroline: false,
        },
        showlegend: false,
        hovermode: "x",
    };

    return { traces, offset, layout };
}

/**
 * Render (or update) the time series chart.
 * @param {HTMLElement} div
 * @param {object} data - Neutral timeseries JSON from /api/timeseries.
 * @param {object[]} annotationShapes - Plotly layout shapes for annotations.
 * @param {number} [offsetOverride]
 * @param {[number, number] | null} [xRange] - If set, pin the x-axis to this range
 *   instead of auto-ranging. Pass the current viewport range after a zoom so
 *   Plotly.react does not visually reset the view.
 * @returns {number} The offset used (for future re-renders).
 */
export function renderTimeSeries(div, data, annotationShapes, offsetOverride, xRange) {
    const { traces, offset, layout } = buildTimeseriesTraces(data, offsetOverride);
    layout.shapes = annotationShapes || [];
    if (xRange) {
        layout.xaxis.range = xRange;
        layout.xaxis.autorange = false;
    }
    Plotly.react(div, traces, layout, { responsive: true });
    return offset;
}

/**
 * Add a relayout listener for pan/zoom — calls onRangeChange(t0, t1) on zoom/pan,
 * or onRangeChange(null, null) when the user double-clicks to reset zoom.
 * Debounced to avoid firing on every frame during pan.
 * @param {HTMLElement} div
 * @param {function} onRangeChange
 */
export function onZoomPan(div, onRangeChange) {
    let timer = null;
    div.on("plotly_relayout", (eventData) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            // Double-click reset: autorange fires instead of explicit range
            if (eventData["xaxis.autorange"] === true) {
                onRangeChange(null, null);
                return;
            }
            const t0 = eventData["xaxis.range[0]"];
            const t1 = eventData["xaxis.range[1]"];
            if (t0 !== undefined && t1 !== undefined) {
                onRangeChange(parseFloat(t0), parseFloat(t1));
            }
        }, 150);
    });
}
