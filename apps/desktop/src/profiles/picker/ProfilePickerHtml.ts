// No script: the sandboxed preload renders the DOM in its isolated world.
export const PROFILE_PICKER_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>T3 Code</title><style>
:root { color-scheme: light dark; --bg: #f5f5f5; --card: #fff; --row-hover: #ececec; --text: #1f1f1f; --muted: #6b6b6b; --line: #e2e2e2; --accent: #0a64d8; --accent-text: #fff; --danger: #c4231c; --banner: #fff4d6; }
@media (prefers-color-scheme: dark) { :root { --bg: #1c1c1c; --card: #262626; --row-hover: #323232; --text: #f2f2f2; --muted: #a0a0a0; --line: #3a3a3a; --accent: #3d8bfd; --accent-text: #fff; --danger: #ff6b63; --banner: #3d3420; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 13px/18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; -webkit-user-select: none; user-select: none; }
main { display: flex; flex-direction: column; gap: 16px; height: 100vh; padding: 28px 24px 20px; }
h1 { margin: 0; font-size: 17px; line-height: 22px; font-weight: 600; text-align: center; }
p { margin: 0; }
.muted { color: var(--muted); }
.banner { padding: 8px 12px; border-radius: 8px; background: var(--banner); }
.list { display: flex; flex-direction: column; gap: 2px; overflow-y: auto; flex: 1; padding: 4px; margin: -4px; }
.row { position: relative; border-radius: 8px; background: var(--card); border: 1px solid var(--line); }
.row-main { display: flex; align-items: center; gap: 8px; padding: 0 4px 0 0; }
.row-open { flex: 1; display: flex; align-items: center; gap: 8px; min-width: 0; height: 40px; padding: 0 12px; border: 0; border-radius: 8px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: default; }
.row-open:hover { background: var(--row-hover); }
.row-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.tag { flex: none; padding: 1px 6px; border-radius: 4px; border: 1px solid var(--line); color: var(--muted); font-size: 11px; line-height: 16px; }
.lock { flex: none; width: 12px; height: 12px; color: var(--muted); }
.unlock { display: flex; flex-direction: column; gap: 6px; padding: 0 12px 12px; }
.inline { display: flex; gap: 8px; }
.inline input { flex: 1; }
.menu { position: absolute; right: 4px; top: 38px; z-index: 1; display: flex; flex-direction: column; min-width: 180px; padding: 4px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); box-shadow: 0 4px 16px rgb(0 0 0 / 0.18); }
.menu button { justify-content: flex-start; border: 0; background: transparent; height: 26px; }
.menu button:hover { background: var(--row-hover); }
.menu .danger { color: var(--danger); }
form { display: flex; flex-direction: column; gap: 12px; }
main > form { flex: 1; }
label { display: flex; flex-direction: column; gap: 4px; font-weight: 500; }
input { height: 28px; padding: 0 8px; border-radius: 6px; border: 1px solid var(--line); background: var(--card); color: inherit; font: inherit; -webkit-user-select: text; user-select: text; }
input:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.error { color: var(--danger); font-weight: 400; }
.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: auto; }
button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 28px; padding: 0 12px; border-radius: 6px; border: 1px solid var(--line); background: var(--card); color: inherit; font: inherit; cursor: default; }
button.primary { border-color: var(--accent); background: var(--accent); color: var(--accent-text); }
button.icon { width: 28px; padding: 0; border: 0; background: transparent; color: var(--muted); }
button.icon:hover { background: var(--row-hover); }
button:disabled { opacity: 0.5; }
</style></head><body><main id="root" aria-live="polite"></main></body></html>`;
