#!/bin/sh
# Creates a test account on a device-it runtime (specs/005-device-online T051) with
# --password-stdin. The password comes from the environment variable named by the third argument
# (docker exec -e NAME), never from the command line, and reaches the command through a pipe.
# Usage: docker exec -e MAT_IT_PW_ADMIN <container> sh add-user.sh admin administrator MAT_IT_PW_ADMIN
set -u
name=$1
role=$2
eval "pw=\${$3:-}"
[ -n "$pw" ] || { echo "add-user: $3 is empty" >&2; exit 2; }
printf '%s\n' "$pw" | /build/x64/bin/mat-runtime --user-add "$name" --role "$role" --password-stdin \
  --users-file /etc/mat-runtime/users.json --data-dir /data
