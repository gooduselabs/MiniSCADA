#!/bin/sh
# Script mẫu cho tools/docs-check.test.mjs: chỉ nhận --dry-run.
[ "$1" = "--dry-run" ] && exit 0
