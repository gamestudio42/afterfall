import { app, BrowserWindow, ipcMain, Menu, net, protocol, shell } from "electron";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Desktop shell: serves the built web game from `app://game/` in a sandboxed window with a minimal
 * preload. The fixed origin keeps saves and settings in place across versions; everything works
 * offline except an explicit real-map download. `--smoke` starts a generated city and reports on stdout.
 * It does not touch `window.__afterfall`: that hook stays out of production builds.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const GAME_DIR = path.join(here, "..", "game");
const ORIGIN = "app://game";
const smoke = process.argv.includes("--smoke");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

if (smoke) {
  // Software WebGL, matching the browser tests. CI also passes these flags to the snap.
  app.commandLine.appendSwitch("ignore-gpu-blocklist");
  app.commandLine.appendSwitch("enable-unsafe-swiftshader");
  app.commandLine.appendSwitch("use-angle", "swiftshader");
}

async function serve(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (url.host !== "game") return new Response("Not found", { status: 404 });
  const rel = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const file = path.normalize(path.join(GAME_DIR, rel));
  if (!file.startsWith(GAME_DIR + path.sep)) return new Response("Not found", { status: 404 });
  const res = await net.fetch(pathToFileURL(file).toString()).catch(() => null);
  if (!res?.ok) return new Response("Not found", { status: 404 });
  return new Response(res.body, {
    status: 200,
    headers: {
      "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' data: blob: https://overpass-api.de https://overpass.private.coffee https://nominatim.openstreetmap.org",
    },
  });
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: "#11141a",
    title: "AFTERFALL",
    show: !smoke,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(here, "..", "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: !app.isPackaged,
    },
  });
  // Stay inside the game: external links open in the browser, nothing else navigates.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(ORIGIN)) event.preventDefault();
  });
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "F11") {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });
  void win.loadURL(`${ORIGIN}/index.html`);
  return win;
}

/** Polls a page expression until it is truthy; returns its value, or null on timeout. */
async function until<T>(win: BrowserWindow, expr: string, ms = 60_000): Promise<T | null> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = (await win.webContents.executeJavaScript(expr).catch(() => null)) as T | null;
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

const clickWhenReady = (win: BrowserWindow, testId: string): Promise<boolean | null> =>
  until<boolean>(
    win,
    `(() => { const b = document.querySelector('[data-testid="${testId}"]'); if (!b) return false; b.click(); return true; })()`,
  );

/** `--smoke`: hidden window, starts a generated city, checks the shell, storage and the desktop bridge. */
async function runSmoke(win: BrowserWindow): Promise<void> {
  const errors: string[] = [];
  win.webContents.on("console-message", (event) => {
    const entry = event as unknown as { level: string; message: string };
    if (entry.level === "error") errors.push(entry.message);
  });
  const started =
    (await clickWhenReady(win, "new-game")) &&
    (await clickWhenReady(win, "start")) &&
    (await until(win, "!!document.querySelector('[data-testid=\"topbar\"]')"));
  const result = await win.webContents
    .executeJavaScript(
      `({ href: location.href, storage: (localStorage.setItem('afterfall:smoke', '1'), localStorage.getItem('afterfall:smoke') === '1'), desktop: !!window.afterfallDesktop, screen: document.querySelector('[data-testid="topbar"]') ? 'game' : 'menu' })`,
    )
    .catch(() => null);
  const ready = !!started && !!result?.storage && !!result?.desktop && result?.screen === "game" && !errors.length;
  console.log(`SMOKE ${JSON.stringify({ ready, errors, ...result })}`);
  app.exit(ready ? 0 : 1);
}

void app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  ipcMain.on("afterfall:quit", () => app.quit());
  protocol.handle("app", serve);
  const win = createWindow();
  if (smoke) await runSmoke(win);
});

app.on("window-all-closed", () => app.quit());
