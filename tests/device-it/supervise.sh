#!/bin/sh
# Supervision loop of a device-it runtime container (specs/005-device-online T051), standing in for
# systemd on the BL335: the runtime runs again 2 s after it ends (Restart=always, RestartSec=2), and
# /run/mat-runtime is an owner-only directory (RuntimeDirectory=mat-runtime, mode 0700).
# Extra arguments go to mat-runtime (e.g. --no-discovery). Besides them, each start reads the file
# /data/extra-args (one argument per line, written by the kill, health scenarios: --test-kill-at,
# --test-health; needs a binary built with MAT_TEST_HOOKS). Output goes to /logs/runtime.log, which
# the secrets scenario searches. SIGTERM (docker stop) ends the runtime and the loop.
# The web root is the real viewer (apps/runtime-web/dist-device) when it is built, else a stub page.
# Usage: sh /src/tests/device-it/supervise.sh [mat-runtime args...]
set -u
BIN=/build/x64/bin/mat-runtime
WEB=/src/apps/runtime-web/dist-device
mkdir -p /logs /data /etc/mat-runtime /tmp/web
mkdir -p -m 0700 /run/mat-runtime
if [ -f "$WEB/index.html" ]; then
  DOCROOT=$WEB
else
  DOCROOT=/tmp/web
  [ -f /tmp/web/index.html ] || echo '<!doctype html><title>device-it</title>' > /tmp/web/index.html
fi
child=
stop() {
  [ -n "$child" ] && kill -TERM "$child" 2>/dev/null && wait "$child"
  exit 0
}
trap stop TERM INT
starts=0
while :; do
  starts=$((starts + 1))
  extra=
  if [ -s /data/extra-args ]; then
    extra=$(tr '\n' ' ' < /data/extra-args)
  fi
  echo "supervise: start $starts $extra" >> /logs/runtime.log
  # shellcheck disable=SC2086
  "$BIN" --docroot "$DOCROOT" --project-dir "${MAT_IT_PROJECT:-/src/projects/tank-demo}" --schemas-dir /src/schemas \
    --data-dir /data --project-store-dir /data/projects --https-port 8443 \
    --users-file /etc/mat-runtime/users.json "$@" $extra >> /logs/runtime.log 2>&1 &
  child=$!
  echo "$child" > /run/mat-runtime.pid
  wait "$child"
  rc=$?
  child=
  echo "supervise: mat-runtime exited $rc, again in 2 s" >> /logs/runtime.log
  sleep 2
done
