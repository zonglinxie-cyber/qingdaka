
"""轻打卡 · 本地开发服务器（静态文件服务）"""
from __future__ import annotations

import argparse
import socket
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class Handler(SimpleHTTPRequestHandler):

    def log_message(self, format, *args):
        pass

    def handle_one_request(self):
        # 页面切换可能取消尚未完成的静态资源请求。
        try:
            super().handle_one_request()
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


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
    print("局域网 HTTP 仅用于布局预览；完整跟练、主屏安装和离线测试请使用 HTTPS。")


def main():
    parser = argparse.ArgumentParser(description="轻打卡本地服务（静态文件服务）")
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
    port = server.server_address[1]
    print(f"轻打卡 → http://127.0.0.1:{port}/index.html（静态目录：{static_directory}）", flush=True)
    if host == "0.0.0.0":
        print_mobile_qr_hint(port)
    print("按 Ctrl+C 停止")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
        server.server_close()


if __name__ == "__main__":
    main()
