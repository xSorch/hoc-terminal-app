// What the terminal can ask the desktop app (nothing else from the computer is exposed):
// its version, the app settings (startup, background, badge), the unread count on the icon, bringing the window
// to the front, a test notification and full screen.
const { contextBridge, ipcRenderer } = require("electron");
const arg = (process.argv || []).find((a) => a.startsWith("--hoc-version="));
contextBridge.exposeInMainWorld("hocDesktop", {
    app: true,
    platform: process.platform,
    version: arg ? arg.slice("--hoc-version=".length) : "",
    naturalScroll: (process.argv || []).includes("--hoc-natural=1"), // Mac trackpad "natural" scrolling is on
    titleBar: "custom", // the window draws its own title bar (the terminal's top bar is the drag area)
    getSettings: () => ipcRenderer.invoke("hoc:get"),
    setSetting: (key, value) => ipcRenderer.invoke("hoc:set", key, value),
    setBadge: (n) => ipcRenderer.send("hoc:badge", n),
    focus: () => ipcRenderer.send("hoc:focus"),
    testNotification: () => ipcRenderer.invoke("hoc:test"),
    setTheme: (t) => ipcRenderer.send("hoc:theme", t), // light / dark: colours the window buttons to match
    setTitleColor: (c) => ipcRenderer.send("hoc:tbcolor", c), // Windows: colour behind the window buttons (dims with pop-ups)
    // native full screen (the terminal's full screen button and F11)
    setFullScreen: (on) => ipcRenderer.send("hoc:fullscreen", on),
    isFullScreen: () => ipcRenderer.invoke("hoc:isfs"),
    onFullScreen: (cb) => ipcRenderer.on("hoc:fs", (_e, on) => cb(Boolean(on))),
});
