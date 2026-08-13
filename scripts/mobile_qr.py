#!/usr/bin/env python3
"""生成手机局域网访问链接与二维码 PNG（需同 Wi-Fi + serve.py --lan）。"""
from __future__ import annotations

import socket
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "mobile-qr.png"


def guess_lan_ip() -> str | None:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return None


def main() -> int:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8899
    ip = guess_lan_ip()
    if not ip:
        print("无法检测局域网 IP，请在系统设置里查看 Wi-Fi 的 IP 后手动拼链接。")
        return 1
    url = f"http://{ip}:{port}/index.html"
    print("手机与电脑连同一 Wi-Fi，然后：")
    print("  1. 电脑运行: python3 serve.py --lan", port if port != 8899 else "")
    print("  2. 手机相机或微信扫下面的二维码，或浏览器输入链接")
    print()
    print(url)
    try:
        import qrcode
    except ImportError:
        print()
        print("未安装 qrcode，仅显示链接。安装后重新运行可生成图片：")
        print("  pip install 'qrcode[pil]'")
        return 0
    img = qrcode.make(url)
    img.save(OUT)
    print()
    print(f"已保存二维码 → {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
