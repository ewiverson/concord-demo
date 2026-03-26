// metrics.js — metric heatmap and line-length trace rendering.

function _layoutBase() {
    const s = getComputedStyle(document.documentElement);
    const bg    = s.getPropertyValue("--plot-bg").trim();
    const paper = s.getPropertyValue("--plot-paper").trim();
    const grid  = s.getPropertyValue("--plot-grid").trim();
    const text  = s.getPropertyValue("--plot-text").trim();
    return {
        base: { paper_bgcolor: paper, plot_bgcolor: bg, margin: { t: 8, b: 50, l: 80, r: 50 }, font: { color: text, size: 11 } },
        grid: { gridcolor: grid, color: text },
    };
}

/**
 * Render line-length time-varying heatmap (channels × time windows).
 * @param {HTMLElement} div
 * @param {object} data - {channels, times, values}
 */
export function renderLineLength(div, data) {
    const trace = {
        x: data.times,
        y: data.channels,
        z: data.values,
        type: "heatmap",
        colorscale: "YlOrRd",
        colorbar: {
            title: { text: "V", side: "right", font: { size: 10 } },
            tickfont: { size: 9 },
            thickness: 12,
        },
        hovertemplate: "t=%{x:.1f}s  %{y}  LL=%{z:.4g}<extra></extra>",
    };

    const { base, grid } = _layoutBase();
    const layout = {
        ...base,
        xaxis: { ...grid, title: { text: "Time (s)", font: { size: 11 } } },
        yaxis: { ...grid, autorange: "reversed", tickfont: { size: 9 } },
    };

    Plotly.react(div, [trace], layout, { responsive: true });
}

/**
 * Render Hjorth heatmap for a selected parameter.
 * @param {HTMLElement} div
 * @param {object} data - {channels, times, params, values}  values shape (n_ch, n_win, 3)
 * @param {number} [paramIdx=0] - 0=activity, 1=mobility, 2=complexity
 */
export function renderHjorth(div, data, paramIdx = 0) {
    const paramName = data.params[paramIdx];
    // Extract slice: for each channel, the values for this param across time windows
    const z = data.values.map(ch_wins => ch_wins.map(win => win[paramIdx]));

    const trace = {
        x: data.times,
        y: data.channels,
        z,
        type: "heatmap",
        colorscale: "RdBu",
        colorbar: {
            title: { text: paramName, side: "right", font: { size: 10 } },
            tickfont: { size: 9 },
            thickness: 12,
        },
        hovertemplate: `t=%{x:.1f}s  %{y}  ${paramName}=%{z:.4g}<extra></extra>`,
    };

    const { base, grid } = _layoutBase();
    const layout = {
        ...base,
        xaxis: { ...grid, title: { text: "Time (s)", font: { size: 11 } } },
        yaxis: { ...grid, autorange: "reversed", tickfont: { size: 9 } },
    };

    Plotly.react(div, [trace], layout, { responsive: true });
}

/**
 * Render band-power heatmap (channels × bands).
 * @param {HTMLElement} div
 * @param {object} data - {channels, bands, values}  values shape (n_ch, n_bands)
 */
export function renderBandPower(div, data) {
    // log10 transform for display
    const z = data.values.map(row =>
        row.map(v => (v > 0 ? Math.log10(v) : null))
    );

    const trace = {
        x: data.bands,
        y: data.channels,
        z,
        type: "heatmap",
        colorscale: "Viridis",
        colorbar: {
            title: { text: "log₁₀(V²)", side: "right", font: { size: 10 } },
            tickfont: { size: 9 },
            thickness: 12,
        },
        hovertemplate: "%{y}  %{x}  %{z:.3f}<extra></extra>",
    };

    const { base, grid } = _layoutBase();
    const layout = {
        ...base,
        xaxis: { ...grid, tickfont: { size: 10 } },
        yaxis: { ...grid, autorange: "reversed", tickfont: { size: 9 } },
    };

    Plotly.react(div, [trace], layout, { responsive: true });
}
