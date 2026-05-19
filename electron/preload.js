const { contextBridge, ipcRenderer } = require("electron");

function markElectronShell() {
  document.documentElement.classList.add("electron-shell");
  if (document.body) {
    document.body.classList.add("electron-shell");
  }
}

function installElectronDragStyle() {
  if (document.getElementById("electron-drag-style")) {
    return;
  }
  const style = document.createElement("style");
  style.id = "electron-drag-style";
  style.textContent = `
    html.electron-shell .pywebview-drag-region,
    body.electron-shell .pywebview-drag-region {
      -webkit-app-region: no-drag !important;
      cursor: default;
    }
  `;
  document.head.appendChild(style);
}

function installTitlebarDrag() {
  let dragging = false;

  const isInteractiveTarget = (target) => {
    return Boolean(target?.closest?.("button, input, select, textarea, a, [role='button'], .titlebar-actions"));
  };

  document.addEventListener("mousedown", async (event) => {
    if (event.button !== 0 || isInteractiveTarget(event.target)) {
      return;
    }
    if (!event.target?.closest?.(".pywebview-drag-region")) {
      return;
    }
    dragging = true;
    event.preventDefault();
    event.stopPropagation();
    await ipcRenderer.invoke("window:drag-begin", event.screenX, event.screenY);
  }, true);

  document.addEventListener("mousemove", (event) => {
    if (!dragging) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    ipcRenderer.invoke("window:drag-update", event.screenX, event.screenY);
  }, true);

  document.addEventListener("mouseup", (event) => {
    if (!dragging) {
      return;
    }
    dragging = false;
    event.preventDefault();
    event.stopPropagation();
    ipcRenderer.invoke("window:drag-end");
  }, true);

  window.addEventListener("blur", () => {
    if (dragging) {
      dragging = false;
      ipcRenderer.invoke("window:drag-end");
    }
  });
}

window.addEventListener("DOMContentLoaded", () => {
  markElectronShell();
  installElectronDragStyle();
  installTitlebarDrag();
});

const apiMethods = [
  "add_account",
  "add_workshop_mods",
  "add_workshop_item",
  "begin_window_resize",
  "browse_export_queue_file",
  "browse_import_queue_file",
  "cancel_download",
  "change_provider_for_mods",
  "clear_logs",
  "close_steamcmd_login_session",
  "close_window",
  "download_workshop_item_now",
  "end_window_resize",
  "export_queue",
  "get_accounts",
  "get_appids_info",
  "get_bootstrap_data",
  "get_preview_queue",
  "get_queue",
  "get_queue_page",
  "get_settings",
  "import_queue",
  "launch_documentation",
  "launch_report_issue",
  "launch_repository",
  "launch_steamcmd_login",
  "minimize_window",
  "move_mods",
  "open_downloads_folder",
  "override_appid",
  "poll_events",
  "poll_steamcmd_login_session",
  "purge_accounts",
  "remove_account",
  "remove_mods",
  "reorder_accounts",
  "reset_status",
  "send_steamcmd_login_input",
  "set_active_account",
  "set_global_provider",
  "search_workshop_app",
  "start_download",
  "update_appids",
  "update_settings",
  "update_window_resize"
];

async function callPythonApi(method, args) {
  if (method === "minimize_window") {
    return ipcRenderer.invoke("window:minimize");
  }
  if (method === "close_window") {
    return ipcRenderer.invoke("window:hide-to-tray");
  }
  if (method === "browse_import_queue_file") {
    return ipcRenderer.invoke("dialog:open-queue-file");
  }
  if (method === "browse_export_queue_file") {
    return ipcRenderer.invoke("dialog:save-queue-file");
  }
  if (method === "open_workshop_browser") {
    const result = await ipcRenderer.invoke("pywebview:call", method, args);
    if (result?.success && result.url) {
      await ipcRenderer.invoke("shell:open-external", result.url);
    }
    return result;
  }
  if (method === "begin_window_resize") {
    return ipcRenderer.invoke("window:resize-begin", args?.[0]);
  }
  if (method === "update_window_resize") {
    return ipcRenderer.invoke("window:resize-update", args?.[0], args?.[1], args?.[2], args?.[3]);
  }
  if (method === "end_window_resize") {
    return ipcRenderer.invoke("window:resize-end");
  }
  return ipcRenderer.invoke("pywebview:call", method, args);
}

const pywebviewApi = {};
apiMethods.forEach((method) => {
  pywebviewApi[method] = (...args) => callPythonApi(method, args);
});

contextBridge.exposeInMainWorld("pywebview", {
  api: pywebviewApi
});

contextBridge.exposeInMainWorld("streamlineElectron", {
  browse: {
    show: (bounds) => ipcRenderer.invoke("workshop-browser:show", bounds),
    hide: () => ipcRenderer.invoke("workshop-browser:hide"),
    resize: (bounds) => ipcRenderer.invoke("workshop-browser:resize", bounds),
    navigate: (url, bounds) => ipcRenderer.invoke("workshop-browser:navigate", url, bounds),
    back: () => ipcRenderer.invoke("workshop-browser:back"),
    forward: () => ipcRenderer.invoke("workshop-browser:forward"),
    setScope: (appId) => ipcRenderer.invoke("workshop-browser:set-scope", appId),
    setAllowedMods: (modIds) => ipcRenderer.invoke("workshop-browser:set-allowed-mods", modIds),
    getUrl: () => ipcRenderer.invoke("workshop-browser:get-url"),
    onEvent: (callback) => {
      if (typeof callback !== "function") {
        return () => {};
      }
      const listener = (_event, payload) => callback(payload || {});
      ipcRenderer.on("workshop-browser:event", listener);
      return () => ipcRenderer.removeListener("workshop-browser:event", listener);
    }
  }
});
