const { app, BrowserWindow, BrowserView, dialog, ipcMain, Menu, shell, Tray } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

let mainWindow = null;
let backendProcess = null;
let backendUrl = "";
let tray = null;
let shouldQuit = false;
let reloadTimer = null;
let uiWatchers = [];
let resizeState = null;
let dragState = null;
let workshopBrowserView = null;
let workshopBrowserScopeAppId = "";
let workshopBrowserAllowedModIds = new Set();

const isDevMode = process.argv.includes("--dev") || process.env.STREAMLINE_ELECTRON_DEV === "1";
const MIN_WINDOW_WIDTH = 695;
const MIN_WINDOW_HEIGHT = 775;
const DEFAULT_WINDOW_WIDTH = MIN_WINDOW_WIDTH;
const DEFAULT_WINDOW_HEIGHT = MIN_WINDOW_HEIGHT;
const WORKSHOP_HOME_URL = "https://steamcommunity.com/workshop/browse/";

function pythonExecutable() {
  const root = path.resolve(__dirname, "..");
  const venvPython = path.join(root, "venv", "Scripts", "python.exe");
  const venvConfig = path.join(root, "venv", "pyvenv.cfg");
  if (fs.existsSync(venvPython) && fs.existsSync(venvConfig)) {
    return { command: venvPython, argsPrefix: [] };
  }
  return process.platform === "win32"
    ? { command: "py", argsPrefix: ["-3.11"] }
    : { command: "python3", argsPrefix: [] };
}

function startBackend() {
  return new Promise((resolve, reject) => {
    const root = path.resolve(__dirname, "..");
    const python = pythonExecutable();
    const child = spawn(python.command, [...python.argsPrefix, "electron_backend.py"], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    backendProcess = child;

    const timeout = setTimeout(() => {
      reject(new Error("Timed out while starting Python backend."));
    }, 20000);

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      const match = text.match(/STREAMLINE_ELECTRON_BACKEND=(http:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        backendUrl = match[1];
        resolve(backendUrl);
      }
    });

    child.stderr.on("data", (chunk) => {
      console.error(chunk.toString("utf8"));
    });

    child.on("exit", (code) => {
      if (!backendUrl) {
        clearTimeout(timeout);
        reject(new Error(`Python backend exited before ready (${code}).`));
      }
    });
  });
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    backgroundColor: "#1e1e1e",
    frame: false,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  });

  await mainWindow.loadFile(path.join(__dirname, "..", "Files", "webui", "index.html"));
  mainWindow.on("close", (event) => {
    if (!shouldQuit) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function ensureWorkshopBrowserView() {
  if (workshopBrowserView) {
    return workshopBrowserView;
  }
  if (typeof BrowserView !== "function") {
    throw new Error("Electron BrowserView is unavailable in this runtime.");
  }
  workshopBrowserView = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  workshopBrowserView.webContents.setWindowOpenHandler(({ url }) => {
    if (!isWorkshopBrowserUrlAllowed(url)) {
      mainWindow?.webContents.send("workshop-browser:event", {
        type: "blocked",
        url,
        error: `Blocked outside AppID ${workshopBrowserScopeAppId}.`
      });
      return { action: "deny" };
    }
    workshopBrowserView?.webContents.loadURL(url);
    return { action: "deny" };
  });
  workshopBrowserView.webContents.on("will-navigate", (event, url) => {
    if (!isWorkshopBrowserUrlAllowed(url)) {
      event.preventDefault();
      mainWindow?.webContents.send("workshop-browser:event", {
        type: "blocked",
        url,
        error: `Blocked outside AppID ${workshopBrowserScopeAppId}.`
      });
    }
  });
  workshopBrowserView.webContents.on("did-start-loading", () => {
    mainWindow?.webContents.send("workshop-browser:event", {
      type: "loading",
      url: workshopBrowserView?.webContents.getURL() || ""
    });
  });
  workshopBrowserView.webContents.on("did-finish-load", () => {
    hideGoogleTranslateToolbar(workshopBrowserView.webContents);
    mainWindow?.webContents.send("workshop-browser:event", {
      type: "loaded",
      url: workshopBrowserView?.webContents.getURL() || ""
    });
  });
  workshopBrowserView.webContents.on("did-frame-finish-load", () => {
    hideGoogleTranslateToolbar(workshopBrowserView?.webContents);
  });
  workshopBrowserView.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame === false) {
      return;
    }
    mainWindow?.webContents.send("workshop-browser:event", {
      type: "failed",
      url: validatedURL || workshopBrowserView?.webContents.getURL() || "",
      errorCode,
      error: errorDescription || "Failed to load Workshop page."
    });
  });
  return workshopBrowserView;
}

function isGoogleTranslatedPage(url) {
  const text = String(url || "");
  return /translate\.goog\//i.test(text) || /translate\.google\.[^/]+\/translate/i.test(text);
}

function hideGoogleTranslateToolbar(webContents) {
  if (!webContents || webContents.isDestroyed() || !isGoogleTranslatedPage(webContents.getURL())) {
    return;
  }
  const cleanupScript = `
    (() => {
      const styleId = "streamline-hide-google-translate-toolbar";
      const css = [
        'iframe[src*="translate.google.com/websitetranslationui"]',
        'iframe[src*="translate.googleapis.com"]',
        'iframe.goog-te-banner-frame',
        '.goog-te-banner-frame',
        '.goog-te-balloon-frame',
        '#goog-gt-tt',
        '.skiptranslate'
      ].join(',') + '{display:none!important;visibility:hidden!important;height:0!important;min-height:0!important;max-height:0!important;}'
        + ' body{top:0!important;margin-top:0!important;}'
        + ' html{margin-top:0!important;}';
      let style = document.getElementById(styleId);
      if (!style) {
        style = document.createElement('style');
        style.id = styleId;
        (document.head || document.documentElement).appendChild(style);
      }
      style.textContent = css;
      const selectors = [
        'iframe[src*="translate.google.com/websitetranslationui"]',
        'iframe[src*="translate.googleapis.com"]',
        'iframe.goog-te-banner-frame',
        '.goog-te-banner-frame',
        '.goog-te-balloon-frame',
        '#goog-gt-tt',
        '.skiptranslate'
      ];
      const cleanup = () => {
        document.documentElement.style.marginTop = '0px';
        if (document.body) {
          document.body.style.top = '0px';
          document.body.style.marginTop = '0px';
        }
        document.querySelectorAll(selectors.join(',')).forEach((node) => node.remove());
      };
      cleanup();
      if (!window.__streamlineGoogleTranslateToolbarObserver) {
        window.__streamlineGoogleTranslateToolbarObserver = new MutationObserver(cleanup);
        window.__streamlineGoogleTranslateToolbarObserver.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['style', 'class']
        });
      }
      return true;
    })();
  `;
  webContents.executeJavaScript(cleanupScript, true).catch(() => null);
}

function extractSteamAppId(url) {
  const text = String(url || "");
  const patterns = [
    /steamcommunity\.com\/app\/(\d+)/i,
    /store\.steampowered\.com\/app\/(\d+)/i,
    /[?&]appid=(\d+)/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return "";
}

function extractSteamWorkshopModId(url) {
  const match = String(url || "").match(/[?&]id=(\d+)/i);
  return match ? match[1] : "";
}

function isWorkshopBrowserUrlAllowed(url) {
  const scope = String(workshopBrowserScopeAppId || "").trim();
  if (!scope) {
    return true;
  }
  const text = String(url || "");
  if (/steamcommunity\.com\/(sharedfiles|workshop)\/filedetails\/\?/i.test(text)) {
    const modId = extractSteamWorkshopModId(text);
    if (modId && workshopBrowserAllowedModIds.has(modId)) {
      return true;
    }
    const currentAppId = extractSteamAppId(workshopBrowserView?.webContents.getURL() || "");
    return currentAppId === scope;
  }
  if (/translate\.google\.[^/]+\/translate/i.test(text)) {
    const embeddedMatch = text.match(/[?&]u=([^&]+)/i);
    if (!embeddedMatch) {
      return true;
    }
    try {
      return isWorkshopBrowserUrlAllowed(decodeURIComponent(embeddedMatch[1]));
    } catch {
      return true;
    }
  }
  const appId = extractSteamAppId(text);
  if (appId) {
    return appId === scope;
  }
  return /^(about:blank)?$/i.test(text);
}

function attachWorkshopBrowserView() {
  if (!mainWindow) {
    return null;
  }
  const view = ensureWorkshopBrowserView();
  const attached = mainWindow.getBrowserViews().includes(view);
  if (!attached) {
    mainWindow.addBrowserView(view);
  }
  return view;
}

function clampBrowserBounds(bounds) {
  const next = bounds && typeof bounds === "object" ? bounds : {};
  return {
    x: Math.max(0, Math.floor(Number(next.x || 0))),
    y: Math.max(0, Math.floor(Number(next.y || 0))),
    width: Math.max(80, Math.floor(Number(next.width || 0))),
    height: Math.max(80, Math.floor(Number(next.height || 0)))
  };
}

function hideWorkshopBrowserView() {
  if (!mainWindow || !workshopBrowserView) {
    return;
  }
  if (mainWindow.getBrowserViews().includes(workshopBrowserView)) {
    mainWindow.removeBrowserView(workshopBrowserView);
  }
}

function scheduleRendererReload(changedPath) {
  if (!mainWindow) {
    return;
  }
  if (reloadTimer) {
    clearTimeout(reloadTimer);
  }
  reloadTimer = setTimeout(() => {
    reloadTimer = null;
    console.log(`Reloading Electron UI: ${changedPath}`);
    mainWindow?.webContents.reloadIgnoringCache();
  }, 120);
}

function watchElectronUi() {
  if (!isDevMode || uiWatchers.length) {
    return;
  }
  [
    path.join("..", "Files", "webui", "index.html"),
    path.join("..", "Files", "webui", "styles.css"),
    path.join("..", "Files", "webui", "app.js")
  ].forEach((fileName) => {
    const filePath = path.join(__dirname, fileName);
    try {
      const watcher = fs.watch(filePath, { persistent: false }, () => scheduleRendererReload(fileName));
      uiWatchers.push(watcher);
    } catch (error) {
      console.warn(`Unable to watch ${fileName}: ${error.message}`);
    }
  });
  console.log("Electron UI hot reload enabled.");
}

function createTray() {
  if (tray) {
    return;
  }
  const iconPath = path.join(__dirname, "..", "Files", "logo.png");
  tray = new Tray(iconPath);
  tray.setToolTip("Streamline Workshop Downloader");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show Streamline", click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: "Quit", click: () => { shouldQuit = true; app.quit(); } }
  ]));
  tray.on("click", () => {
    if (!mainWindow) {
      return;
    }
    mainWindow.show();
    mainWindow.focus();
  });
}

ipcMain.handle("pywebview:call", async (_event, method, args) => {
  const response = await fetch(`${backendUrl}/api/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, args: Array.isArray(args) ? args : [] })
  });
  return response.json();
});

ipcMain.handle("window:minimize", () => {
  mainWindow?.minimize();
  return { success: true };
});

ipcMain.handle("window:hide-to-tray", () => {
  mainWindow?.hide();
  return { success: true };
});

ipcMain.handle("window:drag-begin", (_event, screenX, screenY) => {
  if (!mainWindow || mainWindow.isMaximized()) {
    dragState = null;
    return { success: false, error: "Window is not movable." };
  }
  const [x, y] = mainWindow.getPosition();
  dragState = {
    x,
    y,
    startScreenX: Number(screenX || 0),
    startScreenY: Number(screenY || 0)
  };
  return { success: true };
});

ipcMain.handle("window:drag-update", (_event, screenX, screenY) => {
  if (!mainWindow || !dragState) {
    return { success: false, error: "No active drag session." };
  }
  const dx = Math.round(Number(screenX || 0) - dragState.startScreenX);
  const dy = Math.round(Number(screenY || 0) - dragState.startScreenY);
  mainWindow.setPosition(dragState.x + dx, dragState.y + dy, false);
  return { success: true };
});

ipcMain.handle("window:drag-end", () => {
  dragState = null;
  return { success: true };
});

ipcMain.handle("window:resize-begin", (_event, mode) => {
  if (!mainWindow || mainWindow.isMaximized()) {
    resizeState = null;
    return { success: false, error: "Window is not resizable." };
  }
  const [x, y] = mainWindow.getPosition();
  const [width, height] = mainWindow.getSize();
  resizeState = {
    mode: String(mode || "southeast"),
    x,
    y,
    width,
    height
  };
  mainWindow.setResizable(true);
  return { success: true, strategy: "pointer" };
});

ipcMain.handle("window:resize-update", (_event, screenX, screenY, startScreenX, startScreenY) => {
  if (!mainWindow || !resizeState) {
    return { success: false, error: "No active resize session." };
  }
  const [minWidth, minHeight] = mainWindow.getMinimumSize();
  const dx = Math.round(Number(screenX || 0) - Number(startScreenX || 0));
  const dy = Math.round(Number(screenY || 0) - Number(startScreenY || 0));
  let nextWidth = resizeState.width;
  let nextHeight = resizeState.height;

  if (resizeState.mode === "east" || resizeState.mode === "southeast") {
    nextWidth = Math.max(minWidth, resizeState.width + dx);
  }
  if (resizeState.mode === "south" || resizeState.mode === "southeast") {
    nextHeight = Math.max(minHeight, resizeState.height + dy);
  }

  const clampedWidth = Math.max(MIN_WINDOW_WIDTH, nextWidth);
  const clampedHeight = Math.max(MIN_WINDOW_HEIGHT, nextHeight);
  mainWindow.setBounds({
    x: resizeState.x,
    y: resizeState.y,
    width: clampedWidth,
    height: clampedHeight
  }, false);
  return { success: true, width: clampedWidth, height: clampedHeight };
});

ipcMain.handle("window:resize-end", () => {
  if (mainWindow) {
    const [width, height] = mainWindow.getSize();
    if (width < MIN_WINDOW_WIDTH || height < MIN_WINDOW_HEIGHT) {
      mainWindow.setSize(
        Math.max(MIN_WINDOW_WIDTH, width),
        Math.max(MIN_WINDOW_HEIGHT, height),
        false
      );
    }
  }
  resizeState = null;
  mainWindow?.setResizable(false);
  return { success: true };
});

ipcMain.handle("dialog:open-queue-file", async () => {
  if (!mainWindow) {
    return { success: false, error: "Window is not ready." };
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [
      { name: "Text files", extensions: ["txt"] },
      { name: "All files", extensions: ["*"] }
    ]
  });
  if (result.canceled || !result.filePaths.length) {
    return { success: false, cancelled: true };
  }
  return { success: true, path: result.filePaths[0] };
});

ipcMain.handle("dialog:save-queue-file", async () => {
  if (!mainWindow) {
    return { success: false, error: "Window is not ready." };
  }
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: "queue_export.txt",
    filters: [
      { name: "Text files", extensions: ["txt"] },
      { name: "All files", extensions: ["*"] }
    ]
  });
  if (result.canceled || !result.filePath) {
    return { success: false, cancelled: true };
  }
  return { success: true, path: result.filePath };
});

ipcMain.handle("shell:open-external", (_event, url) => {
  return shell.openExternal(String(url || ""));
});

ipcMain.handle("workshop-browser:show", (_event, bounds) => {
  try {
    const view = attachWorkshopBrowserView();
    if (!view) {
      return { success: false, error: "Window is not ready." };
    }
    view.setBounds(clampBrowserBounds(bounds));
    view.setAutoResize({ width: true, height: true });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || "Failed to show Workshop browser." };
  }
});

ipcMain.handle("workshop-browser:hide", () => {
  hideWorkshopBrowserView();
  return { success: true };
});

ipcMain.handle("workshop-browser:resize", (_event, bounds) => {
  try {
    const view = attachWorkshopBrowserView();
    if (!view) {
      return { success: false, error: "Window is not ready." };
    }
    view.setBounds(clampBrowserBounds(bounds));
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || "Failed to resize Workshop browser." };
  }
});

ipcMain.handle("workshop-browser:navigate", async (_event, url, bounds) => {
  try {
    const view = attachWorkshopBrowserView();
    if (!view) {
      return { success: false, error: "Window is not ready." };
    }
    view.setBounds(clampBrowserBounds(bounds));
    const targetUrl = String(url || WORKSHOP_HOME_URL);
    if (!isWorkshopBrowserUrlAllowed(targetUrl)) {
      return { success: false, error: `Blocked outside AppID ${workshopBrowserScopeAppId}.` };
    }
    await view.webContents.loadURL(targetUrl);
    return { success: true, url: targetUrl };
  } catch (error) {
    return { success: false, error: error.message || "Failed to load Workshop page." };
  }
});

ipcMain.handle("workshop-browser:get-url", () => {
  if (!workshopBrowserView) {
    return { success: true, url: "" };
  }
  return { success: true, url: workshopBrowserView.webContents.getURL() };
});

ipcMain.handle("workshop-browser:set-scope", (_event, appId) => {
  const value = String(appId || "").trim();
  workshopBrowserScopeAppId = /^\d+$/.test(value) ? value : "";
  if (!workshopBrowserScopeAppId) {
    workshopBrowserAllowedModIds = new Set();
  }
  return { success: true, appId: workshopBrowserScopeAppId };
});

ipcMain.handle("workshop-browser:set-allowed-mods", (_event, modIds) => {
  const ids = Array.isArray(modIds) ? modIds : [];
  workshopBrowserAllowedModIds = new Set(
    ids.map((id) => String(id || "").trim()).filter((id) => /^\d+$/.test(id))
  );
  return { success: true, count: workshopBrowserAllowedModIds.size };
});

ipcMain.handle("workshop-browser:back", () => {
  if (!workshopBrowserView || !workshopBrowserView.webContents.canGoBack()) {
    return { success: false, error: "No previous page." };
  }
  workshopBrowserView.webContents.goBack();
  return { success: true };
});

ipcMain.handle("workshop-browser:forward", () => {
  if (!workshopBrowserView || !workshopBrowserView.webContents.canGoForward()) {
    return { success: false, error: "No next page." };
  }
  workshopBrowserView.webContents.goForward();
  return { success: true };
});

app.whenReady().then(async () => {
  await startBackend();
  await createMainWindow();
  watchElectronUi();
  createTray();
});

app.on("before-quit", () => {
  shouldQuit = true;
  uiWatchers.forEach((watcher) => watcher.close());
  uiWatchers = [];
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
