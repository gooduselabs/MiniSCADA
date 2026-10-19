#!/bin/sh
# mat-updater (feature 011 US4, T114; contracts/update-package.md §4, §5; ADR-035; FR-062, FR-063,
# FR-066, FR-070, FR-072): the root side of an OTA update, started by mat-updater.path when the
# runtime writes <dataDir>/update/request.json, or by mat-updater-recover to finish a health check
# cut by a reboot. Installed by deploy.sh in /usr/lib/mat-updater/ (never by OTA: a package with
# updater/ is UPDATER_MANUAL_ONLY).
#
# Trust: nothing written by matscada is believed. request.json gives only an updateId
# (^upd_[0-9a-f]{16}$), an op and a SHA-256; the package is copied (read as matscada) into a root
# directory, its SHA-256 compared with the request, and checked again IN FULL by mat-update-verify
# on that copy (TOCTOU) against the installed tree. tar is only run on that copy, after its listing
# was compared with files[]. Files under <dataDir> (matscada's) are written as matscada
# (runuser), so a symbolic link planted there never makes root write elsewhere.
#
# Steps (ops state written before each, in /var/lib/mat-updater/ops/<id>.json, then copied to
# <dataDir>/update/ops/<id>.json for the runtime and Studio):
#   S4 root-verified  S5 staged  S6 switched  S7 health-check  S8 committed
# op "rollback" swaps /opt/mat-runtime and .prev; op "keyset" writes trusted-keys/ (S6, S7 skipped).
#
# Environment for tests (deployment/device/tests/updater_test.sh): MAT_OPT_ROOT (prefix of /opt,
# /etc, /var), MAT_SYSTEMCTL, MAT_VERIFY, MAT_RUNUSER, MAT_FETCH, MAT_HEALTH_S, MAT_STABLE_S,
# MAT_SLEEP, MAT_RATE_S, MAT_READ_S, MAT_LOCK_WAIT_S, MAT_UPTIME_FILE, MAT_TEST_KILL (STEP:N: kill -9 at
# that point).
set -u
umask 022

P=${MAT_OPT_ROOT:-}
ROOT=$P/opt/mat-runtime
NEW=$ROOT.new
PREV=$ROOT.prev
FAILED=$ROOT.failed
ETC=$P/etc/mat-runtime
KEYS=$ETC/trusted-keys
DATA=$P/var/lib/mat-runtime
UPD=$DATA/update
STATE=$P/var/lib/mat-updater
SYSTEMCTL=${MAT_SYSTEMCTL:-systemctl}
VERIFY=${MAT_VERIFY:-/usr/lib/mat-updater/mat-update-verify}
# matscada for every read and write under <dataDir> ("" in tests: the test user)
RUNUSER=${MAT_RUNUSER-runuser -u matscada --}
HEALTH_S=${MAT_HEALTH_S:-60}
STABLE_S=${MAT_STABLE_S:-5}
SLEEP=${MAT_SLEEP:-sleep}
# Monotonic clock of the health window (never moved by NTP); unreadable: the count of rounds alone.
UPTIME_FILE=${MAT_UPTIME_FILE:-/proc/uptime}
RATE_S=${MAT_RATE_S:-300}
READ_S=${MAT_READ_S:-60}
# Another run holding the lock is waited for (second review T202 N-OTA3): mat-updater.path uses
# PathExists=, so a request.json left by an early exit would trigger again at once.
LOCK_WAIT_S=${MAT_LOCK_WAIT_S:-60}
UPDATER_PROTOCOL=1

log() { echo "[mat-updater] $*"; }
# systemctl without the lock: a process it starts must never hold it (fd 9)
sysctl_() { $SYSTEMCTL "$@" 9>&-; }
kp() { [ "${MAT_TEST_KILL:-}" = "$1:$2" ] && kill -9 $$; return 0; }
now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }
now_ms() { echo $(($(date +%s) * 1000)); }
as_user() { $RUNUSER "$@"; }
# JSON string value (our own simple files only: no escapes in what we read back)
jget() { sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$2" | head -1; }

# A file under <dataDir> read as matscada (review 011 T062): a regular file only (never a link, a
# FIFO or a device), at most $2 bytes plus one (so that a larger file is seen as larger), bounded
# in time (a file swapped for a FIFO after the test only blocks until the timeout).
user_read() { # $1 path, $2 max bytes; stdout
    timeout -k 5 "$READ_S" $RUNUSER sh -c '{ [ -f "$1" ] && [ ! -L "$1" ]; } || exit 3; exec head -c "$2" < "$1"' sh "$1" "$(($2 + 1))"
}

# A file under <dataDir> written as matscada: temp then rename (a link at the name is replaced).
user_write() { # $1 path, stdin content
    as_user sh -c 'umask 077; t=$(mktemp "$1.XXXXXX") && cat > "$t" && sync "$t" 2>/dev/null; mv -f "$t" "$1"' sh "$1"
}

# ops/<id>.json: root state first (authoritative), then the copy for the runtime.
STEP_NAMES="4:root-verified 5:staged 6:switched 7:health-check 8:committed"
step() { # $1 number
    name=$(for s in $STEP_NAMES; do [ "${s%%:*}" = "$1" ] && echo "${s#*:}"; done)
    text="{\"updateId\":\"$ID\",\"op\":\"$OP\",\"step\":$1,\"name\":\"$name\",\"at\":\"$(now_iso)\",\"from\":\"$FROM\",\"to\":\"$TO\",\"toSeq\":\"$TOSEQ\",\"result\":null}"
    t=$(mktemp "$STATE/ops/.$ID.XXXXXX") || return 1
    printf '%s\n' "$text" > "$t" && sync && mv -f "$t" "$STATE/ops/$ID.json" && sync
    printf '%s\n' "$text" | user_write "$UPD/ops/$ID.json" 2>/dev/null || true
}

# last.json for the runtime (it audits it at its next start, FR-063), then the root state closed.
finish() { # $1 result, $2 reason, $3 code
    reason=$(printf '%s' "${2:-}" | tr -d '"\\' | cut -c1-200)
    printf '{"updateId":"%s","op":"%s","result":"%s","from":"%s","to":"%s","fromSeq":"%s","toSeq":"%s","user":"%s","code":"%s","reason":"%s","finishedAt":"%s","finishedAtMs":%s,"audited":false}\n' \
        "$ID" "$OP" "$1" "$FROM" "$TO" "$FROMSEQ" "$TOSEQ" "$WHO" "${3:-}" "$reason" "$(now_iso)" "$(now_ms)" |
        user_write "$UPD/last.json" || log "cannot write last.json"
    kp S8 3
    if [ -f "$STATE/ops/$ID.json" ]; then
        sed "s/\"result\":null/\"result\":\"$1\"/" "$STATE/ops/$ID.json" > "$STATE/ops/$ID.json.t" &&
            mv -f "$STATE/ops/$ID.json.t" "$STATE/ops/$ID.json"
    fi
    kp S8 4
    as_user rm -f "$UPD/ready/$ID.matupdate" "$UPD/ops/$ID.json" 2>/dev/null || true
    rm -rf "${WORK:-/nonexistent-mat}"
    sync
    kp S8 5
    log "$ID: $1${2:+ ($2)}"
}

# The version and releaseSeq of a tree (its build-info.json).
tree_version() { sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1/build-info.json" 2>/dev/null | head -1; }
tree_seq() { sed -n 's/.*"releaseSeq"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p' "$1/build-info.json" 2>/dev/null | head -1; }

# system/info over HTTP and HTTPS (the ports of runtime.json).
CONF=$ETC/runtime.json
PORT=$(sed -n 's/.*"port"[^0-9]*\([0-9]*\).*/\1/p' "$CONF" 2>/dev/null | head -1)
PORT=${PORT:-8080}
HTTPS_PORT=$(sed -n 's/.*"httpsPort"[^0-9]*\([0-9]*\).*/\1/p' "$CONF" 2>/dev/null | head -1)
HTTPS_PORT=${HTTPS_PORT:-8443}
fetch() { # $1 url
    if [ -n "${MAT_FETCH:-}" ]; then $MAT_FETCH "$1"; return; fi
    wget -q -T 2 -t 1 --no-check-certificate -O- "$1" 2>/dev/null
}
info_http() { fetch "http://127.0.0.1:$PORT/api/v1/system/info"; }
digests() { grep -o '"digest":"[^"]*"' | sort | tr '\n' ' '; }

# Health (S7): the service stays active ≥ STABLE_S, system/info answers over HTTP and HTTPS with
# the expected version and releaseSeq, and the project digest is the one from before.
# The window is HEALTH_S seconds of the monotonic clock: a round is 1 s of sleep plus the checks, so a
# count of rounds alone ran ~85 s for 60 (update-it, feature 012). The count stays as a bound.
uptime_s() { v=$(cut -d. -f1 "$UPTIME_FILE" 2>/dev/null) && [ -n "$v" ] && echo "$v"; }
healthy() { # $1 version, $2 releaseSeq, $3 digests before
    i=0
    stable=0
    t0=$(uptime_s) || t0=""
    while [ $i -lt "$HEALTH_S" ]; do
        if [ -n "$t0" ] && now=$(uptime_s) && [ $((now - t0)) -ge "$HEALTH_S" ]; then
            break
        fi
        $SLEEP 1
        i=$((i + 1))
        if ! sysctl_ is-active --quiet mat-runtime; then
            stable=0
            continue
        fi
        stable=$((stable + 1))
        kp S7 4
        [ $stable -lt "$STABLE_S" ] && continue
        body=$(info_http) || continue
        printf '%s' "$body" | grep -q "\"runtimeVersion\":\"$1\"" || continue
        [ -z "$2" ] || printf '%s' "$body" | grep -q "\"releaseSeq\":$2[,}]" || continue
        [ -z "$3" ] || [ "$(printf '%s' "$body" | digests)" = "$3" ] || continue
        if [ "$HTTPS_PORT" != 0 ]; then
            fetch "https://127.0.0.1:$HTTPS_PORT/api/v1/system/info" >/dev/null || continue
        fi
        return 0
    done
    return 1
}

# Back to .prev after a failed switch or health check (contract §4 "Quay về").
roll_back() { # $1 reason
    log "$ID: rolling back ($1)"
    sysctl_ stop mat-runtime
    kp S7 5
    rm -rf "$FAILED"
    # each rename checked (review 011 T062): never .prev moved INTO a tree that is still there
    if [ -d "$ROOT" ] && ! mv -T "$ROOT" "$FAILED"; then
        sysctl_ start mat-runtime
        finish failed "$1; the rollback could not rename the new tree" SWITCH_FAILED
        return 0
    fi
    kp S7 6
    if ! mv -T "$PREV" "$ROOT"; then
        mv -T "$FAILED" "$ROOT" || log "$ID: no tree left in place: mat-updater-recover restores .prev at boot"
        sync
        sysctl_ start mat-runtime
        finish failed "$1; the rollback could not put the previous tree back" SWITCH_FAILED
        return 0
    fi
    sync
    sysctl_ start mat-runtime
    if healthy "$FROM" "" ""; then
        finish rolled-back "$1" HEALTH_FAILED
    else
        finish rolled-back "$1; the previous version is not healthy either" HEALTH_FAILED
    fi
}

# S7 and S8 of an apply (also resumed by mat-updater-recover after a reboot).
health_and_commit() {
    step 7
    kp S7 1
    if healthy "$TO" "$TOSEQ" "$DIGESTS"; then
        kp S7 2
        step 8
        kp S8 1
        finish committed ""
        kp S8 2
        return 0
    fi
    kp S7 3
    if [ "$OP" = rollback ]; then
        undo_rollback "the previous version is not healthy"
    else
        roll_back "health check failed after ${HEALTH_S} s"
    fi
}

# A manual rollback (op "rollback") whose version is not healthy: the two trees swapped back, the
# version from before runs again (also after a resume by mat-updater-recover).
undo_rollback() { # $1 reason
    sysctl_ stop mat-runtime
    back=0
    if [ -d "$ROOT.swap" ] && [ ! -d "$PREV" ]; then
        # the rename .swap -> .prev had failed (second review T202 N7a): .swap holds the only copy
        # of the replaced tree, never removed; it goes back in place, the unhealthy one to .prev
        if mv -T "$ROOT" "$PREV"; then
            if mv -T "$ROOT.swap" "$ROOT"; then
                back=1
            else
                mv -T "$PREV" "$ROOT" || log "$ID: no tree in place: mat-updater-recover restores it at boot"
            fi
        fi
    else
        [ -d "$PREV" ] && rm -rf "$ROOT.swap"
        if mv -T "$ROOT" "$ROOT.swap"; then
            if mv -T "$PREV" "$ROOT"; then
                back=1
                mv -T "$ROOT.swap" "$PREV" || log "$ID: the replaced tree stays in $ROOT.swap"
            else
                mv -T "$ROOT.swap" "$ROOT" || log "$ID: no tree in place: mat-updater-recover restores it at boot"
            fi
        fi
    fi
    sync
    sysctl_ start mat-runtime
    if [ $back = 1 ]; then
        finish rolled-back "$1" HEALTH_FAILED
    else
        finish failed "$1; the trees could not be swapped back" SWITCH_FAILED
    fi
}

# ---------------------------------------------------------------- recover (at boot)

# mat-updater-recover.service (Before=mat-runtime.service): finishes or undoes what a power cut or
# a kill left (contract §4, table "Bị gián đoạn ở"). Never starts the runtime itself (systemd does,
# right after); an apply that had switched gets its health check from a mat-updater run queued with
# --no-block.
recover() {
    # S1 to S3 (the runtime's): what was received or checked is dropped, the request too
    as_user sh -c 'rm -f "$1"/incoming/* "$1"/ready/* "$1"/request.json' sh "$UPD" 2>/dev/null || true
    # the key set: a swap cut in the middle goes back to the old set
    if [ ! -d "$KEYS" ] && [ -d "$KEYS.old" ]; then mv -T "$KEYS.old" "$KEYS" || log "cannot restore $KEYS"; fi
    rm -rf "$KEYS.new" "$KEYS.old"
    for S in "$STATE"/ops/*.json; do
        [ -f "$S" ] || continue
        grep -q '"result":null' "$S" || continue
        ID=$(jget updateId "$S"); OP=$(jget op "$S"); FROM=$(jget from "$S"); TO=$(jget to "$S")
        TOSEQ=$(jget toSeq "$S"); FROMSEQ=""; WHO=""; DIGESTS=""; WORK=$STATE/$ID
        n=$(sed -n 's/.*"step":\([0-9]*\).*/\1/p' "$S")
        log "$ID: interrupted at S$n ($OP)"
        if [ "$OP" = rollback ]; then
            # the swap ROOT -> .swap, .prev -> ROOT, .swap -> .prev: complete it, then check health
            if [ -d "$ROOT.swap" ]; then
                [ -d "$ROOT" ] || mv -T "$PREV" "$ROOT" || mv -T "$ROOT.swap" "$ROOT" || log "$ID: no tree in place"
                [ -d "$PREV" ] || mv -T "$ROOT.swap" "$PREV" || log "$ID: cannot keep the old tree as .prev"
                # dropped only when it is no longer the only copy of a tree
                [ -d "$ROOT" ] && [ -d "$PREV" ] && rm -rf "$ROOT.swap"
            fi
            # the tree actually in place decides (second review T202 N7b): cut at S6 before the
            # first rename, the tree is still FROM; a health check of TO on it would fail and its
            # undo would swap .prev away
            if [ "$n" -ge 6 ] && [ "$(tree_version "$ROOT")" = "$TO" ]; then
                echo "$ID" > "$STATE/resume"
                sysctl_ --no-block start mat-updater.service || true
            else
                finish failed "interrupted at S$n before the switch" INTERRUPTED
            fi
            continue
        fi
        case "$n" in
        4 | 5)
            rm -rf "$NEW"
            [ -d "$ROOT" ] || mv -T "$PREV" "$ROOT" || log "$ID: cannot restore .prev"
            finish failed "interrupted at S$n" INTERRUPTED
            ;;
        6 | 7)
            if [ -d "$NEW" ] && [ -d "$ROOT" ]; then  # before the first rename
                rm -rf "$NEW"
                finish failed "interrupted at S6 before the switch" INTERRUPTED
            elif [ ! -d "$ROOT" ]; then  # between the two renames
                if mv -T "$PREV" "$ROOT"; then
                    rm -rf "$NEW"
                else
                    mv -T "$NEW" "$ROOT" || log "$ID: no tree in place"
                fi
                sync
                finish rolled-back "interrupted at S6 during the switch" INTERRUPTED
            else  # switched: the new version starts with the boot, then its health check
                echo "$ID" > "$STATE/resume"
                sysctl_ --no-block start mat-updater.service || true
            fi
            ;;
        8)
            finish committed ""
            ;;
        *)
            finish failed "interrupted" INTERRUPTED
            ;;
        esac
    done
    # whatever happened: a runtime tree must be there
    if [ ! -d "$ROOT" ] && [ -d "$PREV" ]; then mv -T "$PREV" "$ROOT" || log "cannot restore .prev"; fi
    if [ -d "$ROOT" ]; then
        rm -rf "$NEW"
        if [ -d "$ROOT.swap" ] && [ ! -d "$PREV" ]; then mv -T "$ROOT.swap" "$PREV" || log "cannot keep $ROOT.swap as .prev"; fi
        [ -d "$PREV" ] && rm -rf "$ROOT.swap"
    fi
    sync
}

# ---------------------------------------------------------------- start

mkdir -p "$STATE/ops" && chmod 700 "$STATE"
exec 9>"$STATE/lock"
if ! flock -w "$LOCK_WAIT_S" 9; then
    log "another run holds the lock for more than $LOCK_WAIT_S s"
    exit 1
fi

if [ "${1:-}" = "--recover" ]; then
    recover
    exit 0
fi

# A health check cut by a reboot (marker left by mat-updater-recover).
if [ -f "$STATE/resume" ]; then
    ID=$(cat "$STATE/resume")
    rm -f "$STATE/resume"
    S="$STATE/ops/$ID.json"
    if [ -f "$S" ]; then
        OP=$(jget op "$S"); FROM=$(jget from "$S"); TO=$(jget to "$S"); TOSEQ=$(jget toSeq "$S")
        FROMSEQ=""; WHO=""; DIGESTS=""; WORK=""
        log "$ID: health check resumed after a restart"
        health_and_commit
        exit 0
    fi
fi

REQ=$UPD/request.json
REQTEXT=$(user_read "$REQ" 4096 2>/dev/null) || REQTEXT=""
# taken whatever it was (a FIFO or a link planted there included)
as_user rm -f "$REQ" 2>/dev/null
[ -n "$REQTEXT" ] || { log "no request"; exit 0; }
[ "$(printf '%s' "$REQTEXT" | wc -c)" -le 4096 ] || { log "request ignored: size"; exit 0; }
field() { printf '%s' "$REQTEXT" | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -1; }
ID=$(field updateId)
OP=$(field op)
SHA=$(field sha256)
WHO=$(field user | tr -cd 'a-z0-9._-' | cut -c1-32)
if ! printf '%s' "$ID" | grep -Eq '^upd_[0-9a-f]{16}$'; then log "request ignored: updateId"; exit 0; fi
case "$OP" in apply | keyset) printf '%s' "$SHA" | grep -Eq '^[0-9a-f]{64}$' || { log "request ignored: sha256"; exit 0; } ;;
rollback) ;;
*) log "request ignored: op"; exit 0 ;;
esac
FROM=$(tree_version "$ROOT"); FROMSEQ=$(tree_seq "$ROOT"); TO=""; TOSEQ=""; DIGESTS=""; WORK=""

# At most one run every RATE_S seconds (research R18: a stolen matscada cannot loop updates).
if [ -f "$STATE/last-run" ]; then
    last=$(cat "$STATE/last-run" 2>/dev/null || echo 0)
    if [ $(($(date +%s) - last)) -lt "$RATE_S" ]; then
        finish failed "one update every $RATE_S s" RATE_LIMITED
        exit 0
    fi
fi
date +%s > "$STATE/last-run"

# ---------------------------------------------------------------- S4 root-verified

step 4
kp S4 1
WORK=$STATE/$ID
rm -rf "$WORK"
mkdir -m 700 "$WORK"

if [ "$OP" = rollback ]; then
    if [ ! -x "$PREV/bin/mat-runtime" ]; then
        finish failed "no previous version" UPDATE_NO_PREVIOUS
        exit 0
    fi
    TO=$(tree_version "$PREV"); TOSEQ=$(tree_seq "$PREV")
    DIGESTS=$(info_http | digests)
    step 6
    kp S6 1
    sysctl_ stop mat-runtime
    rm -rf "$ROOT.swap"
    # each rename checked (review 011 T062); a failed one puts back what was moved
    if ! mv -T "$ROOT" "$ROOT.swap"; then
        sysctl_ start mat-runtime
        finish failed "cannot rename the installed tree" SWITCH_FAILED
        exit 0
    fi
    kp S6 2
    if ! mv -T "$PREV" "$ROOT"; then
        mv -T "$ROOT.swap" "$ROOT" || log "$ID: no tree in place: mat-updater-recover restores it at boot"
        sync
        sysctl_ start mat-runtime
        finish failed "cannot put the previous tree in place" SWITCH_FAILED
        exit 0
    fi
    kp S6 3
    mv -T "$ROOT.swap" "$PREV" || log "$ID: the replaced tree stays in $ROOT.swap"
    sync
    sysctl_ start mat-runtime
    step 7
    if healthy "$TO" "$TOSEQ" "$DIGESTS"; then
        step 8
        finish committed ""
    else
        undo_rollback "the previous version is not healthy"
    fi
    exit 0
fi

# the copy, read as matscada (no root read through a planted link): a regular file only, at most
# update.maxPackageMiB (the runtime's default 64), in bounded time; then its digest
MAXMIB=$(sed -n 's/.*"maxPackageMiB"[^0-9]*\([0-9]*\).*/\1/p' "$CONF" 2>/dev/null | head -1 | cut -c1-4)
[ "${MAXMIB:-0}" -gt 0 ] 2>/dev/null || MAXMIB=64
MAXB=$((MAXMIB * 1048576))
user_read "$UPD/ready/$ID.matupdate" "$MAXB" > "$WORK/pkg" 2>/dev/null
rc=$?
if [ $rc = 124 ] || [ $rc = 137 ]; then  # timeout (TERM, then KILL): not the same as a missing package
    finish failed "reading the package took more than $READ_S s" UPDATE_READ_TIMEOUT
    exit 0
elif [ $rc != 0 ]; then
    finish failed "package not found" UPDATE_NOT_FOUND
    exit 0
fi
if [ "$(wc -c < "$WORK/pkg")" -gt "$MAXB" ]; then
    finish failed "package larger than $MAXMIB MiB" UPDATE_TOO_LARGE
    exit 0
fi
kp S4 2
if [ "$(sha256sum "$WORK/pkg" | cut -d' ' -f1)" != "$SHA" ]; then
    finish failed "package changed after its check (sha256)" UPDATE_PACKAGE_INVALID
    exit 0
fi
"$VERIFY" "$WORK/pkg" --keys "$KEYS" --installed "$ROOT" --max-mib "$MAXMIB" > "$WORK/verify.out" 2>"$WORK/verify.err"
rc=$?
kp S4 3
if [ $rc != 0 ]; then
    code=$(sed -n 's/^error\t\([^\t]*\)\t\([^\t]*\).*/\1 \2/p' "$WORK/verify.out")
    finish failed "mat-update-verify exit $rc: $code" "$(echo "$code" | cut -d' ' -f1)"
    exit 0
fi
KIND=$(sed -n 's/^meta\tkind\t//p' "$WORK/verify.out")
TO=$(sed -n 's/^meta\tversion\t//p' "$WORK/verify.out")
TOSEQ=$(sed -n 's/^meta\treleaseSeq\t//p' "$WORK/verify.out")
REQUIRED=$(sed -n 's/^meta\tupdaterRequired\t//p' "$WORK/verify.out")
if [ "${REQUIRED:-1}" -gt "$UPDATER_PROTOCOL" ]; then
    finish failed "needs mat-updater protocol $REQUIRED: install it with deploy.sh" UPDATER_MANUAL_ONLY
    exit 0
fi
if { [ "$OP" = keyset ] && [ "$KIND" != keyset ]; } || { [ "$OP" = apply ] && [ "$KIND" != runtime ]; }; then
    finish failed "op $OP for a $KIND package" UPDATE_PACKAGE_INVALID
    exit 0
fi
kp S4 4
kp S4 5

# ---------------------------------------------------------------- keyset

if [ "$OP" = keyset ]; then
    # anti-replay (011 review K1): a keyset package is checked against the releaseSeq of the
    # installed tree only, which a keyset does not change; the last keyset's releaseSeq is kept with
    # the keys (keyset-seq, swapped with them) so an older signed keyset (one that re-adds a removed
    # key) is refused
    # keyset-seq there but unreadable or not a number: refused, never read as "no keyset yet"
    # (second review T202 N6: fail closed). Missing: a device whose keys deploy.sh installed
    # before keyset-seq existed (deploy.sh now writes 0 with the keys).
    KSEQ=""
    if [ -e "$KEYS/keyset-seq" ] || [ -L "$KEYS/keyset-seq" ]; then
        KSEQ=$(head -c 32 "$KEYS/keyset-seq" 2>/dev/null) || KSEQ=unreadable
        KSEQ=$(printf '%s' "$KSEQ" | tr -d ' \r\n')
        if ! printf '%s' "$KSEQ" | grep -Eq '^[0-9]{1,18}$'; then
            finish failed "keyset-seq of the installed keys is not a number (repair it by hand)" KEYSET_KEY
            exit 0
        fi
    fi
    if ! printf '%s' "$TOSEQ" | grep -Eq '^[0-9]{1,18}$'; then
        finish failed "keyset releaseSeq" UPDATE_PACKAGE_INVALID
        exit 0
    fi
    if [ -n "$KSEQ" ] && [ "$TOSEQ" -le "$KSEQ" ]; then
        finish failed "keyset releaseSeq $TOSEQ <= $KSEQ (replay)" UPDATE_DOWNGRADE
        exit 0
    fi
    step 5
    mkdir -m 700 "$WORK/keys"
    if ! "$VERIFY" "$WORK/pkg" --keys "$KEYS" --installed "$ROOT" --extract-keyset "$WORK/keys" > "$WORK/keyset.out"; then
        finish failed "keys of the keyset" KEYSET_KEY
        exit 0
    fi
    kp S5 1
    # the new set in a copy, checked, then swapped in key by key (rename is atomic per file)
    # every step checked (review 011 T062): a key not copied would be dropped from the new set
    keyset_fail() { # $1 reason
        rm -rf "$KEYS.new"
        finish failed "$1" KEYSET_KEY
        exit 0
    }
    rm -rf "$KEYS.new" && mkdir -m 755 "$KEYS.new" || keyset_fail "cannot stage the key set"
    have=$(find "$KEYS" -mindepth 1 -maxdepth 1 -name '*.pem' | wc -l)
    if [ "$have" -gt 0 ]; then
        cp -p "$KEYS"/*.pem "$KEYS.new"/ || keyset_fail "cannot copy the installed keys"
    fi
    copied=$(find "$KEYS.new" -mindepth 1 -maxdepth 1 -type f -name '*.pem' | wc -l)
    [ "$copied" = "$have" ] || keyset_fail "copied $copied of $have installed keys"
    for f in "$WORK"/keys/*.pem; do
        [ -f "$f" ] || continue
        install -m 644 "$f" "$KEYS.new/$(basename "$f")" || keyset_fail "cannot install a new key"
    done
    for id in $(sed -n 's/^keyset-remove\tsha256://p' "$WORK/verify.out"); do
        for k in "$KEYS.new"/*.pem; do
            [ -f "$k" ] || continue
            if [ "$("$VERIFY" --key-id "$k" 2>/dev/null)" = "sha256:$id" ]; then rm -f "$k"; fi
        done
    done
    { printf '%s\n' "$TOSEQ" > "$KEYS.new/keyset-seq" && chmod 644 "$KEYS.new/keyset-seq"; } ||
        keyset_fail "cannot write keyset-seq"
    n=$(find "$KEYS.new" -mindepth 1 -maxdepth 1 -type f -name '*.pem' | wc -l)
    if [ "$n" -lt 1 ] || [ "$n" -gt 4 ]; then
        rm -rf "$KEYS.new"
        finish failed "the key set would hold $n keys (1 to 4)" KEYSET_KEY
        exit 0
    fi
    if ! "$VERIFY" "$WORK/pkg" --keys "$KEYS.new" > /dev/null; then
        rm -rf "$KEYS.new"
        finish failed "the new key set does not verify the package" KEYSET_KEY
        exit 0
    fi
    kp S5 2
    # the new set on disk before the renames (second review T202 N5): a power cut right after
    # them never leaves an empty or partial trusted-keys
    sync
    rm -rf "$KEYS.old"
    mv -T "$KEYS" "$KEYS.old" || keyset_fail "cannot set the installed keys aside"
    if ! mv -T "$KEYS.new" "$KEYS"; then
        mv -T "$KEYS.old" "$KEYS" || log "$ID: $KEYS missing: mat-updater-recover restores $KEYS.old at boot"
        keyset_fail "cannot put the new key set in place"
    fi
    rm -rf "$KEYS.old"
    sync
    step 8
    finish committed ""
    exit 0
fi

# ---------------------------------------------------------------- S5 staged

step 5
kp S5 1
rm -rf "$NEW" "$FAILED"
mkdir -m 755 "$NEW"
tar -xOf "$WORK/pkg" payload.tar.gz > "$WORK/payload.tar.gz" || { finish failed "envelope" UPDATE_PACKAGE_INVALID; rm -rf "$NEW"; exit 0; }
# the listing against files[]: only regular files and directories, exactly the files of the manifest
sed -n 's/^file\t\([^\t]*\)\t.*/\1/p' "$WORK/verify.out" | sort > "$WORK/want"
# --quoting-style=literal: names as they are (UTF-8 is allowed in files[]; under LC_ALL=C the default
# style escapes every non-ASCII byte and the comparison would fail). A control character, which
# files[] refuses, then shows as an extra or broken line: refused below either way.
LC_ALL=C tar --quoting-style=literal -tvzf "$WORK/payload.tar.gz" > "$WORK/listing" || { finish failed "payload listing" UPDATE_PACKAGE_INVALID; rm -rf "$NEW"; exit 0; }
if grep -qv '^[-d]' "$WORK/listing"; then
    finish failed "link or special file in the payload" LINK_FORBIDDEN
    rm -rf "$NEW"
    exit 0
fi
LC_ALL=C tar --quoting-style=literal -tzf "$WORK/payload.tar.gz" | grep -v '/$' | sort > "$WORK/have"
if ! cmp -s "$WORK/want" "$WORK/have"; then
    finish failed "payload files differ from files[]" FILE_LIST
    rm -rf "$NEW"
    exit 0
fi
kp S5 2
tar -xzf "$WORK/payload.tar.gz" -C "$NEW" --no-same-owner --no-same-permissions --no-overwrite-dir || { finish failed "extract" UPDATE_PACKAGE_INVALID; rm -rf "$NEW"; exit 0; }
# every file again: digest and mode of the manifest
bad=""
while IFS="$(printf '\t')" read -r kind path sha mode size; do
    [ "$kind" = file ] || continue
    [ "$(sha256sum "$NEW/$path" | cut -d' ' -f1)" = "$sha" ] || bad="$path"
    # mat-update-verify passes only 0644 and 0755 (MODE_FORBIDDEN); checked again before chmod as root
    case "$mode" in 0644 | 0755) chmod "$mode" "$NEW/$path" || bad="$path" ;; *) bad="$path" ;; esac
done < "$WORK/verify.out"
if [ -n "$bad" ]; then
    finish failed "digest of $bad after extraction" FILE_DIGEST
    rm -rf "$NEW"
    exit 0
fi
# the parts that never come by OTA stay: the project of the tree and the manual scripts
for d in project deployment; do
    [ -d "$ROOT/$d" ] || continue
    if ! cp -a "$ROOT/$d" "$NEW/$d"; then
        finish failed "cannot copy $d into the new tree" STAGE_FAILED
        rm -rf "$NEW"
        exit 0
    fi
done
chown -R 0:0 "$NEW" 2>/dev/null || true
find "$NEW" -type d -exec chmod 755 {} +
kp S5 3
# the new binary checks the configuration, the data (read only) and the running project, as matscada
if ! $RUNUSER "$NEW/bin/mat-runtime" --self-check --config "$CONF" > "$WORK/self-check.out" 2>&1; then
    finish failed "self-check of the new version: $(tail -c 300 "$WORK/self-check.out" | tr '\n' ' ')" SELF_CHECK_FAILED
    rm -rf "$NEW"
    exit 0
fi
sync
kp S5 4
DIGESTS=$(info_http | digests)
kp S5 5

# ---------------------------------------------------------------- S6 switched

step 6
kp S6 1
sysctl_ stop mat-runtime
kp S6 2
rm -rf "$PREV"
# each rename checked (review 011 T062): a failed one restarts what was there
if ! mv -T "$ROOT" "$PREV"; then
    rm -rf "$NEW"
    sysctl_ start mat-runtime
    finish failed "cannot set the installed tree aside" SWITCH_FAILED
    exit 0
fi
kp S6 3
if ! mv -T "$NEW" "$ROOT"; then
    mv -T "$PREV" "$ROOT" || log "$ID: no tree in place: mat-updater-recover restores .prev at boot"
    rm -rf "$NEW"
    sync
    sysctl_ start mat-runtime
    finish failed "cannot put the new tree in place" SWITCH_FAILED
    exit 0
fi
sync
kp S6 4
if ! sysctl_ start mat-runtime; then
    kp S6 5
    roll_back "the new version did not start"
    exit 0
fi
kp S6 5
health_and_commit
exit 0
