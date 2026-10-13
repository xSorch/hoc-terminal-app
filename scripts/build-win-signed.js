// Signed Windows build on your own PC with the Certum cloud certificate (Oct 13, 2026).
// The certificate lives in SimplySign, so it can't be used from GitHub Actions. Before running:
//   1. SimplySign Desktop is installed and you are logged in (code from the SimplySign phone app).
//   2. npm install (once).
// Usage:  npm run dist:win:signed -- 1.9.1
// The signed installers (x64 and arm64) end up in dist/. Upload them to the GitHub release.
const { execSync } = require("child_process");
const builder = require("electron-builder");
const pkg = require("../package.json");

const version = process.argv[2] || pkg.version;
// Matches the certificate in the Windows store that SimplySign Desktop provides (part of its subject name)
const subject = process.env.HOC_SIGN_SUBJECT || "Henrich Osei";

execSync("node scripts/icon.mjs", { stdio: "inherit" });

const config = {
    ...pkg.build,
    extraMetadata: { version },
    win: {
        ...pkg.build.win,
        signtoolOptions: {
            certificateSubjectName: subject,
            signingHashAlgorithms: ["sha256"],
            rfc3161TimeStampServer: "http://time.certum.pl",
        },
    },
};

console.log(`Building HOC Terminal ${version} for Windows, signed as "${subject}"…`);
builder
    .build({ targets: builder.Platform.WINDOWS.createTarget(), config, publish: "never" })
    .then((files) => {
        console.log("\nSigned installers:");
        files.filter((f) => /\.exe$/i.test(f)).forEach((f) => console.log("  " + f));
        console.log("\nCheck: right-click an installer > Properties > Digital Signatures should list the certificate.");
    })
    .catch((e) => {
        console.error("\nSigned build failed:", e && e.message ? e.message : e);
        console.error("Is SimplySign Desktop running and logged in? Does the certificate show in certmgr.msc > Personal?");
        process.exit(1);
    });
