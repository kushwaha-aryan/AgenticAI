import json
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from llm_client import load_dotenv

ROOT = os.path.dirname(os.path.abspath(__file__))
DOCS_DIR = os.path.join(ROOT, "docs")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DOCS_DIR, **kwargs)

    def do_GET(self):
        if self.path.split("?")[0] == "/api/config":
            api_key = os.environ.get("GROQ_API_KEY")
            if not api_key:
                self.send_response(404)
                self.send_header("Content-Type", "application/json")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(json.dumps({"error": "GROQ_API_KEY not set"}).encode())
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(json.dumps({"api_key": api_key}).encode())
            return
        return super().do_GET()

    def log_message(self, fmt, *args):
        print("[server]", fmt % args)


def main():
    load_dotenv()
    port = int(os.environ.get("PORT", "8080"))
    host = os.environ.get("HOST", "127.0.0.1")
    server = ThreadingHTTPServer((host, port), Handler)
    has_key = bool(os.environ.get("GROQ_API_KEY"))
    print("=" * 60)
    print(f"Serving docs/ at http://{host}:{port}")
    print(f"GROQ_API_KEY from env/.env: {'present' if has_key else 'MISSING (web app will ask to paste a key)'}")
    print("Stop with Ctrl+C")
    print("=" * 60)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()