// The HOC pop-up notification (Windows / Mac app), as a page for the frameless corner window.
// Nov 7: own file so it can be previewed outside the app (scripts/toast-preview.js).
function toastHtml(n, light, timeText) {
    const title = String(n.title || "HOC Terminal").slice(0, 90);
    const body = String(n.body || "").slice(0, 220);
    const kind = ["alert", "news", "booking", "session"].includes(n.kind) ? n.kind : "news";
    // Nov 7 (Henrich: "update the notifications"): the pop-up in the terminal's current look – square corners, the HOC mark,
    // a small mono label with the kind and time, a thin accent line and a bar that runs down until it closes; light or dark
    // like the terminal
    const accent = { alert: "#f59e0b", news: "#3b82f6", booking: "#22c55e", session: "#a78bfa" }[kind];
    const label = { alert: "Alert", news: "News", booking: "Booking", session: "Session" }[kind];
    const notes = { alert: [880, 1320], news: [660], booking: [523.25, 783.99], session: [523.25, 659.25, 783.99] }[kind];
    const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    const sound = n.sound === false ? "" : `try{const a=new AudioContext();${JSON.stringify(notes)}.forEach((f,i)=>{const o=a.createOscillator(),g=a.createGain();o.type="sine";o.frequency.value=f;const s=a.currentTime+i*.11;g.gain.setValueAtTime(0,s);g.gain.linearRampToValueAtTime(.07,s+.015);g.gain.exponentialRampToValueAtTime(.0001,s+.5);o.connect(g).connect(a.destination);o.start(s);o.stop(s+.55)})}catch(e){}`;
    const L = light;
    const C = L
        ? { bg: "#ffffff", line: "rgba(17,17,17,.12)", ink: "#111111", ink2: "#3f3f46", ink3: "#71717a", x: "#a1a1aa", xh: "#111111", track: "rgba(17,17,17,.06)", shadow: "0 10px 30px rgba(17,17,17,.12)" }
        : { bg: "#0b0c0e", line: "rgba(255,255,255,.1)", ink: "#f4f4f5", ink2: "#a1a1aa", ink3: "#71717a", x: "#52525b", xh: "#f4f4f5", track: "rgba(255,255,255,.05)", shadow: "0 12px 32px rgba(0,0,0,.55)" };
    const now = timeText || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const MARK = '<svg viewBox="5 13 118 102" width="18" height="16" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M30.2 72.0 L26.2 79.4 L33.0 91.9 L33.1 93.5 L19.1 101.9 L17.5 101.6 L15.6 99.0 L14.8 99.0 L8.2 109.4 L6.9 113.4 L22.9 113.8 L23.6 112.9 L23.0 109.8 L24.0 108.4 L37.9 101.0 L46.0 113.4 L54.1 113.6 L54.6 112.6 L31.8 72.6ZM47.5 42.5 L34.2 64.4 L32.6 69.0 L49.4 98.8 L58.6 113.6 L88.8 113.6 L89.0 112.2 L57.5 57.1 L50.5 45.1 L48.4 42.5ZM47.5 58.4 L49.0 59.0 L74.9 104.4 L74.6 105.8 L63.6 105.8 L54.1 90.5 L42.0 69.1 L43.1 65.4ZM63.8 15.0 L50.5 37.0 L50.1 39.1 L92.2 112.5 L93.8 113.8 L120.8 113.6 L120.9 111.9 L100.5 76.9 L94.9 79.5 L93.9 81.0 L106.8 103.4 L106.8 105.8 L99.2 106.0 L97.9 105.4 L59.5 39.0 L62.4 33.0 L64.6 31.5 L75.9 50.2 L78.5 50.6 L83.2 47.6 L81.6 43.4 L66.6 17.4 L64.6 15.0Z"/></svg>';
    const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent;overflow:hidden;font:13px/1.4 Inter,-apple-system,"Segoe UI",system-ui,sans-serif;-webkit-user-select:none;user-select:none;cursor:pointer}
.c{position:absolute;inset:6px 6px 8px 6px;border-radius:4px;background:${C.bg};border:1px solid ${C.line};box-shadow:${C.shadow};box-sizing:border-box;padding:10px 32px 12px 14px;color:${C.ink};overflow:hidden;opacity:0;transform:translateX(24px);transition:opacity .25s ease,transform .3s cubic-bezier(.2,.8,.2,1)}
.c.in{opacity:1;transform:none}
.c::before{content:"";position:absolute;left:0;top:0;bottom:0;width:2px;background:${accent}}
.h{display:flex;align-items:center;gap:8px;margin-bottom:5px;font:600 10px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.14em;text-transform:uppercase;color:${C.ink3}}
.h svg{color:${C.ink};flex:none}.h i{width:6px;height:6px;border-radius:50%;background:${accent};flex:none}.h .k{color:${C.ink2}}.h .tm{margin-left:auto;letter-spacing:.06em}
.t b{display:block;font-size:13.5px;font-weight:600;color:${C.ink};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:-.005em}
.t span{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:${C.ink2};font-size:12.5px;margin-top:1px}
.x{position:absolute;top:7px;right:9px;width:18px;height:18px;display:grid;place-items:center;color:${C.x};font-size:15px;line-height:1;text-decoration:none;border-radius:3px}.x:hover{color:${C.xh};background:${C.track}}
.p{position:absolute;left:0;right:0;bottom:0;height:2px;background:${C.track}}.p::after{content:"";position:absolute;left:0;top:0;bottom:0;width:100%;background:${accent};opacity:.7;transform-origin:left;animation:run 7s linear forwards}
@keyframes run{to{transform:scaleX(0)}}</style>
<div class="c" id="c"><div class="h">${MARK}<span>HOC Terminal</span><i></i><span class="k">${label}</span><span class="tm">${now}</span></div><div class="t"><b>${esc(title)}</b>${body ? `<span>${esc(body)}</span>` : ""}</div><a class="x" href="hoc://close" title="Close">×</a><div class="p"></div></div>
<script>requestAnimationFrame(()=>document.getElementById("c").classList.add("in"));document.getElementById("c").addEventListener("click",(e)=>{if(!e.target.closest(".x"))location.href="hoc://open"});${sound}</script>`;
    return html;
}
module.exports = { toastHtml };
