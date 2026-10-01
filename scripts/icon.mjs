// Renders the app icons before packaging.
// build/icon.svg  -> build/icon.png      (Mac: logo on a dark rounded tile, like other Mac apps; electron-builder makes the .icns)
// build/icon-win.svg -> build/icon-win.png (Windows: just the white logo, no square behind it)
//                    -> build/icon.ico     (Windows: every size Windows shows – 16 to 256 px – each drawn sharp at its
//                                           own size, so the Start menu, desktop and taskbar icons aren't blurry)
import { readFileSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
const svgOf = (name) => readFileSync(new URL(`../build/${name}.svg`, import.meta.url), "utf8");
const render = (svg, size) => new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
for (const name of ["icon", "icon-win"]) {
    const png = render(svgOf(name), 1024);
    writeFileSync(new URL(`../build/${name}.png`, import.meta.url), png);
    console.log(`${name}.png`, png.length, "bytes");
}
// .ico with PNG entries (Windows Vista and later)
const SIZES = [16, 20, 24, 32, 40, 48, 64, 72, 96, 128, 256];
const win = svgOf("icon-win");
const imgs = SIZES.map((s) => render(win, s));
const head = Buffer.alloc(6 + 16 * SIZES.length);
head.writeUInt16LE(0, 0);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(SIZES.length, 4);
let off = head.length;
SIZES.forEach((s, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(s >= 256 ? 0 : s, e);
    head.writeUInt8(s >= 256 ? 0 : s, e + 1);
    head.writeUInt8(0, e + 2);
    head.writeUInt8(0, e + 3);
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(imgs[i].length, e + 8);
    head.writeUInt32LE(off, e + 12);
    off += imgs[i].length;
});
const ico = Buffer.concat([head, ...imgs]);
writeFileSync(new URL("../build/icon.ico", import.meta.url), ico);
console.log("icon.ico", ico.length, "bytes,", SIZES.join("/"), "px");
