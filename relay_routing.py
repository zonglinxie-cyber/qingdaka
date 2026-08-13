"""按 API Key 类型选择 DashScope / Token Plan 上游地址与视觉模型。"""
from __future__ import annotations

import json
import os
import re

CHINA_BASE = "https://dashscope.aliyuncs.com/compatible-mode/v1"
INTL_BASE = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
# Token Plan（sk-sp-）与按量 dashscope 完全隔离；国内席位优先北京
TOKEN_PLAN_BASES = [
    "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
]


def is_token_plan_key(api_key: str) -> bool:
    return api_key.strip().lower().startswith("sk-sp-")


def bases_for_key(api_key: str) -> list[str]:
    if is_token_plan_key(api_key):
        return list(TOKEN_PLAN_BASES)
    env = os.environ.get("DASHSCOPE_BASE_URL", "").rstrip("/")
    if env:
        return [env]
    return [CHINA_BASE, INTL_BASE]


def photo_models_for_key(api_key: str) -> list[str]:
    if is_token_plan_key(api_key):
        return ["qwen3.6-flash", "qwen3.7-plus"]
    return ["qwen-vl-max", "qwen3-vl-plus"]


def should_retry_intl(status: int, raw: bytes) -> bool:
    if status != 401:
        return False
    try:
        j = json.loads(raw.decode("utf-8"))
        err = j.get("error") or {}
        code = err.get("code") or ""
        msg = err.get("message") or ""
        if code == "invalid_api_key":
            return True
        if re.search(r"incorrect api key|invalid api key|apikey-error", msg, re.I):
            return True
    except (UnicodeDecodeError, json.JSONDecodeError, AttributeError):
        pass
    return False


def should_retry_model(status: int, raw: bytes) -> bool:
    if status not in (400, 403, 404):
        return False
    try:
        blob = json.dumps(json.loads(raw.decode("utf-8"))).lower()
    except (UnicodeDecodeError, json.JSONDecodeError):
        return False
    return bool(re.search(r"model|does not exist|not exist|not found|access denied|permission", blob))
