#!/usr/bin/env sh
# 本地开发：静态文件服务
cd "$(dirname "$0")/.." || exit 1
exec python3 serve.py "$@"
