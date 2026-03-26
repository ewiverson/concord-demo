// spectral.js — PSD overlay + single-channel spectrogram rendering.

// Dark-theme trace palette (high-contrast neons on dark bg)
const _DARK_LINE_COLORS = [
    "#4e9af1", "#f1884e", "#4ef1a0", "#f14e8a", "#c4f14e",
    "#8a4ef1", "#f1d44e", "#4ef1e8",
];
// Light-theme trace palette: Okabe-Ito, colorblind-safe, publication-standard
const _LIGHT_LINE_COLORS = [
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
        lines: document.documentElement.dataset.theme === "light"
            ? _LIGHT_LINE_COLORS : _DARK_LINE_COLORS,
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
        font: { color: text, size: 11 },
        xaxis: {
            gridcolor: grid, color: text,
            type: "log",
            title: { text: "Frequency (Hz)", font: { size: 11 } },
        },
        yaxis: {
            gridcolor: grid, color: text,
            type: "log",
            title: { text: "Power (V²/Hz)", font: { size: 11 } },
        },
        showlegend: data.channels.length <= 8,
        legend: { font: { size: 9 }, bgcolor: "transparent" },
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
            title: { text: "dB", side: "right", font: { size: 10 } },
            tickfont: { size: 9 },
            thickness: 12,
        },
        hovertemplate: "t=%{x:.2f}s  f=%{y:.1f}Hz  %{z:.1f}dB<extra></extra>",
    };

    const { bg, paper, grid, text } = _plotColors();

    const layout = {
        paper_bgcolor: paper,
        plot_bgcolor: bg,
        margin: { t: 8, b: 40, l: 60, r: 16 },
        font: { color: text, size: 11 },
        title: {
            text: channelName ? `Spectrogram: ${channelName}` : "Spectrogram",
            font: { size: 12, color: text },
            x: 0.5,
        },
        xaxis: {
            gridcolor: grid, color: text,
            title: { text: "Time (s)", font: { size: 11 } },
        },
        yaxis: {
            gridcolor: grid, color: text,
            title: { text: "Frequency (Hz)", font: { size: 11 } },
        },
    };

    Plotly.react(div, [trace], layout, { responsive: true });
}
