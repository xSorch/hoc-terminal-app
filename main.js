// HOC Terminal desktop app (Windows + macOS). A window around the live terminal, so every update to
// terminal.hocapital.net shows up in the app straight away. Sign-in (Whop / Discord) happens inside the window;
// other links open in the normal browser.
const { app, BrowserWindow, Menu, shell, session, nativeTheme, screen } = require("electron");
const path = require("path");
const fs = require("fs");

const HOME = "https://terminal.hocapital.net/";
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
function saveState(win) {
    try {
        const b = win.getNormalBounds();
        fs.writeFileSync(stateFile(), JSON.stringify({ ...b, maximized: win.isMaximized() }));
    } catch {
        /* ignore */
    }
}

let win = null;
function createWindow() {
    const st = loadState();
    win = new BrowserWindow({
        x: st.x,
        y: st.y,
        width: st.width || 1440,
        height: st.height || 900,
        minWidth: 900,
        minHeight: 600,
        title: "HOC Terminal",
        backgroundColor: "#050505",
        show: false,
        autoHideMenuBar: true,
        titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
        trafficLightPosition: { x: 14, y: 14 },
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            spellcheck: true,
        },
    });
    if (st.maximized) win.maximize();
    win.once("ready-to-show", () => win.show());
    ["resize", "move", "close"].forEach((e) => win.on(e, () => saveState(win)));

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
    wc.on("page-title-updated", (e, t) => {
        e.preventDefault();
        win.setTitle(t && t !== "HOC Terminal" ? `${t} · HOC Terminal` : "HOC Terminal");
    });
    win.loadURL(HOME);
}

// downloads (CSV exports, chart snapshots) go to the Downloads folder with a save dialog
function handleDownloads() {
    session.defaultSession.on("will-download", (e, item) => {
        item.setSaveDialogOptions({ defaultPath: path.join(app.getPath("downloads"), item.getFilename()) });
    });
}
// camera / microphone / notifications: only notifications and clipboard are allowed (for alerts and copy buttons)
function handlePermissions() {
    session.defaultSession.setPermissionRequestHandler((wc, perm, cb, details) => {
        const ok = ["notifications", "clipboard-sanitized-write", "clipboard-read", "fullscreen"].includes(perm) && inside(details.requestingUrl || wc.getURL());
        cb(ok);
    });
}

function buildMenu() {
    const isMac = process.platform === "darwin";
    const go = (p) => win && win.loadURL(new URL(p, HOME).toString());
    const template = [
        ...(isMac ? [{ role: "appMenu" }] : []),
        {
            label: "File",
            submenu: [{ label: "Home", accelerator: "CmdOrCtrl+Shift+H", click: () => go("/") }, { label: "Journal", click: () => go("/journal") }, { label: "Backtesting", click: () => go("/backtesting") }, { label: "Market Analysis", click: () => go("/analysis") }, { type: "separator" }, isMac ? { role: "close" } : { role: "quit" }],
        },
        { role: "editMenu" },
        {
            label: "View",
            submenu: [{ role: "reload" }, { role: "forceReload" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }, ...(app.isPackaged ? [] : [{ role: "toggleDevTools" }])],
        },
        {
            label: "Navigate",
            submenu: [
                { label: "Back", accelerator: isMac ? "Cmd+[" : "Alt+Left", click: () => win && win.webContents.navigationHistory.canGoBack() && win.webContents.navigationHistory.goBack() },
                { label: "Forward", accelerator: isMac ? "Cmd+]" : "Alt+Right", click: () => win && win.webContents.navigationHistory.canGoForward() && win.webContents.navigationHistory.goForward() },
            ],
        },
        { role: "windowMenu" },
        {
            role: "help",
            submenu: [{ label: "hocapital.net", click: () => shell.openExternal("https://hocapital.net") }, { label: "Changelog", click: () => shell.openExternal("https://hocapital.net/changelog") }],
        },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// one window only: opening the app again focuses it
if (!app.requestSingleInstanceLock()) app.quit();
else {
    app.on("second-instance", () => {
        if (!win) return;
        if (win.isMinimized()) win.restore();
        win.focus();
    });
    app.whenReady().then(() => {
        nativeTheme.themeSource = "dark";
        if (process.platform === "win32") app.setAppUserModelId("net.hocapital.terminal");
        handleDownloads();
        handlePermissions();
        buildMenu();
        createWindow();
        app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
    });
    app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());
}
