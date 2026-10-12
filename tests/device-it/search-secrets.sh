#!/bin/sh
# Lists the files under the given paths that hold the value of any MAT_IT_* environment variable,
# one per line (specs/005-device-online T051, scenario secrets, SC-005). The strings come through
# the environment of `docker exec -e NAME` and stay in memory: no pattern file, and no PowerShell
# pipe (PowerShell 5.1 may prefix what it pipes with a BOM). Exit 0 whether or not something is
# found; 2 when there is nothing to look for.
# Usage: docker exec -e MAT_IT_PW_ADMIN … <container> sh search-secrets.sh <path>...
p=$(env | sed -n 's/^MAT_IT_[A-Z0-9_]*=//p')
[ -n "$p" ] || { echo "search-secrets: no MAT_IT_* values" >&2; exit 2; }
printf '%s\n' "$p" | grep -rlaF -f - "$@" 2>/dev/null
exit 0
