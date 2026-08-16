#!/usr/bin/env python3
"""轻打卡 · 本地开发服务器（静态 + 拍照 relay）"""
from __future__ import annotations

import argparse
import json
import socket
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from relay_http import handle_protein_photo, parse_content_length, read_body_or_error, check_origin, check_rate_limit

RELAY_PATHS = frozenset({"/api/protein-photo", "/api/protein-photo/"})


class Handler(SimpleHTTPRequestHandler):
    # Python mimetypes 默认把 .m4a 标成 audio/mp4a-latm，微信/iOS 需要 audio/mp4
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".m4a": "audio/mp4",
        ".mp3": "audio/mpeg",
        ".aac": "audio/aac",
    }

    def log_message(self, fmt, *args):
        pass

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path in RELAY_PATHS:
            self._send_json(405, {"error": {"message": "use POST"}})
            return
        return SimpleHTTPRequestHandler.do_GET(self)

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path in RELAY_PATHS:
            self._handle_protein_photo()
            return
        self.send_error(404, "Not Found")

    def _handle_protein_photo(self):
        # Origin 校验
        origin = self.headers.get("Origin")
        referer = self.headers.get("Referer")
        if not check_origin(origin, referer):
            self._send_json(403, {"error": {"message": "forbidden origin"}})
            return
        # IP 限流
        client_ip = self.client_address[0] if self.client_address else "unknown"
        if not check_rate_limit(client_ip):
            self._send_json(429, {"error": {"message": "rate limit exceeded"}})
            return
        api_key = self.headers.get("X-DashScope-Key") or self.headers.get("x-dashscope-key") or ""
        cl = parse_content_length(self.headers.get("Content-Length"))
        try:
            n = cl if cl is not None else 0
            body = self.rfile.read(n) if n else b""
        except OSError:
            self._send_json(400, {"error": {"message": "failed to read body"}})
            return

        err = read_body_or_error(cl, body)
        if err:
            status, data, content_type = err
            self._respond(status, data, content_type)
            return

        status, data, content_type = handle_protein_photo(api_key, body)
        self._respond(status, data, content_type)

    def _respond(self, status: int, data: bytes, content_type: str):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _send_json(self, status: int, obj: dict):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self._respond(status, data, "application/json; charset=utf-8")


def guess_lan_ip() -> str | None:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return None


def print_mobile_qr_hint(port: int) -> None:
    ip = guess_lan_ip()
    if not ip:
        print("手机：未能检测局域网 IP，请在本机 Wi-Fi 详情中查看 IP 后手动访问。")
        return
    url = f"http://{ip}:{port}/index.html"
    print(f"手机同 Wi-Fi 打开 → {url}")
    png = Path("mobile-qr.png")
    try:
        import qrcode

        qrcode.make(url).save(png)
        print(f"扫码图已生成 → {png.resolve()}（扫此图或 AirDrop 到手机）")
    except ImportError:
        print("生成扫码图: pip install 'qrcode[pil]' 后重新 --lan，或运行 python3 scripts/mobile_qr.py")


def main():
    parser = argparse.ArgumentParser(description="轻打卡本地服务（静态 + /api/protein-photo）")
    parser.add_argument("port", nargs="?", type=int, default=8899, help="端口，默认 8899")
    parser.add_argument(
        "--directory",
        default=".",
        help="静态文件根目录，默认当前目录；部署产物验证时使用 dist",
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="监听地址，默认仅本机；手机联调可用 --host 0.0.0.0 或 --lan",
    )
    parser.add_argument("--lan", action="store_true", help="等价 --host 0.0.0.0")
    args = parser.parse_args()
    host = "0.0.0.0" if args.lan else args.host
    static_directory = Path(args.directory).resolve()
    if not static_directory.is_dir():
        parser.error(f"静态目录不存在：{static_directory}")

    handler = partial(Handler, directory=str(static_directory))
    server = ThreadingHTTPServer((host, args.port), handler)
    print(f"轻打卡 → http://127.0.0.1:{args.port}/index.html（静态目录：{static_directory}）")
    if host == "0.0.0.0":
        print_mobile_qr_hint(args.port)
    print("拍照 relay → POST /api/protein-photo")
    print("按 Ctrl+C 停止")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
        server.server_close()


if __name__ == "__main__":
    main()
