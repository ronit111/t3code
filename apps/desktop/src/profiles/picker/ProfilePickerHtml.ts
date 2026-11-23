// No script: the sandboxed preload renders the DOM in its isolated world. The tokens mirror
// apps/web/src/index.css and the look mirrors components/ui (Button, Input, Menu, Badge) and
// SettingsGroup, resolved to plain CSS because this page cannot load the web bundle.
export const PROFILE_PICKER_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>T3 Code</title><style>
:root {
  color-scheme: light dark;
  --background: oklch(99.2% 0 0);
  --foreground: oklch(21% 0.006 285.885);
  --card: #fff;
  --popover: #fff;
  --primary: oklch(0.488 0.217 264);
  --primary-foreground: #fff;
  --muted-foreground: oklch(55.2% 0.016 285.938);
  --accent: oklch(96.7% 0.001 286.375);
  --border: oklch(92% 0.004 286.32);
  --input: oklch(87.1% 0.006 286.286);
  --ring: var(--primary);
  --destructive: oklch(63.7% 0.237 25.331);
  --destructive-foreground: oklch(50.5% 0.213 27.518);
  --warning: oklch(76.9% 0.188 70.08);
  --warning-foreground: oklch(55.5% 0.163 48.998);
  --warning-surface: color-mix(in srgb, var(--warning) 8%, transparent);
  --field: var(--background);
  --control: var(--popover);
  --control-hover: color-mix(in srgb, var(--accent) 50%, var(--popover));
  --control-edge: inset 0 -1px rgb(0 0 0 / 4%);
  --avatar: oklch(92% 0.004 286.32);
  --menu-shadow: 0 16px 40px -18px rgb(0 0 0 / 55%);
  --font-sans: -apple-system, BlinkMacSystemFont, "Inter Variable", "Segoe UI", system-ui, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root {
    --background: #000;
    --foreground: oklch(97% 0 0);
    --card: color-mix(in srgb, oklch(14.5% 0 0) 97%, #fff);
    --popover: color-mix(in srgb, oklch(14.5% 0 0) 97%, #fff);
    --primary: oklch(0.571 0.21 264);
    --muted-foreground: oklch(70.8% 0 0);
    --accent: rgb(255 255 255 / 4%);
    --border: rgb(255 255 255 / 8%);
    --input: rgb(255 255 255 / 11%);
    --destructive: color-mix(in srgb, oklch(63.7% 0.237 25.331) 90%, #fff);
    --destructive-foreground: oklch(70.4% 0.191 22.216);
    --warning-foreground: oklch(82.8% 0.189 84.429);
    --warning-surface: color-mix(in srgb, var(--warning) 16%, transparent);
    --field: rgb(255 255 255 / 3.5%);
    --control: rgb(255 255 255 / 3.5%);
    --control-hover: rgb(255 255 255 / 7%);
    --control-edge: inset 0 1px rgb(255 255 255 / 6%);
    --avatar: rgb(255 255 255 / 10%);
    --menu-shadow: 0 18px 44px -18px rgb(0 0 0 / 80%);
  }
}
* { box-sizing: border-box; }
html, body { height: 100%; }
body { margin: 0; overflow: hidden; background: var(--background); color: var(--foreground); font: 14px/20px var(--font-sans); -webkit-font-smoothing: antialiased; -webkit-user-select: none; user-select: none; }
.titlebar { position: fixed; inset: 0 0 auto; height: 40px; -webkit-app-region: drag; }
main { display: flex; flex-direction: column; justify-content: safe center; height: 100%; overflow-y: auto; padding: 44px 28px 32px; }
.brand { display: flex; align-items: baseline; gap: 6px; color: var(--muted-foreground); }
.brand svg { flex: none; width: auto; height: 12px; color: var(--foreground); }
.brand span { font-size: 18px; line-height: 28px; font-weight: 500; letter-spacing: -0.025em; }
#root { display: flex; flex-direction: column; margin-top: 20px; }
h1 { margin: 0 0 16px; font-size: 20px; line-height: 1.25; font-weight: 600; }
p { margin: 0; }
svg.icon { flex: none; width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
.muted { color: var(--muted-foreground); font-size: 12px; line-height: 16px; }
.error { color: var(--destructive-foreground); font-size: 12px; line-height: 16px; font-weight: 400; }
.banner { margin-bottom: 12px; padding: 10px 14px; border-radius: 12px; border: 1px solid color-mix(in srgb, var(--warning) 32%, transparent); background: var(--warning-surface); color: var(--warning-foreground); }
.banner.alert { border-color: color-mix(in srgb, var(--destructive) 32%, transparent); background: color-mix(in srgb, var(--destructive) 8%, transparent); color: var(--destructive-foreground); overflow-wrap: anywhere; }
.list { border-radius: 12px; border: 1px solid color-mix(in srgb, var(--border) 60%, transparent); background: color-mix(in srgb, var(--card) 40%, transparent); box-shadow: 0 1px 2px rgb(0 0 0 / 5%); }
.row { position: relative; }
.row + .row { border-top: 1px solid color-mix(in srgb, var(--border) 50%, transparent); }
.row-main { display: flex; align-items: center; gap: 4px; padding-right: 10px; }
.row-main:hover { background: var(--accent); }
.row:first-child > .row-main { border-top-left-radius: 11px; border-top-right-radius: 11px; }
.row:last-child:not(:has(.unlock)) > .row-main { border-bottom-left-radius: 11px; border-bottom-right-radius: 11px; }
.row-open { flex: 1; display: flex; align-items: center; justify-content: flex-start; gap: 10px; min-width: 0; height: 52px; padding: 0 4px 0 14px; border: 0; border-radius: inherit; background: transparent; box-shadow: none; color: inherit; font: inherit; text-align: left; cursor: pointer; outline: none; }
.row-open:hover { background: transparent; }
.row-main:has(.row-open:focus-visible) { background: var(--accent); box-shadow: inset 0 0 0 2px var(--ring); }
.avatar { flex: none; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 999px; background: var(--avatar); color: var(--foreground); font-size: 12px; font-weight: 600; line-height: 1; }
.row-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.row-open .icon { width: 14px; height: 14px; color: var(--muted-foreground); }
.badge { flex: none; margin-left: auto; height: 20px; padding: 0 6px; border-radius: 4px; border: 1px solid var(--border); color: var(--muted-foreground); font-size: 11px; line-height: 18px; font-weight: 500; }
.unlock { display: flex; flex-direction: column; gap: 6px; padding: 2px 14px 14px 52px; }
.inline { display: flex; gap: 8px; }
.inline input { flex: 1; min-width: 0; }
.menu { position: absolute; right: 10px; top: 44px; z-index: 1; display: flex; flex-direction: column; min-width: 180px; padding: 4px; border-radius: 8px; border: 1px solid color-mix(in srgb, var(--foreground) 10%, transparent); background: var(--popover); box-shadow: var(--menu-shadow); }
.menu.up { top: auto; bottom: 44px; }
.menu button { justify-content: flex-start; height: 28px; padding: 0 8px; border: 0; border-radius: 4px; background: transparent; box-shadow: none; font-weight: 400; }
.menu button:hover, .menu button:focus-visible { background: var(--accent); box-shadow: none; }
.menu .danger { color: var(--destructive-foreground); }
form { display: flex; flex-direction: column; gap: 14px; }
label { display: flex; flex-direction: column; gap: 6px; font-weight: 500; }
input { width: 100%; height: 32px; padding: 0 11px; border-radius: 8px; border: 1px solid var(--input); background: var(--field); color: inherit; font: inherit; font-weight: 400; outline: none; box-shadow: 0 1px 2px rgb(0 0 0 / 5%); transition: box-shadow 150ms, border-color 150ms; -webkit-user-select: text; user-select: text; }
input::placeholder { color: var(--muted-foreground); }
input:focus-visible { border-color: var(--ring); box-shadow: inset 0 0 0 3px color-mix(in srgb, var(--ring) 24%, transparent); }
input[aria-invalid="true"] { border-color: color-mix(in srgb, var(--destructive) 36%, transparent); }
input[aria-invalid="true"]:focus-visible { border-color: color-mix(in srgb, var(--destructive) 64%, transparent); box-shadow: inset 0 0 0 3px color-mix(in srgb, var(--destructive) 16%, transparent); }
input:disabled { opacity: 0.64; }
.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
form > .actions { margin-top: 4px; }
button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 11px; border-radius: 8px; border: 1px solid var(--input); background: var(--control); box-shadow: 0 1px 2px rgb(0 0 0 / 5%), var(--control-edge); color: var(--foreground); font: inherit; font-weight: 500; white-space: nowrap; cursor: pointer; outline: none; transition: box-shadow 150ms, scale 150ms; }
button:where(:hover) { background: var(--control-hover); }
button:where(:active:not(:disabled, .row-open, [role=menuitem])) { scale: 0.97; box-shadow: none; }
button:where(:focus-visible) { box-shadow: inset 0 0 0 2px var(--ring); }
button.primary { border-color: var(--primary); background: var(--primary); color: var(--primary-foreground); box-shadow: inset 0 1px rgb(255 255 255 / 16%), 0 1px 2px color-mix(in srgb, var(--primary) 24%, transparent); }
button.primary:hover { background: color-mix(in srgb, var(--primary) 90%, transparent); }
button.primary:focus-visible { box-shadow: inset 0 0 0 2px var(--ring), inset 0 0 0 3px var(--background); }
button.icon { width: 28px; height: 28px; padding: 0; border-color: transparent; background: transparent; box-shadow: none; color: var(--muted-foreground); }
button.icon:hover, button.icon[aria-expanded="true"] { background: color-mix(in srgb, var(--foreground) 6%, transparent); color: var(--foreground); }
button:where(:disabled) { opacity: 0.64; cursor: default; }
</style></head><body><div class="titlebar"></div><main>
<div class="brand" role="img" aria-label="T3 Code"><svg viewBox="15.5309 37 94.3941 56.96" aria-hidden="true"><path fill="currentColor" d="M33.4509 93V47.56H15.5309V37H64.3309V47.56H46.4109V93H33.4509ZM86.7253 93.96C82.832 93.96 78.9653 93.4533 75.1253 92.44C71.2853 91.3733 68.032 89.88 65.3653 87.96L70.4053 78.04C72.5386 79.5867 75.0186 80.8133 77.8453 81.72C80.672 82.6267 83.5253 83.08 86.4053 83.08C89.6586 83.08 92.2186 82.44 94.0853 81.16C95.952 79.88 96.8853 78.12 96.8853 75.88C96.8853 73.7467 96.0586 72.0667 94.4053 70.84C92.752 69.6133 90.0853 69 86.4053 69H80.4853V60.44L96.0853 42.76L97.5253 47.4H68.1653V37H107.365V45.4L91.8453 63.08L85.2853 59.32H89.0453C95.9253 59.32 101.125 60.8667 104.645 63.96C108.165 67.0533 109.925 71.0267 109.925 75.88C109.925 79.0267 109.099 81.9867 107.445 84.76C105.792 87.48 103.259 89.6933 99.8453 91.4C96.432 93.1067 92.0586 93.96 86.7253 93.96Z"/></svg><span aria-hidden="true">Code</span></div>
<div id="root" aria-live="polite"></div>
</main></body></html>`;
