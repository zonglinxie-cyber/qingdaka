"""HTTP 层：拍照 relay 请求解析（供 serve.py / Serverless 共用）。"""
from __future__ import annotations

import json
import time
from urllib.parse import urlparse

from relay_protein_photo import MAX_BODY_BYTES, forward_protein_photo, validate_api_key

# ---- Origin 校验 ----
# 允许的 Origin 主机名；localhost 始终放行（本地开发）
ALLOWED_ORIGIN_HOSTS: set[str] = set()  # 空 = 仅 localhost + *.netlify.app


def check_origin(origin: str | None, referer: str | None) -> bool:
    """校验 Origin / Referer 是否来自本站。无头（curl 默认）→ 拒绝。"""
    source = origin or referer
    if not source:
        return False
    try:
        host = urlparse(source).hostname
    except Exception:
        return False
    if not host:
        return False
    if host in ("127.0.0.1", "localhost", "::1"):
        return True
    if ALLOWED_ORIGIN_HOSTS:
        return host in ALLOWED_ORIGIN_HOSTS
    return host.endswith(".netlify.app")


# ---- IP 限流（内存滑窗，进程级） ----
_RATE_BUCKETS: dict[str, list[float]] = {}
RATE_LIMIT_PER_MINUTE = 10
RATE_WINDOW_SEC = 60


def check_rate_limit(client_ip: str) -> bool:
    """每 IP 每分钟最多 RATE_LIMIT_PER_MINUTE 次。返回 True = 放行。"""
    now = time.monotonic()
    bucket = _RATE_BUCKETS.get(client_ip)
    if bucket is None:
        bucket = []
        _RATE_BUCKETS[client_ip] = bucket
    # 清理过期
    cutoff = now - RATE_WINDOW_SEC
    while bucket and bucket[0] < cutoff:
        bucket.pop(0)
    if len(bucket) >= RATE_LIMIT_PER_MINUTE:
        return False
    bucket.append(now)
    return True


def handle_protein_photo(api_key: str | None, body: bytes) -> tuple[int, bytes, str]:
    if not validate_api_key(api_key):
        return (
            401,
            _json(
                {
                    "error": {
                        "message": "missing or invalid X-DashScope-Key",
                        "code": "relay_key_format",
                    }
                }
            ),
            "application/json; charset=utf-8",
        )
    return forward_protein_photo(body, api_key or "")


def parse_content_length(raw: str | None) -> int | None:
    if raw is None or raw.strip() == "":
        return None
    try:
        n = int(raw)
    except ValueError:
        return None
    if n < 0:
        return None
    return n


def read_body_or_error(content_length: int | None, body: bytes) -> tuple[int, bytes, str] | None:
    """校验长度与 body；出错时返回 (status, body, content_type)，否则 None。"""
    if content_length is None:
        return 400, _json({"error": {"message": "missing Content-Length"}}), "application/json; charset=utf-8"
    if content_length <= 0:
        return 400, _json({"error": {"message": "empty body"}}), "application/json; charset=utf-8"
    if content_length > MAX_BODY_BYTES:
        return 413, _json({"error": {"message": "request body too large"}}), "application/json; charset=utf-8"
    if len(body) != content_length:
        return 400, _json({"error": {"message": "incomplete body"}}), "application/json; charset=utf-8"
    return None


def _json(obj: dict) -> bytes:
    return json.dumps(obj, ensure_ascii=False).encode("utf-8")
