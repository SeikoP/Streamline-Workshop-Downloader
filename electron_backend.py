import argparse
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from downloader import WebMainGuiApi


ALLOWED_API_METHODS = {
    "add_account",
    "add_workshop_item",
    "add_workshop_mods",
    "browse_export_queue_file",
    "browse_import_queue_file",
    "cancel_download",
    "change_provider_for_mods",
    "clear_logs",
    "close_steamcmd_login_session",
    "download_workshop_item_now",
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
    "search_games",
    "search_workshop_app",
    "send_steamcmd_login_input",
    "set_active_account",
    "set_global_provider",
    "start_download",
    "update_appids",
    "update_settings",
}


class ElectronApiServer:
    def __init__(self, api):
        self.api = api

    def call(self, method_name, args=None):
        method_name = str(method_name or "").strip()
        args = args if isinstance(args, list) else []
        if not method_name or method_name.startswith("_") or method_name not in ALLOWED_API_METHODS:
            return {"success": False, "error": "Invalid API method."}

        target = getattr(self.api, method_name, None)
        if target is None or not callable(target):
            return {"success": False, "error": f"Unknown API method: {method_name}"}
        return target(*args)


def make_handler(api_server):
    class Handler(BaseHTTPRequestHandler):
        server_version = "StreamlineElectronBridge/1.0"

        def _send_json(self, payload, status=200):
            data = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_OPTIONS(self):
            self._send_json({"success": True})

        def do_POST(self):
            length = int(self.headers.get("Content-Length", "0") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            try:
                body = json.loads(raw.decode("utf-8") or "{}")
            except Exception:
                body = {}
            parsed = urlparse(self.path)
            if parsed.path != "/api/call":
                self._send_json({"success": False, "error": f"Unknown endpoint: {parsed.path}"}, status=404)
                return
            try:
                self._send_json(api_server.call(body.get("method", ""), body.get("args", [])))
            except Exception as exc:
                self._send_json({"success": False, "error": str(exc)}, status=500)

        def log_message(self, _format, *_args):
            return

    return Handler


def create_api():
    script_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "downloader.py"))
    files_dir = os.path.join(os.path.dirname(script_path), "Files")
    return WebMainGuiApi(script_path, files_dir)


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=0)
    args = parser.parse_args(argv)

    api_server = ElectronApiServer(create_api())
    httpd = ThreadingHTTPServer((args.host, args.port), make_handler(api_server))
    host, port = httpd.server_address
    print(f"STREAMLINE_ELECTRON_BACKEND=http://{host}:{port}", flush=True)

    try:
        httpd.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass
    finally:
        httpd.shutdown()
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
