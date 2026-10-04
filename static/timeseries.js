// timeseries.js — converts neutral API data to Plotly traces and renders.

import { fs } from "./fontscale.js";

// Clinical EEG convention: every trace in ink. Channels are told apart by position and label, not color.
function _plotColors() {
    const s = getComputedStyle(document.documentElement);
    const v = name => s.getPropertyValue(name).trim();
    return {
        bg: v("--plot-bg"), paper: v("--plot-paper"), text: v("--plot-text"), ink: v("--text"),
        gridMajor: v("--eeg-grid-major"), gridMinor: v("--eeg-grid-minor"),
    };
}

// Largest value in `steps` that does not exceed `target` (smallest step if none do).
function _niceStep(target, steps) {
    let best = steps[0];
    for (const s of steps) if (s <= target) best = s;
    return best;
}

const _AMP_STEPS_UV = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
const _TIME_STEPS_S = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 60];

/**
 * Calibration mark in the right margin: an L of an amplitude bar and a time bar, labelled.
 * Values are volts. Bar lengths are "nice" numbers sized to the current spacing and time span.
 */
function _calibration(offset, span, ink) {
    const ampUV = _niceStep((offset * 1e6) / 2, _AMP_STEPS_UV);
    const timeS = _niceStep(span * 0.06, _TIME_STEPS_S);
    const x0 = 1.012;
    const x1 = x0 + timeS / span;
    const line = { color: ink, width: 1.5 };
    const label = (text, x, y, extra) => ({
        xref: "paper", yref: "y", x, y, text, showarrow: false,
        font: { family: "inherit", size: fs(10), color: ink }, ...extra,
    });
    return {
        shapes: [
            { type: "line", xref: "paper", yref: "y", x0, x1: x0, y0: 0, y1: ampUV * 1e-6, line },
            { type: "line", xref: "paper", yref: "y", x0, x1, y0: 0, y1: 0, line },
        ],
        annotations: [
            label(`${ampUV >= 1000 ? ampUV / 1000 + " mV" : ampUV + " µV"}`, x0, (ampUV * 1e-6) / 2, { xanchor: "left", xshift: 7 }),
            label(`${timeS} s`, (x0 + x1) / 2, 0, { xanchor: "center", yanchor: "top", yshift: -5 }),
        ],
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
 * @param {[number, number] | null} [xRange] - Visible time range (sets grid spacing and calibration bar).
 * @returns {{traces: object[], offset: number, layout: object}}
 */
export function buildTimeseriesTraces(data, offsetOverride, xRange) {
    const offset = offsetOverride !== undefined ? offsetOverride : computeOffset(data.values);
    const { bg, paper, text, ink, gridMajor, gridMinor } = _plotColors();
    const traces = data.channels.map((ch, i) => {
        const yOff = i * offset;
        return {
            x: data.times,
            y: data.values[i].map(v => v + yOff),
            type: "scattergl",
            mode: "lines",
            name: ch,
            line: { width: 1, color: ink },
            hovertemplate: `%{x:.3f}s  ${ch}: %{customdata:.4g}<extra></extra>`,
            customdata: data.values[i],
        };
    });

    const tickvals = data.channels.map((_, i) => i * offset);
    const t0 = xRange ? xRange[0] : data.times[0];
    const t1 = xRange ? xRange[1] : data.times[data.times.length - 1];
    const span = Math.max(t1 - t0, 1e-6);
    const major = _niceStep(span / 8, _TIME_STEPS_S);
    const cal = _calibration(offset, span, ink);

    const layout = {
        paper_bgcolor: paper,
        plot_bgcolor: bg,
        margin: { t: 8, b: 36, l: 64, r: 78 },
        xaxis: {
            color: text,
            showgrid: true, gridcolor: gridMajor, gridwidth: 1, dtick: major, zeroline: false,
            minor: { showgrid: true, gridcolor: gridMinor, gridwidth: 0.5, dtick: major / 5 },
            title: { text: "Time (s)", font: { size: fs(11) } },
        },
        yaxis: {
            color: ink,
            showgrid: false,
            tickvals,
            ticktext: data.channels,
            tickfont: { size: fs(10) },
            zeroline: false,
        },
        shapes: cal.shapes,
        annotations: cal.annotations,
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
    const { traces, offset, layout } = buildTimeseriesTraces(data, offsetOverride, xRange);
    layout.shapes = [...layout.shapes, ...(annotationShapes || [])];
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
