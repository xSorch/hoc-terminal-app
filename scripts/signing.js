// Turns on code signing for a release build when the certificates are in the repo secrets.
// Run by the Release workflow before electron-builder: `node scripts/signing.js mac` or `node scripts/signing.js win`.
// Without certificates nothing changes and the build stays unsigned (as before).
//
// Mac (Apple Developer Program): secrets MAC_CERT_P12_BASE64 + MAC_CERT_PASSWORD (a "Developer ID Application"
// certificate exported as .p12, base64), and for notarization APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID.
// Windows: secrets WIN_CERT_P12_BASE64 + WIN_CERT_PASSWORD (a code-signing certificate as .pfx, base64).
const fs = require("fs");
const path = require("path");
const os = process.argv[2];
const file = path.join(__dirname, "..", "package.json");
const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
const b = pkg.build;
if (os === "mac") {
    delete b.mac.identity; // use the Developer ID certificate from CSC_LINK instead of ad-hoc signing
    b.mac.hardenedRuntime = true;
    b.mac.gatekeeperAssess = false;
    b.mac.entitlements = "build/entitlements.mac.plist";
    b.mac.entitlementsInherit = "build/entitlements.mac.plist";
    b.mac.notarize = Boolean(process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID);
    console.log(`Mac: signing with the Developer ID certificate${b.mac.notarize ? " and notarizing with Apple" : " (no Apple ID secrets, so not notarized)"}.`);
} else if (os === "win") {
    b.win.signAndEditExecutable = true;
    b.win.signtoolOptions = { ...(b.win.signtoolOptions || {}), publisherName: process.env.WIN_PUBLISHER_NAME || undefined, signingHashAlgorithms: ["sha256"], rfc3161TimeStampServer: "http://timestamp.digicert.com" };
    if (!b.win.signtoolOptions.publisherName) delete b.win.signtoolOptions.publisherName;
    console.log("Windows: signing the installer and app with the code-signing certificate.");
} else {
    console.error("usage: node scripts/signing.js mac|win");
    process.exit(1);
}
fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
