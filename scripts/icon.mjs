// Renders the app icons before packaging.
// build/icon.svg  -> build/icon.png      (Mac: logo on a dark rounded tile, like other Mac apps; electron-builder makes the .icns)
// build/icon-win.svg -> build/icon-win.png (Windows: just the white logo, no square behind it)
//                    -> build/icon.ico     (Windows: every size Windows shows – 16 to 256 px – each drawn sharp at its
//                                           own size, so the Start menu, desktop and taskbar icons aren't blurry)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
const svgOf = (name) => readFileSync(new URL(`../build/${name}.svg`, import.meta.url), "utf8");
const render = (svg, size) => new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
for (const name of ["icon", "icon-win"]) {
    const png = render(svgOf(name), 1024);
    writeFileSync(new URL(`../build/${name}.png`, import.meta.url), png);
    console.log(`${name}.png`, png.length, "bytes");
}
// .ico with PNG entries (Windows Vista and later)
// Nov 18 (Henrich: the taskbar icon "seem off and low quality"): Windows draws the taskbar icon at 24 px × the display
// scale (30 px at 125%, 36 px at 150%, 42 at 175%); without those sizes it shrank the 40 / 48 px one and blurred it
const SIZES = [16, 20, 24, 30, 32, 36, 40, 42, 48, 60, 64, 72, 80, 96, 128, 256];
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

// Installer artwork (Oct 13)
// build/installer-sidebar.svg -> build/installerSidebar.bmp (Windows installer welcome/finish page, 164x314)
// build/installer-header.svg  -> build/installerHeader.bmp  (Windows installer header on the other pages, 150x57)
// build/dmg-background.svg    -> build/background.png + background@2x.png (Mac "drag to Applications" window)
// NSIS only reads 24-bit BMP files, so these are written by hand: bottom-up rows, BGR, each row padded to 4 bytes.
const bmp = (svg, w) => {
    const img = new Resvg(svg, { fitTo: { mode: "width", value: w }, background: "#ffffff" }).render();
    const W = img.width, H = img.height, px = img.pixels, row = Math.ceil((W * 3) / 4) * 4;
    const out = Buffer.alloc(54 + row * H);
    out.write("BM", 0);
    out.writeUInt32LE(out.length, 2);
    out.writeUInt32LE(54, 10);
    out.writeUInt32LE(40, 14);
    out.writeInt32LE(W, 18);
    out.writeInt32LE(H, 22);
    out.writeUInt16LE(1, 26);
    out.writeUInt16LE(24, 28);
    out.writeUInt32LE(row * H, 34);
    out.writeInt32LE(2835, 38);
    out.writeInt32LE(2835, 42);
    for (let y = 0; y < H; y++) {
        const o = 54 + (H - 1 - y) * row;
        for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            out[o + x * 3] = px[i + 2];
            out[o + x * 3 + 1] = px[i + 1];
            out[o + x * 3 + 2] = px[i];
        }
    }
    return out;
};
for (const [name, file, w] of [["installer-sidebar", "installerSidebar.bmp", 164], ["installer-header", "installerHeader.bmp", 150]]) {
    const b = bmp(svgOf(name), w);
    writeFileSync(new URL(`../build/${file}`, import.meta.url), b);
    console.log(file, b.length, "bytes");
}
const dmg = svgOf("dmg-background");
writeFileSync(new URL("../build/background.png", import.meta.url), render(dmg, 540));
writeFileSync(new URL("../build/background@2x.png", import.meta.url), render(dmg, 1080));
console.log("background.png + background@2x.png");

// Nov 18: the unread badge on the Windows taskbar, drawn with a real font at every display scale (it was a 5 × 7 pixel
// font scaled up, which looked blocky): a plain red disc like Discord's (no edge), white bold count, 1–9 and "9+".
// main.js puts the sizes together as one image (16 px at 100%, 20 at 125%, 24 at 150%, 28 at 175%, 32 at 200%).
mkdirSync(new URL("../build/badges/", import.meta.url), { recursive: true });
const badgeSvg = (label) => {
    const two = label.length > 1;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="31" fill="#f23f43"/><text x="32" y="${two ? 41.5 : 43.5}" text-anchor="middle" font-family="Segoe UI, Arial, Helvetica, sans-serif" font-weight="700" font-size="${two ? 25 : 32}" letter-spacing="${two ? -1 : 0}" fill="#fff">${label}</text></svg>`;
};
for (const label of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "9+"])
    for (const sz of [16, 20, 24, 28, 32]) {
        const png = new Resvg(badgeSvg(label), { fitTo: { mode: "width", value: sz }, font: { loadSystemFonts: true, defaultFontFamily: "Arial" } }).render().asPng();
        writeFileSync(new URL(`../build/badges/${label === "9+" ? "9p" : label}-${sz}.png`, import.meta.url), png);
    }
console.log("badges: 1-9, 9+ at 16/20/24/28/32 px");
