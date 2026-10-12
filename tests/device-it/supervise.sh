#!/bin/sh
# Supervision loop of a device-it runtime container (specs/005-device-online T051), standing in for
# systemd on the BL335: the runtime runs again 2 s after it ends (Restart=always, RestartSec=2), and
# /run/mat-runtime is an owner-only directory (RuntimeDirectory=mat-runtime, mode 0700).
# Extra arguments go to mat-runtime (e.g. --no-discovery). Output goes to /logs/runtime.log, which
# the secrets scenario searches. SIGTERM (docker stop) ends the runtime and the loop.
# Usage: sh /src/tests/device-it/supervise.sh [mat-runtime args...]
set -u
BIN=/build/x64/bin/mat-runtime
mkdir -p /logs /data /etc/mat-runtime /tmp/web
mkdir -p -m 0700 /run/mat-runtime
[ -f /tmp/web/index.html ] || echo '<!doctype html><title>device-it</title>' > /tmp/web/index.html
child=
stop() {
  [ -n "$child" ] && kill -TERM "$child" 2>/dev/null && wait "$child"
  exit 0
}
trap stop TERM INT
starts=0
while :; do
  starts=$((starts + 1))
  echo "supervise: start $starts" >> /logs/runtime.log
  "$BIN" --docroot /tmp/web --project-dir /src/projects/tank-demo --schemas-dir /src/schemas \
    --data-dir /data --project-store-dir /data/projects --https-port 8443 \
    --users-file /etc/mat-runtime/users.json "$@" >> /logs/runtime.log 2>&1 &
  child=$!
  echo "$child" > /run/mat-runtime.pid
  wait "$child"
  rc=$?
  child=
  echo "supervise: mat-runtime exited $rc, again in 2 s" >> /logs/runtime.log
  sleep 2
done
