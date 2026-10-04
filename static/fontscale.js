// fontscale.js — global text size. CSS font sizes are `calc(Npx * var(--font-scale))`;
// Plotly font sizes go through fs(). The A−/A+ buttons step the scale and re-render charts.

const KEY = "concord_font_scale";
const STEPS = [0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6];
const DEFAULT_SCALE = 1.1;   // one step above the original 1.0; keep in sync with :root in style.css

let _scale = DEFAULT_SCALE;

function _load() {
    try {
        const saved = parseFloat(localStorage.getItem(KEY));
        if (STEPS.includes(saved)) return saved;
    } catch { /* storage unavailable */ }
    return DEFAULT_SCALE;
}

function _apply(scale) {
    _scale = scale;
    document.documentElement.style.setProperty("--font-scale", String(scale));
    try { localStorage.setItem(KEY, String(scale)); } catch { /* ignore */ }
    const idx = STEPS.indexOf(scale);
    document.querySelectorAll(".font-btn").forEach(btn => {
        const down = btn.dataset.dir === "-1";
        btn.disabled = down ? idx <= 0 : idx >= STEPS.length - 1;
        btn.title = `${down ? "Smaller" : "Larger"} text (${Math.round(scale * 100)}%)`;
    });
}

// Scale a Plotly font size.
export function fs(size) {
    return Math.round(size * _scale * 10) / 10;
}

// Plotly falls back to a fixed 12px for any text a layout doesn't size explicitly (e.g. the time series
// x-axis ticks). Give every plot a scaled default so all chart text follows the scale.
function _installPlotlyDefault() {
    const plotly = window.Plotly;
    if (!plotly || plotly.__concordFontScale) return;
    plotly.__concordFontScale = true;
    for (const name of ["react", "newPlot"]) {
        const original = plotly[name];
        plotly[name] = function (gd, data, layout, config) {
            const mono = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim();
            const scaled = { ...(layout || {}), font: { family: mono, size: fs(12), ...((layout || {}).font || {}) } };
            return original.call(this, gd, data, scaled, config);
        };
    }
}

// Wire the A−/A+ buttons. onChange runs after the scale changes (re-render charts).
export function initFontScale(onChange) {
    _scale = _load();
    _apply(_scale);
    _installPlotlyDefault();
    document.querySelectorAll(".font-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const idx = STEPS.indexOf(_scale) + parseInt(btn.dataset.dir, 10);
            if (idx < 0 || idx >= STEPS.length) return;
            _apply(STEPS[idx]);
            if (onChange) onChange();
        });
    });
}

// Plotly charts call fs() while building layouts, which happens on module load of the first render,
// so the saved scale must be known before then.
_scale = _load();
