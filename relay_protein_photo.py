"""同源转发：拍照识蛋白 → DashScope OpenAI 兼容接口。不落库 Key 与图片。"""
from __future__ import annotations

import json
import os
import re
import socket
import time
import urllib.error
import urllib.request

MAX_BODY_BYTES = 2 * 1024 * 1024  # 896px JPEG 转 base64 约 200-400KB，2MB 足够
# 单次上游超时 & 整个请求（含 base/model 回退）的总预算。
# Serverless 平台会硬杀进程：Netlify 同步函数默认 10s，Vercel Hobby 同量级。
# 总预算必须小于平台上限，否则用户拿到的是平台的不透明错误而不是我们的提示。
UPSTREAM_TIMEOUT_SEC = float(os.environ.get("UPSTREAM_TIMEOUT_SEC", "9"))
TOTAL_BUDGET_SEC = float(os.environ.get("TOTAL_BUDGET_SEC", "9.5"))

# 中国区默认；国际 Key 可设 DASHSCOPE_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
DEFAULT_BASE_URL = (
    os.environ.get("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
    .rstrip("/")
)

_API_KEY_RE = re.compile(r"^sk-(?:sp-)?\S{14,250}$", re.IGNORECASE)


def validate_api_key(key: str | None) -> bool:
    if not key or not isinstance(key, str):
        return False
    k = key.strip()
    if " " in k or "\n" in k:
        return False
    return bool(_API_KEY_RE.match(k))


from relay_routing import (
    bases_for_key,
    photo_models_for_key,
    should_retry_intl,
    should_retry_model,
)


def forward_protein_photo(body: bytes, api_key: str) -> tuple[int, bytes, str]:
    """返回 (http_status, response_body, content_type)。"""
    if len(body) > MAX_BODY_BYTES:
        return (
            413,
            _err_json("request body too large"),
            "application/json; charset=utf-8",
        )
    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return 400, _err_json("invalid JSON body"), "application/json; charset=utf-8"

    if not isinstance(payload, dict):
        return 400, _err_json("body must be a JSON object"), "application/json; charset=utf-8"
    if not payload.get("messages"):
        return 400, _err_json("missing messages"), "application/json; charset=utf-8"

    payload["stream"] = False

    data_template = dict(payload)
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key.strip()}",
        "Accept": "application/json",
    }
    bases = bases_for_key(api_key)
    models = photo_models_for_key(api_key)
    last: tuple[int, bytes, str] | None = None
    deadline = time.monotonic() + TOTAL_BUDGET_SEC

    for model in models:
        req_payload = dict(data_template)
        req_payload["model"] = model
        data = json.dumps(req_payload, ensure_ascii=False).encode("utf-8")
        for i, base in enumerate(bases):
            req = urllib.request.Request(
                f"{base}/chat/completions",
                data=data,
                method="POST",
                headers=headers,
            )
            remaining = deadline - time.monotonic()
            if remaining <= 0.5:
                if last:
                    return last
                return 504, _err_json("upstream timeout"), "application/json; charset=utf-8"
            try:
                with urllib.request.urlopen(req, timeout=min(UPSTREAM_TIMEOUT_SEC, remaining)) as resp:
                    raw = resp.read()
                    ctype = resp.headers.get_content_type() or "application/json"
                    if "charset" not in ctype:
                        ctype = f"{ctype}; charset=utf-8"
                    return resp.status, raw, ctype
            except urllib.error.HTTPError as e:
                raw = e.read()
                if not raw:
                    raw = _err_json(f"upstream HTTP {e.code}")
                last = (e.code, raw, "application/json; charset=utf-8")
                if should_retry_intl(e.code, raw) and i < len(bases) - 1:
                    continue
                if should_retry_model(e.code, raw):
                    break
                return last
            except urllib.error.URLError:
                if i == len(bases) - 1 and model == models[-1]:
                    return 502, _err_json("upstream unreachable"), "application/json; charset=utf-8"
            except (TimeoutError, socket.timeout):
                return 504, _err_json("upstream timeout"), "application/json; charset=utf-8"
    if last:
        return last
    return 502, _err_json("upstream unreachable"), "application/json; charset=utf-8"


def _err_json(message: str) -> bytes:
    return json.dumps({"error": {"message": message}}, ensure_ascii=False).encode("utf-8")
