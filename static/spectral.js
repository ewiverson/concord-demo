// spectral.js — PSD overlay + single-channel spectrogram rendering.

import { fs } from "./fontscale.js";

// Trace palette: Okabe-Ito, colorblind-safe, publication-standard
const _LINE_COLORS = [
    "#0072B2", "#D55E00", "#009E73", "#CC79A7",
    "#56B4E9", "#E69F00", "#7B2D8B", "#333333",
];

function _plotColors() {
    const s = getComputedStyle(document.documentElement);
    return {
        bg:    s.getPropertyValue("--plot-bg").trim(),
        paper: s.getPropertyValue("--plot-paper").trim(),
        grid:  s.getPropertyValue("--plot-grid").trim(),
        text:  s.getPropertyValue("--plot-text").trim(),
        lines: _LINE_COLORS,
    };
}

/**
 * Render PSD overlay chart from neutral JSON.
 * @param {HTMLElement} div
 * @param {object} data - {channels, freqs, power}
 */
export function renderPSD(div, data) {
    // Skip DC bin (freq=0) — incompatible with log x-axis.
    const startIdx = data.freqs.length > 0 && data.freqs[0] === 0 ? 1 : 0;
    const freqs = data.freqs.slice(startIdx);

    const { bg, paper, grid, text, lines } = _plotColors();

    const traces = data.channels.map((ch, i) => ({
        x: freqs,
        y: data.power[i].slice(startIdx),
        type: "scatter",
        mode: "lines",
        name: ch,
        line: { width: 1, color: lines[i % lines.length] },
    }));

    const layout = {
        paper_bgcolor: paper,
        plot_bgcolor: bg,
        margin: { t: 8, b: 40, l: 60, r: 16 },
        font: { color: text, size: fs(11) },
        xaxis: {
            gridcolor: grid, color: text,
            type: "log",
            title: { text: "Frequency (Hz)", font: { size: fs(11) } },
        },
        yaxis: {
            gridcolor: grid, color: text,
            type: "log",
            title: { text: "Power (V²/Hz)", font: { size: fs(11) } },
        },
        showlegend: data.channels.length <= 8,
        legend: { font: { size: fs(9) }, bgcolor: "transparent" },
        hovermode: "x unified",
    };

    Plotly.react(div, traces, layout, { responsive: true });
}

/**
 * Render spectrogram heatmap from neutral JSON.
 * @param {HTMLElement} div
 * @param {object} data - {times, freqs, power} where power is (n_freqs × n_times) in dB.
 * @param {string} channelName
 */
export function renderSpectrogram(div, data, channelName) {
    const trace = {
        x: data.times,
        y: data.freqs,
        z: data.power,
        type: "heatmap",
        colorscale: "Viridis",
        colorbar: {
            title: { text: "dB", side: "right", font: { size: fs(10) } },
            tickfont: { size: fs(9) },
            thickness: 12,
        },
        hovertemplate: "t=%{x:.2f}s  f=%{y:.1f}Hz  %{z:.1f}dB<extra></extra>",
    };

    const { bg, paper, grid, text } = _plotColors();

    const layout = {
        paper_bgcolor: paper,
        plot_bgcolor: bg,
        margin: { t: 8, b: 40, l: 60, r: 16 },
        font: { color: text, size: fs(11) },
        xaxis: {
            gridcolor: grid, color: text,
            title: { text: "Time (s)", font: { size: fs(11) } },
        },
        yaxis: {
            gridcolor: grid, color: text,
            title: { text: "Frequency (Hz)", font: { size: fs(11) } },
        },
    };

    Plotly.react(div, [trace], layout, { responsive: true });
}
