// server_settings.js — Settings modal tabs (shared with the demo) and the "Server" tab logic (server only).

const $ = id => document.getElementById(id);

function setMsg(text, isError = false) {
    const el = $("srv-msg");
    el.textContent = text;
    el.className = isError ? "srv-msg error" : "srv-msg";
}

function fmtUptime(s) {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`;
}

async function postJson(url, body) {
    const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.detail || resp.statusText);
    return data;
}

function readForm() {
    return {
        host: $("srv-host").value.trim(),
        port: parseInt($("srv-port").value, 10),
        data_root: $("srv-data-root").value.trim(),
        reload: $("srv-reload").checked,
    };
}

function updateHostWarning() {
    $("srv-host-warning").hidden = $("srv-host").value.trim() !== "0.0.0.0";
}

async function loadInfo() {
    try {
        const resp = await fetch("/api/server/info");
        const info = await resp.json();
        if (info.demo) {
            // Static demo (no server behind it): replace the form with a notice.
            document.querySelector("#settings-pane-server .server-body").innerHTML =
                '<div class="srv-hint">The demo runs entirely in your browser, so there is no server to configure, restart or stop. ' +
                'Run Concord locally (<code>python serve.py</code>) to use these settings.</div>';
            return;
        }
        const rows = [
            ["Address", `${info.host}:${info.port}`],
            ["Process ID", info.pid],
            ["Uptime", fmtUptime(info.uptime_s)],
            ["Data root", info.data_root || "(none)"],
            ["Auto-reload", info.auto_reload_active ? "on" : "off"],
            ["Python", info.python],
        ];
        $("server-info").innerHTML = rows
            .map(([k, v]) => `<tr><td class="meta-key">${k}</td><td class="meta-value"></td></tr>`).join("");
        $("server-info").querySelectorAll(".meta-value").forEach((td, i) => { td.textContent = rows[i][1]; });
        $("srv-host").value = info.settings.host;
        $("srv-port").value = info.settings.port;
        $("srv-data-root").value = info.settings.data_root;
        $("srv-reload").checked = info.settings.reload;
        $("srv-config-path").textContent = info.config_path;
        updateHostWarning();
        setMsg("");
    } catch (e) {
        setMsg(`Could not load server info: ${e.message}`, true);
    }
}

async function save() {
    const data = await postJson("/api/server/settings", readForm());
    return data.settings;
}

// After a restart the page may be served from a new port; poll until it answers, then navigate.
async function waitForServer(port) {
    const target = new URL(location.href);
    target.port = String(port);
    for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 500));
        try {
            await fetch(`${target.origin}/api/server/info`, { mode: "no-cors", cache: "no-store" });
            location.href = target.origin + "/";
            return;
        } catch (_) { /* not up yet */ }
    }
    setMsg("Server did not come back within 30s. Check the terminal.", true);
}

async function saveAndRestart() {
    try {
        const cfg = await save();
        setMsg("Restarting…");
        await postJson("/api/server/restart");
        await waitForServer(cfg.port);
    } catch (e) {
        setMsg(e.message, true);
    }
}

// Two-click confirm so the server can't be stopped by accident.
function initStopButton() {
    const btn = $("srv-stop-btn");
    let timer = null;
    const disarm = () => { btn.classList.remove("armed"); btn.textContent = "Stop server"; timer = null; };
    btn.addEventListener("click", async () => {
        if (!timer) {
            btn.classList.add("armed");
            btn.textContent = "Click again to stop";
            timer = setTimeout(disarm, 4000);
            return;
        }
        clearTimeout(timer);
        await fetch("/api/shutdown", { method: "POST" }).catch(() => {});
        document.body.innerHTML = "<div style='color:#9aa;padding:40px;font-family:monospace'>Server stopped. Close this tab.</div>";
    });
}

// Tab switching for the Settings modal. onServerTab runs when the Server tab opens (server build only).
export function initSettingsTabs(onServerTab) {
    function selectTab(name) {
        document.querySelectorAll(".settings-tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
        $("settings-pane-layout").hidden = name !== "layout";
        $("settings-pane-server").hidden = name !== "server";
        if (name === "server" && onServerTab) onServerTab();
    }
    document.querySelectorAll(".settings-tab").forEach(t => t.addEventListener("click", () => selectTab(t.dataset.tab)));
    $("settings-btn").addEventListener("click", () => selectTab("layout"));
}

export function initServerSettings() {
    initSettingsTabs(loadInfo);
    $("srv-host").addEventListener("input", updateHostWarning);
    $("srv-save-btn").addEventListener("click", async () => {
        try { await save(); setMsg("Saved. Restart to apply."); } catch (e) { setMsg(e.message, true); }
    });
    $("srv-restart-btn").addEventListener("click", saveAndRestart);
    initStopButton();
}
