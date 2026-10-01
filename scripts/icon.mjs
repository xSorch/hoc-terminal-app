// Renders build/icon.svg to build/icon.png (1024 px) before packaging; electron-builder makes the .ico / .icns from it.
import { readFileSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
const svg = readFileSync(new URL("../build/icon.svg", import.meta.url), "utf8");
const png = new Resvg(svg, { fitTo: { mode: "width", value: 1024 } }).render().asPng();
writeFileSync(new URL("../build/icon.png", import.meta.url), png);
console.log("icon.png", png.length, "bytes");
