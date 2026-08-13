"""Vercel Serverless：POST /api/protein-photo（与 serve.py 同源转发逻辑）。"""
from __future__ import annotations

import os
import sys

# 仓库根目录加入 path，以便 import relay_*
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from http.server import BaseHTTPRequestHandler

from relay_http import handle_protein_photo, parse_content_length, read_body_or_error, check_origin, check_rate_limit


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self._json(405, {"error": {"message": "use POST"}})

    def do_POST(self):
        # Origin 校验
        origin = self.headers.get("Origin")
        referer = self.headers.get("Referer")
        if not check_origin(origin, referer):
            self._json(403, {"error": {"message": "forbidden origin"}})
            return
        # IP 限流
        client_ip = self.client_address[0] if self.client_address else "unknown"
        if not check_rate_limit(client_ip):
            self._json(429, {"error": {"message": "rate limit exceeded"}})
            return
        api_key = self.headers.get("X-DashScope-Key") or self.headers.get("x-dashscope-key") or ""
        cl = parse_content_length(self.headers.get("Content-Length"))
        try:
            n = cl if cl is not None else 0
            body = self.rfile.read(n) if n else b""
        except Exception:
            self._json(400, {"error": {"message": "failed to read body"}})
            return

        err = read_body_or_error(cl, body)
        if err:
            status, data, ctype = err
            self._respond(status, data, ctype)
            return

        status, data, ctype = handle_protein_photo(api_key, body)
        self._respond(status, data, ctype)

    def log_message(self, fmt, *args):
        pass

    def _json(self, status: int, obj: dict):
        import json

        self._respond(status, json.dumps(obj, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def _respond(self, status: int, data: bytes, content_type: str):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)
