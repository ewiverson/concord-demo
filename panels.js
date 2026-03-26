// panels.js — panel registry, applyLayout, layout modal logic.

// Registry: panel type id → render function (div: HTMLElement) => void | Promise<void>
const _registry = {};

export const PANEL_LABELS = {
    timeseries:  "Time Series",
    psd:         "PSD",
    spectrogram: "Spectrogram",
    line_length: "Line Length",
    hjorth:      "Hjorth",
    band_power:  "Band Power",
    brain3d:     "3D Brain",
    empty:       "(empty)",
};

export const LAYOUT_PRESETS = {
    clinical: [
        ["timeseries"],
        ["spectrogram", "psd"],
        ["line_length", "brain3d"],
    ],
    seizure_onset: [
        ["timeseries"],
        ["brain3d", "band_power"],
    ],
    spectral: [
        ["timeseries"],
        ["psd", "spectrogram"],
    ],
};

const LAYOUT_KEY = "concord_layout";
const THEME_KEY  = "concord_theme";

function _applyTheme(theme) {
    document.documentElement.dataset.theme = theme === "light" ? "light" : "";
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
}

/**
 * Register a panel render function.
 * @param {string} id
 * @param {function} fn - (div: HTMLElement) => void | Promise<void>
 */
export function registerPanel(id, fn) {
    _registry[id] = fn;
}

export function saveLayout(grid) {
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(grid)); } catch { /* ignore */ }
}

export function loadLayout() {
    try {
        const s = localStorage.getItem(LAYOUT_KEY);
        if (s) return JSON.parse(s);
    } catch { /* ignore */ }
    return LAYOUT_PRESETS.clinical.map(r => [...r]);
}

/**
 * Apply a grid layout — rebuilds #main DOM and renders each panel.
 * @param {string[][]} grid - rows × cols of panel type IDs
 */
export function applyLayout(grid) {
    const main = document.getElementById("main");
    main.innerHTML = "";
    const nRows = grid.length;
    const nCols = Math.max(...grid.map(row => row.length), 1);
    main.style.gridTemplateRows = `repeat(${nRows}, 1fr)`;
    main.style.gridTemplateColumns = `repeat(${nCols}, 1fr)`;

    for (const row of grid) {
        for (let c = 0; c < nCols; c++) {
            const panelId = (row[c] || "empty");
            const panelDiv = document.createElement("div");
            panelDiv.className = "panel";
            panelDiv.dataset.panelType = panelId;

            const header = document.createElement("div");
            header.className = "panel-header";
            const titleSpan = document.createElement("span");
            titleSpan.className = "panel-title";
            titleSpan.textContent = PANEL_LABELS[panelId] || panelId;
            header.appendChild(titleSpan);
            panelDiv.appendChild(header);

            const body = document.createElement("div");
            body.className = "panel-body";
            body.dataset.panelType = panelId;
            panelDiv.appendChild(body);

            main.appendChild(panelDiv);

            if (panelId !== "empty" && _registry[panelId]) {
                _registry[panelId](body);
            }
        }
    }
}

/**
 * Re-render all currently displayed panels without rebuilding DOM structure.
 */
export function rerenderAll() {
    document.querySelectorAll(".panel-body[data-panel-type]").forEach(body => {
        const panelType = body.dataset.panelType;
        if (panelType && panelType !== "empty" && _registry[panelType]) {
            _registry[panelType](body);
        }
    });
}

// ---- Layout modal -----------------------------------------------------------

let _editorState = {
    rows: 2,
    cols: 1,
    grid: LAYOUT_PRESETS.clinical.map(r => [...r]),
};

function _renderGridEditor() {
    const { rows, cols, grid } = _editorState;
    document.getElementById("grid-rows").value = String(rows);
    document.getElementById("grid-cols").value = String(cols);

    const editor = document.getElementById("grid-editor");
    editor.innerHTML = "";
    editor.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    editor.style.gridTemplateRows = `repeat(${rows}, auto)`;

    const panelOptions = Object.entries(PANEL_LABELS)
        .map(([id, label]) => `<option value="${id}">${label}</option>`)
        .join("");

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const sel = document.createElement("select");
            sel.className = "grid-cell-select";
            sel.innerHTML = panelOptions;
            sel.value = (grid[r] && grid[r][c]) || "empty";
            sel.addEventListener("change", () => {
                if (!_editorState.grid[r]) _editorState.grid[r] = [];
                _editorState.grid[r][c] = sel.value;
            });
            editor.appendChild(sel);
        }
    }
}

export function openLayoutModal() {
    // Sync editor state from current saved layout
    const saved = loadLayout();
    _editorState = {
        rows: saved.length,
        cols: Math.max(...saved.map(r => r.length), 1),
        grid: saved.map(r => [...r]),
    };
    _renderGridEditor();
    document.getElementById("layout-modal").hidden = false;
}

export function initLayoutModal() {
    // Preset buttons
    document.querySelectorAll(".preset-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const preset = LAYOUT_PRESETS[btn.dataset.preset];
            if (!preset) return;
            const grid = preset.map(r => [...r]);
            saveLayout(grid);
            applyLayout(grid);
            document.getElementById("layout-modal").hidden = true;
        });
    });

    // Grid resize
    document.getElementById("grid-size-apply").addEventListener("click", () => {
        const r = parseInt(document.getElementById("grid-rows").value) || 1;
        const c = parseInt(document.getElementById("grid-cols").value) || 1;
        const newGrid = [];
        for (let ri = 0; ri < r; ri++) {
            const row = [];
            for (let ci = 0; ci < c; ci++) {
                row.push((_editorState.grid[ri] && _editorState.grid[ri][ci]) || "empty");
            }
            newGrid.push(row);
        }
        _editorState = { rows: r, cols: c, grid: newGrid };
        _renderGridEditor();
    });

    // Apply custom layout
    document.getElementById("layout-apply-btn").addEventListener("click", () => {
        const grid = _editorState.grid.map(r => [...r]);
        saveLayout(grid);
        applyLayout(grid);
        document.getElementById("layout-modal").hidden = true;
    });

    // Close
    document.getElementById("layout-close").addEventListener("click", () => {
        document.getElementById("layout-modal").hidden = true;
    });
    document.getElementById("layout-modal").addEventListener("click", e => {
        if (e.target === e.currentTarget) e.currentTarget.hidden = true;
    });

    // Apply saved theme on load
    _applyTheme(localStorage.getItem(THEME_KEY) || "light");

    // Theme toggle — injected into presets column
    const presetsEl = document.querySelector(".layout-presets");

    const themeTitle = document.createElement("div");
    themeTitle.className = "layout-section-title";
    themeTitle.style.marginTop = "16px";
    themeTitle.textContent = "Theme";
    presetsEl.appendChild(themeTitle);

    const themeBtn = document.createElement("button");
    themeBtn.className = "preset-btn";
    function _updateThemeBtn() {
        themeBtn.textContent = document.documentElement.dataset.theme === "light"
            ? "☾ Dark" : "☀ Light";
    }
    _updateThemeBtn();
    themeBtn.addEventListener("click", () => {
        const isLight = document.documentElement.dataset.theme === "light";
        _applyTheme(isLight ? "dark" : "light");
        _updateThemeBtn();
        rerenderAll();
    });
    presetsEl.appendChild(themeBtn);

    // Gear button
    document.getElementById("layout-btn").addEventListener("click", openLayoutModal);
}
