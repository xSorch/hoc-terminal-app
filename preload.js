// Tells the terminal it's running in the desktop app (e.g. to hide the "install the app" hint). Nothing else is exposed.
const { contextBridge } = require("electron");
contextBridge.exposeInMainWorld("hocDesktop", { platform: process.platform, app: true });
