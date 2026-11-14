// HOC Terminal desktop app (Windows + macOS). A window around the live terminal, so every update to
// terminal.hocapital.net shows up in the app straight away. Sign-in (Whop / Discord) happens inside the window;
// other links open in the normal browser.
// App settings (Settings › Desktop app in the terminal): open when the computer starts (optionally in the
// background), keep running in the tray / menu bar when the window is closed, unread count on the app icon.
const { app, BrowserWindow, Menu, Tray, Notification, ipcMain, nativeImage, shell, session, nativeTheme, screen, systemPreferences, net } = require("electron");
const path = require("path");
const { toastHtml } = require("./toast");
const fs = require("fs");

const HOME = "https://terminal.hocapital.net/";
const IS_MAC = process.platform === "darwin";
// Mac "natural" scrolling (System Settings › Trackpad): charts flip their scroll-to-zoom direction to match
const naturalScroll = () => {
    try {
        return IS_MAC && systemPreferences.getUserDefault("com.apple.swipescrolldirection", "boolean") === true;
    } catch {
        return false;
    }
};
// Own title bar like TradingView: no Windows title bar; the terminal's 48px top bar is the drag area, with the
// minimise / maximise / close buttons drawn on the right (Windows) or the traffic lights on the left (Mac).
const TB = 48;
const TB_BG = "#060709";
const overlayFor = (light) => (light ? { color: "#fefefe", symbolColor: "#475569", height: TB } : { color: TB_BG, symbolColor: "#9aa0a8", height: TB });
// Windows 11 draws a thin light border around the window. Colour it like the terminal so it blends in (like DeepCharts):
// DwmSetWindowAttribute(DWMWA_BORDER_COLOR = 34) through koffi. Windows 10 has no such border and just ignores it.
const BORDER = { dark: [0x1e, 0x20, 0x26], light: [0xe2, 0xe5, 0xea] };
let dwmSet = null;
function winBorder(light, w = win) {
    if (process.platform !== "win32" || !w || dwmSet === false) return;
    try {
        if (!dwmSet) dwmSet = require("koffi").load("dwmapi.dll").func("int __stdcall DwmSetWindowAttribute(uintptr_t hwnd, uint32_t attr, _In_ uint32_t *value, uint32_t size)");
        const h = w.getNativeWindowHandle();
        const hwnd = h.length >= 8 ? h.readBigUInt64LE(0) : h.readUInt32LE(0);
        const [r, g, b] = light ? BORDER.light : BORDER.dark;
        dwmSet(hwnd, 34, [r | (g << 8) | (b << 16)], 4); // COLORREF is 0x00BBGGRR
    } catch {
        dwmSet = false;
    }
}
// sign-in pages and the offline page don't know about the app: give them a thin strip to drag the window by
const STRIP = `(() => {
  if (document.getElementById("hoc-tb")) return;
  const d = document.createElement("div");
  d.id = "hoc-tb";
  d.style.cssText = "position:fixed;top:0;left:0;right:0;height:${TB}px;z-index:2147483647;-webkit-app-region:drag;background:${TB_BG};border-bottom:1px solid rgba(255,255,255,.08);color:rgba(255,255,255,.55);font:500 12px system-ui,-apple-system,Segoe UI,sans-serif;letter-spacing:.02em;display:flex;align-items:center;gap:12px;box-sizing:border-box;padding-left:${IS_MAC ? 84 : 12}px;user-select:none";
  // "Back" to the HOC sign-in page, so members can pick another way to sign in (Whop / Discord)
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = "\u2039  Back to sign-in";
  b.title = "Back to the HOC Terminal sign-in page";
  b.style.cssText = "-webkit-app-region:no-drag;cursor:pointer;height:30px;padding:0 12px;border-radius:8px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#e5e7eb;font:500 12.5px system-ui,-apple-system,Segoe UI,sans-serif";
  b.onmouseenter = () => (b.style.background = "rgba(255,255,255,.12)");
  b.onmouseleave = () => (b.style.background = "rgba(255,255,255,.06)");
  b.onclick = () => location.assign("https://terminal.hocapital.net/login");
  const t = document.createElement("span");
  t.textContent = "HOC Terminal";
  d.append(b, t);
  document.documentElement.appendChild(d);
  document.documentElement.style.setProperty("padding-top", "${TB}px", "important");
})()`;
// pages that stay inside the app window: the terminal itself and the sign-in providers
const INSIDE = [/^terminal\.hocapital\.net$/, /(^|\.)whop\.com$/, /^discord\.com$/, /^accounts\.google\.com$/, /^appleid\.apple\.com$/];
const inside = (url) => {
    try {
        const u = new URL(url);
        return u.protocol === "https:" && INSIDE.some((r) => r.test(u.hostname));
    } catch {
        return false;
    }
};
const fromTerminal = (e) => {
    try {
        return new URL(e.senderFrame ? e.senderFrame.url : e.sender.getURL()).hostname === "terminal.hocapital.net";
    } catch {
        return false;
    }
};

// ----- settings (stored next to the window size in the app's data folder) -----
const DEFAULTS = { openAtLogin: false, startHidden: false, background: true, badge: true, trayStatus: true, hocToasts: true };
let lightUi = false; // the terminal's Appearance (light / dark), remembered so the next start opens in the right colours
const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
let S = { ...DEFAULTS };
function loadSettings() {
    try {
        const s = JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
        for (const k of Object.keys(DEFAULTS)) if (typeof s[k] === "boolean") S[k] = s[k];
        lightUi = s.lightUi === true;
    } catch {
        /* first run */
    }
}
function saveSettings() {
    try {
        fs.writeFileSync(settingsFile(), JSON.stringify({ ...S, lightUi }));
    } catch {
        /* ignore */
    }
}
function applyLogin() {
    try {
        app.setLoginItemSettings({ openAtLogin: S.openAtLogin, openAsHidden: S.openAtLogin && S.startHidden, args: S.openAtLogin && S.startHidden ? ["--hidden"] : [] });
    } catch {
        /* not supported here */
    }
}
// Windows installer: "Open HOC Terminal when my computer starts" on its last page (ticked by default).
// The installer leaves its answer in startup-choice next to the app; apply it to the app's own setting once.
const choiceFile = () => path.join(path.dirname(process.execPath), "startup-choice");
function installerChoice() {
    if (IS_MAC) return;
    let v = "";
    try {
        v = fs.readFileSync(choiceFile(), "utf8").trim();
        fs.unlinkSync(choiceFile());
    } catch {
        return; // no installer answer waiting
    }
    if (v !== "0" && v !== "1") return;
    S.openAtLogin = v === "1";
    if (!S.openAtLogin) S.startHidden = false;
    saveSettings();
    applyLogin();
}
const launchedHidden = () => process.argv.includes("--hidden") || (IS_MAC && app.getLoginItemSettings().wasOpenedAsHidden);

// remember the window size and position between launches
const stateFile = () => path.join(app.getPath("userData"), "window.json");
function loadState() {
    try {
        const s = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
        const on = screen.getAllDisplays().some((d) => {
            const a = d.workArea;
            return s.x >= a.x - 50 && s.y >= a.y - 50 && s.x < a.x + a.width && s.y < a.y + a.height;
        });
        return on ? s : { width: s.width, height: s.height, maximized: s.maximized };
    } catch {
        return { width: 1440, height: 900, maximized: true };
    }
}
function saveState(w) {
    try {
        const b = w.getNormalBounds();
        fs.writeFileSync(stateFile(), JSON.stringify({ ...b, maximized: w.isMaximized() }));
    } catch {
        /* ignore */
    }
}

let win = null;
let tray = null;
let quitting = false;
let unread = 0;
let toldTray = false;
const ICON_FILE = path.join(__dirname, "build", IS_MAC ? "icon.png" : "icon.ico"); // Windows: white logo, no square, every size sharp
const appIcon = () => nativeImage.createFromPath(ICON_FILE);

function showWindow() {
    if (!win) return createWindow(true);
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
}

// tray (Windows) / menu bar (Mac) icon: open the terminal or quit; shows the unread count in its tooltip
// today's P&L and the open session (v1.9), sent by the terminal every few minutes
let status = { pnl: "", session: "" };
function updateTray() {
    const want = S.background || S.startHidden || S.trayStatus;
    if (!want) {
        if (tray) tray.destroy();
        tray = null;
        return;
    }
    if (!tray) {
        const img = appIcon().resize({ width: IS_MAC ? 18 : 16, height: IS_MAC ? 18 : 16 });
        tray = new Tray(img);
        tray.on("click", () => showWindow());
    }
    const line = S.trayStatus ? [status.pnl && `Today ${status.pnl}`, status.session].filter(Boolean).join(" · ") : "";
    tray.setToolTip(["HOC Terminal", line, unread ? `${unread} unread` : ""].filter(Boolean).join(" – "));
    if (IS_MAC) {
        try {
            tray.setTitle(S.trayStatus && status.pnl ? ` ${status.pnl}` : "", { fontType: "monospacedDigit" });
        } catch {
            // older macOS
        }
    }
    tray.setContextMenu(
        Menu.buildFromTemplate([
            ...(S.trayStatus ? [{ label: status.pnl ? `Today ${status.pnl}` : "No trades today", enabled: false }, { label: status.session || "No session open", enabled: false }, { type: "separator" }] : []),
            { label: "Open HOC Terminal", click: () => showWindow() },
            { type: "separator" },
            { label: "Quit HOC Terminal", click: () => ((quitting = true), app.quit()) },
        ])
    );
}

// unread notifications on the app icon: number badge on Mac; on the Windows taskbar a red badge with the
// count (1–9, then "9+") and a dark ring so it stands out from the white logo – like Discord's
const DIGITS = {
    0: ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    1: ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    2: ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
    3: ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
    4: ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    5: ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
    6: ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
    7: ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    8: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    9: ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
    "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
};
const badges = new Map();
function countBadge(count) {
    const label = count > 9 ? "9+" : String(count);
    if (badges.has(label)) return badges.get(label);
    const N = 32; // drawn at 2x for a sharp 16 px overlay
    const SS = 4; // supersampling for smooth edges
    const buf = Buffer.alloc(N * N * 4);
    const c = (N - 1) / 2;
    const R = 15.5; // outer edge (dark ring)
    const r = 13.5; // red disc
    // the digits: 5 × 7 pixel font, each font pixel 2 × 2 (1 × 1 for "9+")
    const px = label.length > 1 ? 2 : 2;
    const gw = label.length * 5 + (label.length - 1);
    const sx = Math.round(c + 0.5 - (gw * px) / 2);
    const sy = Math.round(c + 0.5 - (7 * px) / 2);
    const on = (x, y) => {
        const gx = Math.floor((x - sx) / px);
        const gy = Math.floor((y - sy) / px);
        if (gy < 0 || gy > 6 || gx < 0 || gx >= gw) return false;
        const ci = Math.floor(gx / 6);
        const cx = gx % 6;
        return cx < 5 && DIGITS[label[ci]][gy][cx] === "1";
    };
    for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
            let outer = 0;
            let inner = 0;
            for (let j = 0; j < SS; j++)
                for (let i = 0; i < SS; i++) {
                    const d = Math.hypot(x + (i + 0.5) / SS - 0.5 - c, y + (j + 0.5) / SS - 0.5 - c);
                    if (d <= R) outer++;
                    if (d <= r) inner++;
                }
            const ao = outer / (SS * SS);
            const ai = inner / (SS * SS);
            // colour: ring #1c1c1f, disc #ef4444, digits white
            let [rr, gg, bb] = [28, 28, 31];
            if (ai > 0) {
                const t = ai;
                rr = Math.round(28 + (239 - 28) * t);
                gg = Math.round(28 + (68 - 28) * t);
                bb = Math.round(31 + (68 - 31) * t);
            }
            if (on(x, y)) [rr, gg, bb] = [255, 255, 255];
            const k = (y * N + x) * 4;
            buf[k] = bb; // BGRA
            buf[k + 1] = gg;
            buf[k + 2] = rr;
            buf[k + 3] = Math.round(ao * 255);
        }
    const img = nativeImage.createFromBitmap(buf, { width: N, height: N, scaleFactor: 2 });
    badges.set(label, img);
    return img;
}
function applyBadge() {
    const n = S.badge ? unread : 0;
    try {
        if (IS_MAC) app.setBadgeCount(n);
        else if (win) win.setOverlayIcon(n ? countBadge(n) : null, n ? `${n} unread` : "");
    } catch {
        /* ignore */
    }
    updateTray();
}

// links: terminal + sign-in inside the app, everything else in the default browser.
// v1.10: HOC Charts "New chart window" (/charts?ws=2 … 9) opens its own app window instead.
const wsOf = (url) => {
    try {
        const u = new URL(url);
        const id = u.searchParams.get("ws") || "";
        return u.hostname === "terminal.hocapital.net" && u.pathname.replace(/\/$/, "") === "/charts" && /^[2-9]$/.test(id) ? id : "";
    } catch {
        return "";
    }
};
function linkRules(wc) {
    wc.setWindowOpenHandler(({ url }) => {
        const id = wsOf(url);
        if (id) {
            chartWindow(id);
            return { action: "deny" };
        }
        if (inside(url) && /terminal\.hocapital\.net/.test(url)) {
            wc.loadURL(url);
            return { action: "deny" };
        }
        if (/^https?:|^mailto:/.test(url)) shell.openExternal(url);
        return { action: "deny" };
    });
    wc.on("will-navigate", (e, url) => {
        if (!inside(url)) {
            e.preventDefault();
            if (/^https?:|^mailto:/.test(url)) shell.openExternal(url);
        }
    });
}
const winOptions = (extra) => ({
    minWidth: 900,
    minHeight: 600,
    backgroundColor: lightUi ? "#f4f5f7" : "#050505",
    show: false,
    autoHideMenuBar: true,
    icon: IS_MAC ? undefined : ICON_FILE,
    titleBarStyle: IS_MAC ? "hiddenInset" : "hidden",
    trafficLightPosition: { x: 18, y: 17 },
    ...(IS_MAC ? {} : { titleBarOverlay: overlayFor(lightUi) }),
    webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: true,
        backgroundThrottling: false,
        additionalArguments: [`--hoc-version=${app.getVersion()}`, "--hoc-tb=custom", `--hoc-natural=${naturalScroll() ? 1 : 0}`],
    },
    ...extra,
});
const tagUa = (wc) => wc.setUserAgent(wc.getUserAgent().replace(/\s?Electron\/\S+/, "").replace(/\s?hoc-terminal-desktop\/\S+/, "") + " HOCDesktop/" + app.getVersion());

// ----- HOC Charts windows for more monitors (v1.10) -----
// Each "New chart window" in HOC Charts is its own app window with its own markets and indicators (the terminal keeps
// them apart). A new one goes full size on the next monitor; a saved workspace puts each one back where it was.
const chartWins = new Map(); // "2" … "9" → BrowserWindow
// 1.11 (Nov 9, Henrich: multi-monitor on every page): any terminal page can open in its own window (path), not only HOC Charts
function chartWindow(id, b, path) {
    if (!/^[2-9]$/.test(String(id))) return false;
    id = String(id);
    const pg = /^\/[a-z0-9/-]{0,60}$/.test(String(path || "")) ? String(path).slice(1) : "charts";
    const old = chartWins.get(id);
    if (old && !old.isDestroyed()) {
        if (old.isMinimized()) old.restore();
        old.show();
        old.focus();
        if (path) old.loadURL(`${HOME}${pg}?ws=${id}`);
        return true;
    }
    const displays = screen.getAllDisplays();
    let r = null;
    let fill = false;
    if (b && [b.x, b.y, b.w, b.h].every((v) => Number.isFinite(Number(v))) && Number(b.w) >= 300 && Number(b.h) >= 200) {
        const want = { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.w), height: Math.round(b.h) };
        // only where a monitor still is (a saved workspace from a setup with more screens)
        const d = screen.getDisplayMatching(want);
        const wa = d.workArea;
        const overlaps = want.x < wa.x + wa.width && want.x + want.width > wa.x && want.y < wa.y + wa.height && want.y + want.height > wa.y;
        if (overlaps) r = want;
    }
    if (!r) {
        const cur = win && !win.isDestroyed() ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay();
        const others = displays.filter((d) => d.id !== cur.id);
        if (others.length) {
            const wa = others[(Number(id) - 2) % others.length].workArea;
            r = { x: wa.x, y: wa.y, width: wa.width, height: wa.height };
            fill = true;
        } else {
            const wa = cur.workArea;
            const k = Number(id) - 1;
            r = { x: wa.x + 40 * k, y: wa.y + 30 * k, width: Math.max(900, Math.round(wa.width * 0.7)), height: Math.max(600, Math.round(wa.height * 0.8)) };
        }
    }
    const w = new BrowserWindow(winOptions({ ...r, title: `HOC Terminal · Window ${id}` }));
    chartWins.set(id, w);
    winBorder(lightUi, w);
    w.once("ready-to-show", () => {
        if (fill) w.maximize();
        w.show();
    });
    w.on("closed", () => chartWins.get(id) === w && chartWins.delete(id));
    tagUa(w.webContents);
    linkRules(w.webContents);
    const sendFs = () => !w.isDestroyed() && w.webContents.send("hoc:fs", w.isFullScreen());
    w.on("enter-full-screen", sendFs);
    w.on("leave-full-screen", sendFs);
    w.webContents.on("dom-ready", () => w.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {}));
    loadGuard(w);
    w.loadURL(`${HOME}${pg}?ws=${id}`);
    return true;
}
// the window an IPC message came from (the main window or a chart window)
const winOf = (e) => {
    try {
        return BrowserWindow.fromWebContents(e.sender) || win;
    } catch {
        return win;
    }
};

// 1.12 (Nov 9, Henrich: "It went black after I started up my pc and it auto started"): right after Windows starts, the
// network or the graphics driver can still be getting ready, so the page never draws and the window stays black.
// Each window now loads again by itself: no page after 20 s (offline page, which retries), a crashed page or graphics
// process (reload), or a page that froze for 15 s (reload).
function loadGuard(w) {
    const wc = w.webContents;
    let timer = null;
    const arm = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            if (w.isDestroyed() || !wc.isLoading()) return;
            const to = wc.getURL() || HOME;
            wc.stop();
            w.loadFile(path.join(__dirname, "offline.html"), { query: { to: /^https:\/\/terminal\.hocapital\.net\//.test(to) ? to : HOME } });
        }, 20000);
    };
    wc.on("did-start-loading", arm);
    wc.on("did-stop-loading", () => clearTimeout(timer));
    wc.on("render-process-gone", (e, d) => {
        if (d.reason === "clean-exit" || w.isDestroyed()) return;
        setTimeout(() => !w.isDestroyed() && wc.reload(), 1000);
    });
    let hung = null;
    w.on("unresponsive", () => {
        clearTimeout(hung);
        hung = setTimeout(() => !w.isDestroyed() && wc.reload(), 15000);
    });
    w.on("responsive", () => clearTimeout(hung));
    w.on("closed", () => (clearTimeout(timer), clearTimeout(hung)));
}
// the graphics process crashed (often a driver still starting at boot): every window draws again
function gpuGuard() {
    app.on("child-process-gone", (e, d) => {
        if (d.type !== "GPU" || d.reason === "clean-exit") return;
        setTimeout(() => BrowserWindow.getAllWindows().forEach((w) => !w.isDestroyed() && w.webContents.getURL() && w.webContents.reload()), 1500);
    });
}
// at login there may be no network yet: start on the offline page (it opens the terminal as soon as the network is back)
const startUrl = () => (net.isOnline() ? null : HOME);

function createWindow(show = true) {
    const st = loadState();
    win = new BrowserWindow({
        x: st.x,
        y: st.y,
        width: st.width || 1440,
        height: st.height || 900,
        minWidth: 900,
        minHeight: 600,
        title: "HOC Terminal",
        backgroundColor: lightUi ? "#f4f5f7" : "#050505",
        show: false,
        autoHideMenuBar: true,
        icon: IS_MAC ? undefined : ICON_FILE,
        titleBarStyle: IS_MAC ? "hiddenInset" : "hidden",
        trafficLightPosition: { x: 18, y: 17 },
        ...(IS_MAC ? {} : { titleBarOverlay: overlayFor(lightUi) }),
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            spellcheck: true,
            backgroundThrottling: false, // keep checking for alerts while the window is hidden
            additionalArguments: [`--hoc-version=${app.getVersion()}`, "--hoc-tb=custom", `--hoc-natural=${naturalScroll() ? 1 : 0}`],
        },
    });
    winBorder(lightUi);
    if (st.maximized) win.maximize();
    win.once("ready-to-show", () => show && win.show());
    ["resize", "move"].forEach((e) => win.on(e, () => saveState(win)));
    // closing the window keeps the app running in the tray / menu bar when "Keep running in the background" is on
    win.on("close", (e) => {
        saveState(win);
        if (quitting || !S.background) return;
        e.preventDefault();
        win.hide();
        if (!toldTray && !IS_MAC && Notification.isSupported()) {
            toldTray = true;
            new Notification({ title: "HOC Terminal is still running", body: "You'll keep getting alerts. Open it again from the icon in the taskbar tray.", silent: true }).show();
        }
    });
    win.on("closed", () => (win = null));
    // full screen: the terminal's full screen button asks the app for native full screen (one clean resize, no flicker)
    const sendFs = () => win && !win.isDestroyed() && win.webContents.send("hoc:fs", win.isFullScreen());
    win.on("enter-full-screen", sendFs);
    win.on("leave-full-screen", sendFs);

    const wc = win.webContents;
    // a normal Chrome user agent (sign-in pages refuse "embedded browser" agents), tagged so the terminal knows it's the app
    tagUa(wc);

    linkRules(wc);
    // no connection: a friendly page with a retry button
    wc.on("did-fail-load", (e, code, desc, url, isMain) => {
        if (isMain && code !== -3) win.loadFile(path.join(__dirname, "offline.html"), { query: { to: url || HOME } });
    });
    wc.on("dom-ready", () => {
        let host = "";
        try {
            host = new URL(wc.getURL()).hostname;
        } catch {
            /* file:// (offline page) */
        }
        if (host !== "terminal.hocapital.net") wc.executeJavaScript(STRIP).catch(() => {});
        wc.setVisualZoomLevelLimits(1, 1).catch(() => {}); // no pinch-zoom, like a desktop program
    });
    wc.on("page-title-updated", (e) => {
        e.preventDefault();
        win.setTitle("HOC Terminal");
    });
    loadGuard(win);
    if (startUrl()) win.loadFile(path.join(__dirname, "offline.html"), { query: { to: HOME } });
    else win.loadURL(HOME);
    applyBadge();
}

// downloads (CSV exports, chart snapshots) go to the Downloads folder with a save dialog
function handleDownloads() {
    session.defaultSession.on("will-download", (e, item) => {
        item.setSaveDialogOptions({ defaultPath: path.join(app.getPath("downloads"), item.getFilename()) });
    });
}
// only notifications, clipboard and full screen are allowed, and only for the terminal / sign-in pages
function handlePermissions() {
    session.defaultSession.setPermissionRequestHandler((wc, perm, cb, details) => {
        // 1.13 (Nov 14, Henrich): full screen is judged by the page it happens in, so the YouTube / Vimeo player's own
        // full-screen button works in Academy lessons (the request comes from the video's frame, not the terminal)
        const ok = perm === "fullscreen" ? inside(wc.getURL()) : ["notifications", "clipboard-sanitized-write", "clipboard-read"].includes(perm) && inside(details.requestingUrl || wc.getURL());
        cb(ok);
    });
}

// the terminal talks to the app through these (see preload.js)
function handleIpc() {
    ipcMain.handle("hoc:get", (e) => (fromTerminal(e) ? { settings: S, version: app.getVersion(), platform: process.platform } : null));
    ipcMain.handle("hoc:set", (e, key, value) => {
        if (!fromTerminal(e) || !(key in DEFAULTS) || typeof value !== "boolean") return null;
        S[key] = value;
        saveSettings();
        if (key === "openAtLogin" || key === "startHidden") applyLogin();
        if (key === "background" || key === "startHidden" || key === "trayStatus") updateTray();
        if (key === "badge") applyBadge();
        return S;
    });
    ipcMain.on("hoc:badge", (e, n) => {
        if (!fromTerminal(e)) return;
        unread = Math.max(0, Math.min(999, Math.round(Number(n) || 0)));
        applyBadge();
    });
    ipcMain.on("hoc:focus", (e) => fromTerminal(e) && showWindow());
    // Windows: the terminal reports the colour behind the window buttons (the top bar, or a pop-up's backdrop over it)
    ipcMain.on("hoc:tbcolor", (e, c) => {
        const w = winOf(e);
        if (!fromTerminal(e) || IS_MAC || !w || !/^#[0-9a-f]{6}$/i.test(String(c))) return;
        const n = parseInt(c.slice(1), 16);
        const lum = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
        try {
            w.setTitleBarOverlay({ color: c, symbolColor: lum > 140 ? "#475569" : "#9aa0a8", height: TB });
        } catch {
            /* ignore */
        }
    });
    // full screen from the terminal (button or F11): native window full screen
    ipcMain.on("hoc:fullscreen", (e, on) => {
        const w = winOf(e);
        if (!fromTerminal(e) || !w) return;
        w.setFullScreen(typeof on === "boolean" ? on : !w.isFullScreen());
    });
    ipcMain.handle("hoc:isfs", (e) => {
        const w = winOf(e);
        return Boolean(fromTerminal(e) && w && w.isFullScreen());
    });
    // v1.10: HOC Charts asks for another chart window (optionally where a saved workspace had it)
    ipcMain.handle("hoc:chartwin", (e, id, b, path) => (fromTerminal(e) ? chartWindow(String(id || ""), b && typeof b === "object" ? b : null, typeof path === "string" ? path : null) : false));
    // the terminal switched between light and dark: window buttons, window background and system theme follow
    ipcMain.on("hoc:theme", (e, t) => {
        if (!fromTerminal(e)) return;
        const light = t === "light";
        nativeTheme.themeSource = light ? "light" : "dark";
        for (const w of [win, ...chartWins.values()]) {
            if (!w || w.isDestroyed()) continue;
            try {
                if (!IS_MAC) w.setTitleBarOverlay(overlayFor(light));
                w.setBackgroundColor(light ? "#f4f5f7" : "#050505");
                winBorder(light, w);
            } catch {
                /* ignore */
            }
        }
        if (light !== lightUi) {
            lightUi = light;
            saveSettings();
        }
    });
    ipcMain.on("hoc:status", (e, s) => {
        if (!fromTerminal(e) || !s || typeof s !== "object") return;
        status = { pnl: String(s.pnl || "").slice(0, 20), session: String(s.session || "").slice(0, 40) };
        updateTray();
    });
    ipcMain.handle("hoc:notify", (e, n) => {
        if (!fromTerminal(e) || !n || typeof n !== "object") return false;
        if (S.hocToasts) {
            hocToast(n);
            return true;
        }
        if (!Notification.isSupported()) return false;
        const sys = new Notification({ title: String(n.title || "HOC Terminal").slice(0, 90), body: String(n.body || "").slice(0, 220), icon: IS_MAC ? undefined : appIcon() });
        sys.on("click", () => {
            showWindow();
            if (win && typeof n.url === "string" && n.url.startsWith("/")) win.loadURL(new URL(n.url, HOME).toString());
        });
        sys.show();
        return true;
    });
    ipcMain.handle("hoc:test", (e) => {
        if (!fromTerminal(e) || !Notification.isSupported()) return false;
        const n = new Notification({ title: "HOC Terminal", body: "Notifications are working. You'll see alerts like this one.", icon: IS_MAC ? undefined : appIcon() });
        n.on("click", () => showWindow());
        n.show();
        return true;
    });
}

// ----- HOC-style notifications (v1.9): a small dark HOC card in the corner of the screen, with its own sound per kind -----
const toasts = [];
const TOAST_W = 360;
const TOAST_H = 108;
function placeToasts() {
    const wa = screen.getPrimaryDisplay().workArea;
    toasts.forEach((t, i) => {
        try {
            t.setPosition(wa.x + wa.width - TOAST_W - 16, wa.y + wa.height - 16 - (TOAST_H + 10) * (i + 1) + 10);
        } catch {
            // closed
        }
    });
}
function hocToast(n) {
    const title = String(n.title || "HOC Terminal").slice(0, 90);
    const body = String(n.body || "").slice(0, 220);
    const kind = ["alert", "news", "booking", "session"].includes(n.kind) ? n.kind : "news";
    const url = typeof n.url === "string" && n.url.startsWith("/") ? n.url : "/";
    while (toasts.length >= 4) {
        const old = toasts.shift();
        try {
            old.destroy();
        } catch {
            // gone
        }
    }
    const t = new BrowserWindow({ width: TOAST_W, height: TOAST_H, frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false, alwaysOnTop: true, skipTaskbar: true, focusable: false, show: false, hasShadow: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, autoplayPolicy: "no-user-gesture-required" } });
    t.setAlwaysOnTop(true, "screen-saver");
    toasts.push(t);
    placeToasts();
    const html = toastHtml(n, lightUi);
    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        const i = toasts.indexOf(t);
        if (i >= 0) toasts.splice(i, 1);
        try {
            t.destroy();
        } catch {
            // gone
        }
        placeToasts();
    };
    t.webContents.on("will-navigate", (e, u) => {
        e.preventDefault();
        if (String(u).startsWith("hoc://open")) {
            showWindow();
            if (win) win.loadURL(new URL(url, HOME).toString());
        }
        close();
    });
    t.once("ready-to-show", () => t.showInactive());
    t.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    setTimeout(close, 7000);
    t.on("closed", () => {
        closed = true;
        const i = toasts.indexOf(t);
        if (i >= 0) toasts.splice(i, 1);
    });
}

function buildMenu() {
    const go = (p) => {
        showWindow();
        win && win.loadURL(new URL(p, HOME).toString());
    };
    const template = [
        ...(IS_MAC ? [{ role: "appMenu" }] : []),
        {
            label: "File",
            submenu: [
                { label: "Home", accelerator: "CmdOrCtrl+Shift+H", click: () => go("/") },
                { label: "Journal", click: () => go("/journal") },
                { label: "Backtesting", click: () => go("/backtesting") },
                { label: "Market Analysis", click: () => go("/analysis") },
                { type: "separator" },
                { label: "App settings…", accelerator: "CmdOrCtrl+,", click: () => go("/settings#desktop") },
                { type: "separator" },
                { label: IS_MAC ? "Close Window" : "Quit", accelerator: IS_MAC ? "Cmd+W" : "Ctrl+Q", click: () => (IS_MAC ? win && win.close() : ((quitting = true), app.quit())) },
            ],
        },
        { role: "editMenu" },
        {
            label: "View",
            submenu: [{ role: "reload" }, { role: "forceReload" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }, ...(app.isPackaged ? [] : [{ role: "toggleDevTools" }])],
        },
        {
            label: "Navigate",
            submenu: [
                { label: "Back", accelerator: IS_MAC ? "Cmd+[" : "Alt+Left", click: () => win && win.webContents.navigationHistory.canGoBack() && win.webContents.navigationHistory.goBack() },
                { label: "Forward", accelerator: IS_MAC ? "Cmd+]" : "Alt+Right", click: () => win && win.webContents.navigationHistory.canGoForward() && win.webContents.navigationHistory.goForward() },
            ],
        },
        { role: "windowMenu" },
        {
            role: "help",
            submenu: [{ label: "Downloads and updates", click: () => go("/downloads") }, { label: "hocapital.net", click: () => shell.openExternal("https://hocapital.net") }, { label: "Changelog", click: () => shell.openExternal("https://hocapital.net/changelog") }],
        },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// one window only: opening the app again shows it
if (!app.requestSingleInstanceLock()) app.quit();
else {
    app.on("second-instance", () => showWindow());
    app.on("before-quit", () => (quitting = true));
    app.whenReady().then(() => {
        loadSettings();
        nativeTheme.themeSource = lightUi ? "light" : "dark";
        if (process.platform === "win32") app.setAppUserModelId("net.hocapital.terminal");
        installerChoice();
        applyLogin();
        setTimeout(installerChoice, 6000); // "Run now" starts the app a moment before the startup box is saved
        gpuGuard();
        handleDownloads();
        handlePermissions();
        handleIpc();
        buildMenu();
        createWindow(!launchedHidden());
        updateTray();
        app.on("activate", () => showWindow());
    });
    app.on("window-all-closed", () => {
        if (!IS_MAC && !S.background) app.quit();
    });
}
