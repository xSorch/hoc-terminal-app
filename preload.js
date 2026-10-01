// What the terminal can ask the desktop app (nothing else from the computer is exposed):
// its version, the app settings (startup, background, badge), the unread count on the icon, bringing the window
// to the front and a test notification.
const { contextBridge, ipcRenderer } = require("electron");
const arg = (process.argv || []).find((a) => a.startsWith("--hoc-version="));
contextBridge.exposeInMainWorld("hocDesktop", {
    app: true,
    platform: process.platform,
    version: arg ? arg.slice("--hoc-version=".length) : "",
    titleBar: "custom", // the window draws its own title bar (the terminal's top bar is the drag area)
    getSettings: () => ipcRenderer.invoke("hoc:get"),
    setSetting: (key, value) => ipcRenderer.invoke("hoc:set", key, value),
    setBadge: (n) => ipcRenderer.send("hoc:badge", n),
    focus: () => ipcRenderer.send("hoc:focus"),
    testNotification: () => ipcRenderer.invoke("hoc:test"),
});
