// Renders the app icons before packaging; electron-builder makes the .ico / .icns from them.
// build/icon.svg  -> build/icon.png      (Mac: logo on a dark rounded tile, like other Mac apps)
// build/icon-win.svg -> build/icon-win.png (Windows: just the white logo, no square behind it)
import { readFileSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
for (const name of ["icon", "icon-win"]) {
    const svg = readFileSync(new URL(`../build/${name}.svg`, import.meta.url), "utf8");
    const png = new Resvg(svg, { fitTo: { mode: "width", value: 1024 } }).render().asPng();
    writeFileSync(new URL(`../build/${name}.png`, import.meta.url), png);
    console.log(`${name}.png`, png.length, "bytes");
}
