#!/usr/bin/env bash
set -euo pipefail
backend_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$backend_root/dist"
image="$(tr -d '\r\n' < "$backend_root/deploy/lambda-image.txt")"
docker run --rm --platform linux/amd64 \
  --mount "type=bind,source=$backend_root,target=/src,readonly" \
  --mount "type=bind,source=$backend_root/dist,target=/out" \
  --env PYTHONDONTWRITEBYTECODE=1 \
  --entrypoint /var/lang/bin/python "$image" /src/deploy/build_lambda.py
