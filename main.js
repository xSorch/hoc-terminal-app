// HOC Terminal desktop app (Windows + macOS). A window around the live terminal, so every update to
// terminal.hocapital.net shows up in the app straight away. Sign-in (Whop / Discord) happens inside the window;
// other links open in the normal browser.
// App settings (Settings › Desktop app in the terminal): open when the computer starts (optionally in the
// background), keep running in the tray / menu bar when the window is closed, unread count on the app icon.
const { app, BrowserWindow, Menu, Tray, Notification, ipcMain, nativeImage, shell, session, nativeTheme, screen } = require("electron");
const path = require("path");
const fs = require("fs");

const HOME = "https://terminal.hocapital.net/";
const IS_MAC = process.platform === "darwin";
// Own title bar like TradingView: no Windows title bar; the terminal's 48px top bar is the drag area, with the
// minimise / maximise / close buttons drawn on the right (Windows) or the traffic lights on the left (Mac).
const TB = 48;
const TB_BG = "#060709";
const overlayFor = (light) => (light ? { color: "#fefefe", symbolColor: "#475569", height: TB } : { color: TB_BG, symbolColor: "#9aa0a8", height: TB });
// sign-in pages and the offline page don't know about the app: give them a thin strip to drag the window by
const STRIP = `(() => {
  if (document.getElementById("hoc-tb")) return;
  const d = document.createElement("div");
  d.id = "hoc-tb";
  d.textContent = "HOC Terminal";
  d.style.cssText = "position:fixed;top:0;left:0;right:0;height:${TB}px;z-index:2147483647;-webkit-app-region:drag;background:${TB_BG};border-bottom:1px solid rgba(255,255,255,.08);color:rgba(255,255,255,.55);font:500 12px system-ui,-apple-system,Segoe UI,sans-serif;letter-spacing:.02em;display:flex;align-items:center;box-sizing:border-box;padding-left:${IS_MAC ? 84 : 16}px;user-select:none";
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
const DEFAULTS = { openAtLogin: false, startHidden: false, background: true, badge: true };
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
function updateTray() {
    const want = S.background || S.startHidden;
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
    tray.setToolTip(unread ? `HOC Terminal – ${unread} unread` : "HOC Terminal");
    tray.setContextMenu(
        Menu.buildFromTemplate([
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
            additionalArguments: [`--hoc-version=${app.getVersion()}`, "--hoc-tb=custom"],
        },
    });
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

    const wc = win.webContents;
    // a normal Chrome user agent (sign-in pages refuse "embedded browser" agents), tagged so the terminal knows it's the app
    wc.setUserAgent(wc.getUserAgent().replace(/\s?Electron\/\S+/, "").replace(/\s?hoc-terminal-desktop\/\S+/, "") + " HOCDesktop/" + app.getVersion());

    // links: terminal + sign-in inside the app, everything else in the default browser
    wc.setWindowOpenHandler(({ url }) => {
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
    win.loadURL(HOME);
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
        const ok = ["notifications", "clipboard-sanitized-write", "clipboard-read", "fullscreen"].includes(perm) && inside(details.requestingUrl || wc.getURL());
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
        if (key === "background" || key === "startHidden") updateTray();
        if (key === "badge") applyBadge();
        return S;
    });
    ipcMain.on("hoc:badge", (e, n) => {
        if (!fromTerminal(e)) return;
        unread = Math.max(0, Math.min(999, Math.round(Number(n) || 0)));
        applyBadge();
    });
    ipcMain.on("hoc:focus", (e) => fromTerminal(e) && showWindow());
    // the terminal switched between light and dark: window buttons, window background and system theme follow
    ipcMain.on("hoc:theme", (e, t) => {
        if (!fromTerminal(e)) return;
        const light = t === "light";
        nativeTheme.themeSource = light ? "light" : "dark";
        if (win) {
            try {
                if (!IS_MAC) win.setTitleBarOverlay(overlayFor(light));
                win.setBackgroundColor(light ? "#f4f5f7" : "#050505");
            } catch {
                /* ignore */
            }
        }
        if (light !== lightUi) {
            lightUi = light;
            saveSettings();
        }
    });
    ipcMain.handle("hoc:test", (e) => {
        if (!fromTerminal(e) || !Notification.isSupported()) return false;
        const n = new Notification({ title: "HOC Terminal", body: "Notifications are working. You'll see alerts like this one.", icon: IS_MAC ? undefined : appIcon() });
        n.on("click", () => showWindow());
        n.show();
        return true;
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
