#!/bin/sh
# Timed C++ fuzz targets of feature 011 under ASan + UBSan (T058, T142; FR-029). Inside mat-armhf:
#   sh tools/fuzz/cpp/run.sh <build dir> <seconds per target> [seed] [targets]
# targets (comma separated, default all): logic-json, package, project-json, expression, modbus,
# update-envelope, s7 (feature 016), fins (feature 018), mc (feature 017). Builds only the fuzz binaries (and what they link) in <build dir> with ASan + UBSan
# (-j2, then -j1 after an OOM kill; MAT_FUZZ_NO_BUILD=1 skips it), then runs each target for
# <seconds>, one after the other. Prints the target's own summary ("fuzz <name>: N inputs ...") and
# one line per target: "fuzz <target>: exit <rc>, <s> s, seed <seed>, ASan + UBSan". The log of each
# run is <build dir>/fuzz-<target>.log. tools/fuzz/cpp/run.ps1 runs it in Docker and writes the "cpp"
# key of docs/reports/011-fuzz-x64.json.
set -u
B=${1:?build dir}
S=${2:-3600}
SEED=${3:-20261017}
TARGETS=${4:-logic-json,package,project-json,expression,modbus,update-envelope,s7,fins,mc}
SRC=$(cd "$(dirname "$0")/../../.." && pwd)
export CXXFLAGS='-fsanitize=address,undefined -fno-sanitize-recover=undefined -fno-omit-frame-pointer'
export CFLAGS='-fsanitize=address,undefined -fno-omit-frame-pointer'
export LDFLAGS='-fsanitize=address,undefined'
if [ "${MAT_FUZZ_NO_BUILD:-0}" != 1 ]; then
    # configure only once: each configure stamps a new MAT_BUILD_EPOCH_S and rebuilds what links mat_historian
    [ -f "$B/build.ninja" ] || cmake -S "$SRC" -B "$B" -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo > /dev/null || exit 1
    BIN="logic_fuzz_test package_fuzz_test project_fuzz_test expression_fuzz_test modbus_fuzz_test update_fuzz_test s7_fuzz_test fins_fuzz_test mc_fuzz_test"
    # shellcheck disable=SC2086
    cmake --build "$B" --target $BIN -j2 -- -k 0 > "$B/fuzz-build.log" 2>&1 ||
        cmake --build "$B" --target $BIN -j1 >> "$B/fuzz-build.log" 2>&1 ||
        { tail -40 "$B/fuzz-build.log"; echo "build failed"; exit 1; }
fi
cd "$SRC" || exit 1
ulimit -f 4000000
all=0
for t in $(echo "$TARGETS" | tr ',' ' '); do
    case $t in
        logic-json) bin=logic_fuzz_test; filter='LogicFuzz.*' ;;
        package) bin=package_fuzz_test; filter='PackageFuzz.Timed*' ;;
        project-json) bin=project_fuzz_test; filter='ProjectFuzz.*' ;;
        expression) bin=expression_fuzz_test; filter='ExpressionFuzz.*' ;;
        modbus) bin=modbus_fuzz_test; filter='ModbusFuzz*' ;;
        update-envelope) bin=update_fuzz_test; filter='*' ;;
        s7) bin=s7_fuzz_test; filter='S7Fuzz.*' ;;
        fins) bin=fins_fuzz_test; filter='FinsFuzz.*' ;;
        mc) bin=mc_fuzz_test; filter='McFuzz.*' ;;
        *) echo "unknown target $t"; exit 2 ;;
    esac
    start=$(date +%s)
    MAT_FUZZ_SECONDS=$S MAT_FUZZ_SEED=$SEED \
        ASAN_OPTIONS=detect_leaks=0:halt_on_error=1:quarantine_size_mb=32 \
        UBSAN_OPTIONS=halt_on_error=1:print_stacktrace=1 \
        "$B/bin/$bin" --gtest_filter="$filter" > "$B/fuzz-$t.log" 2>&1
    rc=$?
    grep -E '^(fuzz |\[ fuzz|\[fuzz\])' "$B/fuzz-$t.log" | head -20
    if [ $rc -ne 0 ]; then
        tail -60 "$B/fuzz-$t.log"
        all=$rc
    fi
    echo "fuzz $t: exit $rc, $(($(date +%s) - start)) s, seed $SEED, ASan + UBSan"
done
exit $all
