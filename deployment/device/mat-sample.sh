#!/bin/sh
# mat-sample: read-only soak sampler of mat-runtime (feature 011, T070; FR-037, contract test-protocols.md §2).
#
# Every MAT_SAMPLE_PERIOD_S seconds (default 60) appends one JSON line to $MAT_SAMPLE_DIR/samples-<n>.jsonl
# (default /run/mat-sample, tmpfs), rotating MAT_SAMPLE_FILES files (default 8) of at most MAT_SAMPLE_MAX_BYTES
# (default 1 MiB) each. It only reads /proc, /sys, the data dir and the output of read-only commands; the only files
# it writes are the sample files and the hidden state file $MAT_SAMPLE_DIR/.state (current file index, boot id and
# dmesg error count of the last sample). A value that cannot be read is null, never invented.
#
# Usage: mat-sample.sh [--once]
#   --once                 one sample, then exit
# Environment (defaults in brackets):
#   MAT_SAMPLE_DIR [/run/mat-sample]  MAT_SAMPLE_PERIOD_S [60]  MAT_SAMPLE_MAX_BYTES [1048576]  MAT_SAMPLE_FILES [8]
#   MAT_SAMPLE_COUNT [0 = forever]    MAT_PROC_ROOT [/proc]     MAT_SYS_ROOT [/sys]
#   MAT_DATA_DIR [/var/lib/mat-runtime]  MAT_TMP_DIR [/run] (dfTmp)  MAT_SERVICE [mat-runtime]
#   MAT_PID (else `pidof mat-runtime`, else `systemctl show -p MainPID`)
#   MAT_SAMPLE_MMC=1 also runs `mmc extcsd read $MAT_MMC_DEV` [/dev/mmcblk0] (read only; CMD8). No mmc write command
#   is ever run by this script.
#
# Field notes:
#   blkSectorsWritten  object {"<dev>": sectors} for every /sys/block/mmcblk* with a stat file (field 7 = sectors of
#                      512 B written since boot; boot0/boot1 hardware partitions included); null when there is none.
#   dbSizes            bytes of history.db, history.db-wal, audit.db, alarm.db, pulse.journal (null when missing) and
#                      "retain": sum of the regular files under retain/ (null when the dir is missing).
#   dfData, dfTmp      {"totalKb","usedKb","availKb"} of `df -Pk` for MAT_DATA_DIR and MAT_TMP_DIR.
#   emmc               {"source":"mmc-extcsd","extCsdRev",lifeA,lifeB,preEol} or {"source":"sysfs",lifeA,lifeB,preEol}
#                      (DEVICE_LIFE_TIME_EST_TYP_A/B, PRE_EOL_INFO as integers); null when neither is readable.
#   dmesgErr           new dmesg lines since the last sample that are "I/O error" lines, or mmc/ext4 lines that also
#                      say error, fail, timeout, crc, abort, corrupt or read-only (a plain "mmc0: new HS200 card" or
#                      "EXT4-fs mounted" boot line is not an error). First sample of a boot: the whole ring buffer.
#                      When the ring buffer wrapped (count went down) the current count is reported (errs high).
#                      null when dmesg cannot be read (dmesg_restrict without root).

PROC=${MAT_PROC_ROOT:-/proc}
SYS=${MAT_SYS_ROOT:-/sys}
DIR=${MAT_SAMPLE_DIR:-/run/mat-sample}
PERIOD=${MAT_SAMPLE_PERIOD_S:-60}
MAXB=${MAT_SAMPLE_MAX_BYTES:-1048576}
NFILES=${MAT_SAMPLE_FILES:-8}
COUNT=${MAT_SAMPLE_COUNT:-0}
DATA=${MAT_DATA_DIR:-/var/lib/mat-runtime}
TMPD=${MAT_TMP_DIR:-/run}
SERVICE=${MAT_SERVICE:-mat-runtime}
MMCDEV=${MAT_MMC_DEV:-/dev/mmcblk0}
ONCE=0

for arg in "$@"; do
    case $arg in
        --once) ONCE=1 ;;
        -h | --help)
            sed -n '2,20p' "$0"
            exit 0
            ;;
        *)
            echo "mat-sample: unknown argument: $arg" >&2
            exit 64
            ;;
    esac
done

# Prints $1 as a JSON integer (leading zeros removed) or null when it is not a non-negative integer.
num() {
    n_v=$1
    case $n_v in
        '' | *[!0-9]*)
            printf null
            return
            ;;
    esac
    while :; do
        case $n_v in
            0[0-9]*) n_v=${n_v#0} ;;
            *) break ;;
        esac
    done
    printf '%s' "$n_v"
}

# Prints a 0xNN string as a JSON integer, null otherwise.
hexnum() {
    case $1 in
        0x[0-9a-fA-F]* | 0X[0-9a-fA-F]*) printf '%d' "$1" 2>/dev/null || printf null ;;
        *) printf null ;;
    esac
}

# First line of a readable file, empty otherwise.
first_line() {
    [ -r "$1" ] && head -n 1 "$1" 2>/dev/null
}

# Size in bytes of a regular file as JSON, null when missing.
fsize() {
    if [ -f "$1" ]; then
        num "$(ls -ln "$1" 2>/dev/null | awk '{print $5}')"
    else
        printf null
    fi
}

# Field of a "Key: value kB" file such as /proc/<pid>/status or /proc/meminfo.
kv_field() {
    [ -r "$1" ] && awk -v k="$2:" '$1 == k {print $2; exit}' "$1" 2>/dev/null
}

df_json() {
    d_out=$(df -Pk "$1" 2>/dev/null | awk 'NR == 2 {print $2, $3, $4}')
    if [ -z "$d_out" ]; then
        printf null
        return
    fi
    # shellcheck disable=SC2086
    set -- $d_out
    printf '{"totalKb":%s,"usedKb":%s,"availKb":%s}' "$(num "$1")" "$(num "$2")" "$(num "$3")"
}

find_pid() {
    if [ -n "${MAT_PID:-}" ]; then
        printf '%s' "$MAT_PID"
        return
    fi
    p_v=$(pidof "$SERVICE" 2>/dev/null | awk '{print $1}')
    if [ -z "$p_v" ]; then
        p_v=$(systemctl show -p MainPID "$SERVICE" 2>/dev/null | sed -n 's/^MainPID=//p')
        [ "$p_v" = 0 ] && p_v=
    fi
    printf '%s' "$p_v"
}

blk_json() {
    b_out=
    for b_dev in "$SYS"/block/mmcblk*; do
        [ -r "$b_dev/stat" ] || continue
        b_val=$(awk '{print $7; exit}' "$b_dev/stat" 2>/dev/null)
        b_out="$b_out${b_out:+,}\"${b_dev##*/}\":$(num "$b_val")"
    done
    if [ -n "$b_out" ]; then printf '{%s}' "$b_out"; else printf null; fi
}

retain_json() {
    if [ -d "$DATA/retain" ]; then
        num "$(ls -lnR "$DATA/retain" 2>/dev/null | awk '/^-/ {s += $5} END {printf "%.0f", s}')"
    else
        printf null
    fi
}

emmc_json() {
    if [ "${MAT_SAMPLE_MMC:-0}" = 1 ] && command -v mmc >/dev/null 2>&1; then
        e_txt=$(mmc extcsd read "$MMCDEV" 2>/dev/null)
        e_rev=$(printf '%s\n' "$e_txt" | sed -n 's/^ *Extended CSD rev 1\.\([0-9][0-9]*\) (MMC [0-9.]*)$/\1/p' | head -n 1)
        if [ -n "$e_rev" ]; then
            e_a=$(printf '%s\n' "$e_txt" | sed -n 's/^eMMC Life Time Estimation A \[EXT_CSD_DEVICE_LIFE_TIME_EST_TYP_A\]: \(0x[0-9a-fA-F][0-9a-fA-F]\)$/\1/p')
            e_b=$(printf '%s\n' "$e_txt" | sed -n 's/^eMMC Life Time Estimation B \[EXT_CSD_DEVICE_LIFE_TIME_EST_TYP_B\]: \(0x[0-9a-fA-F][0-9a-fA-F]\)$/\1/p')
            e_p=$(printf '%s\n' "$e_txt" | sed -n 's/^eMMC Pre EOL information \[EXT_CSD_PRE_EOL_INFO\]: \(0x[0-9a-fA-F][0-9a-fA-F]\)$/\1/p')
            printf '{"source":"mmc-extcsd","extCsdRev":%s,"lifeA":%s,"lifeB":%s,"preEol":%s}' \
                "$(num "$e_rev")" "$(hexnum "$e_a")" "$(hexnum "$e_b")" "$(hexnum "$e_p")"
            return
        fi
    fi
    e_dir=
    if [ -r "$SYS/block/mmcblk0/device/life_time" ]; then
        e_dir=$SYS/block/mmcblk0/device
    else
        for e_c in "$SYS"/class/mmc_host/mmc*/mmc*:*; do
            if [ -r "$e_c/life_time" ]; then
                e_dir=$e_c
                break
            fi
        done
    fi
    if [ -z "$e_dir" ]; then
        printf null
        return
    fi
    # shellcheck disable=SC2046
    set -- $(first_line "$e_dir/life_time")
    printf '{"source":"sysfs","lifeA":%s,"lifeB":%s,"preEol":%s}' \
        "$(hexnum "${1:-}")" "$(hexnum "${2:-}")" "$(hexnum "$(first_line "$e_dir/pre_eol_info")")"
}

restarts_json() {
    num "$(systemctl show -p NRestarts "$SERVICE" 2>/dev/null | sed -n 's/^NRestarts=//p')"
}

# Sets DMESG_NOW (total matching lines, empty when dmesg is not readable).
dmesg_count() {
    DMESG_NOW=
    if m_txt=$(dmesg 2>/dev/null); then
        DMESG_NOW=$(printf '%s\n' "$m_txt" | awk '
            /I\/O error/ { n++; next }
            tolower($0) ~ /(mmc|ext4)/ && tolower($0) ~ /(error|fail|timeout|timed out|crc|abort|corrupt|read-only)/ { n++ }
            END { print n + 0 }')
    fi
}

load_state() {
    S_IDX=0
    S_BOOT=
    S_DMESG=
    if [ -r "$DIR/.state" ]; then
        S_IDX=$(sed -n 's/^idx=//p' "$DIR/.state")
        S_BOOT=$(sed -n 's/^boot=//p' "$DIR/.state")
        S_DMESG=$(sed -n 's/^dmesg=//p' "$DIR/.state")
    fi
    case $S_IDX in '' | *[!0-9]*) S_IDX=0 ;; esac
    [ "$S_IDX" -lt "$NFILES" ] || S_IDX=0
}

sample() {
    load_state
    t=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    boot=$(first_line "$PROC/sys/kernel/random/boot_id")
    case $boot in
        *[!0-9a-fA-F-]*) boot= ;;
    esac
    if [ -n "$boot" ]; then boot_json="\"$boot\""; else boot_json=null; fi

    rss= hwm= thr= ut= st= fd= ior= iow=
    pid=$(find_pid)
    case $pid in '' | *[!0-9]*) pid= ;; esac
    if [ -n "$pid" ] && [ -d "$PROC/$pid" ]; then
        P=$PROC/$pid
        rss=$(kv_field "$P/status" VmRSS)
        hwm=$(kv_field "$P/status" VmHWM)
        thr=$(kv_field "$P/status" Threads)
        statl=$(first_line "$P/stat")
        if [ -n "$statl" ]; then
            # comm may hold spaces and parentheses: the fields start after the last ") ".
            # shellcheck disable=SC2086
            set -- ${statl##*) }
            if [ $# -ge 13 ]; then
                ut=${12}
                st=${13}
            fi
        fi
        if [ -d "$P/fd" ] && [ -r "$P/fd" ] && [ -x "$P/fd" ]; then
            fd=$(ls -A "$P/fd" 2>/dev/null | wc -l | tr -d ' ')
        fi
        if [ -r "$P/io" ]; then
            ior=$(kv_field "$P/io" read_bytes)
            iow=$(kv_field "$P/io" write_bytes)
        fi
    fi

    dmesg_count
    if [ -z "$DMESG_NOW" ]; then
        dm=
    elif [ -n "$S_DMESG" ] && [ "$S_BOOT" = "$boot" ] && [ "$DMESG_NOW" -ge "$S_DMESG" ]; then
        dm=$((DMESG_NOW - S_DMESG))
    else
        dm=$DMESG_NOW
    fi

    line=$(printf '{"t":"%s","boot":%s,"rssKb":%s,"hwmKb":%s,"utime":%s,"stime":%s,"fd":%s,"threads":%s,"ioRead":%s,"ioWrite":%s,"blkSectorsWritten":%s,"dbSizes":{"history.db":%s,"history.db-wal":%s,"audit.db":%s,"alarm.db":%s,"pulse.journal":%s,"retain":%s},"dfData":%s,"dfTmp":%s,"memAvailKb":%s,"tempMilliC":%s,"emmc":%s,"restarts":%s,"dmesgErr":%s}' \
        "$t" "$boot_json" "$(num "$rss")" "$(num "$hwm")" "$(num "$ut")" "$(num "$st")" "$(num "$fd")" \
        "$(num "$thr")" "$(num "$ior")" "$(num "$iow")" "$(blk_json)" \
        "$(fsize "$DATA/history.db")" "$(fsize "$DATA/history.db-wal")" "$(fsize "$DATA/audit.db")" \
        "$(fsize "$DATA/alarm.db")" "$(fsize "$DATA/pulse.journal")" "$(retain_json)" \
        "$(df_json "$DATA")" "$(df_json "$TMPD")" "$(num "$(kv_field "$PROC/meminfo" MemAvailable)")" \
        "$(num "$(first_line "$SYS/class/thermal/thermal_zone0/temp")")" "$(emmc_json)" "$(restarts_json)" \
        "$(num "$dm")")

    idx=$S_IDX
    file=$DIR/samples-$idx.jsonl
    cur=0
    [ -f "$file" ] && cur=$(ls -ln "$file" | awk '{print $5}')
    len=$(printf '%s\n' "$line" | wc -c | tr -d ' ')
    if [ "$cur" -gt 0 ] && [ $((cur + len)) -gt "$MAXB" ]; then
        idx=$(((idx + 1) % NFILES))
        file=$DIR/samples-$idx.jsonl
        : >"$file"
    fi
    printf '%s\n' "$line" >>"$file"
    printf 'idx=%s\nboot=%s\ndmesg=%s\n' "$idx" "$boot" "$DMESG_NOW" >"$DIR/.state"
}

umask 022
mkdir -p "$DIR" || exit 1
n=0
while :; do
    sample
    n=$((n + 1))
    [ "$ONCE" = 1 ] && break
    [ "$COUNT" -gt 0 ] && [ "$n" -ge "$COUNT" ] && break
    sleep "$PERIOD"
done
