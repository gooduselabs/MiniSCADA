#!/bin/sh
# Fuzz of the .matupdate reader under ASan + UBSan (feature 011 T118; FR-029): builds only
# update_fuzz_test (core/update, Mbed TLS, miniz, GoogleTest) in its own build directory and runs
# the three targets (envelope, manifest, payload) for <seconds> in total. Inside mat-armhf:
#   sh tools/fuzz/update-envelope/run.sh <build dir> <seconds> [seed]
# tools/fuzz/update-envelope.ps1 runs it in Docker and writes docs/reports/011-fuzz-x64.json.
set -u
B=${1:?build dir}
S=${2:-3600}
SEED=${3:-20261017}
SRC=$(cd "$(dirname "$0")/../../.." && pwd)
cmake -S "$SRC" -B "$B" -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo \
    -DCMAKE_CXX_FLAGS="-fsanitize=address,undefined -fno-sanitize-recover=undefined -fno-omit-frame-pointer" \
    -DCMAKE_C_FLAGS="-fsanitize=address,undefined -fno-omit-frame-pointer" \
    -DCMAKE_EXE_LINKER_FLAGS="-fsanitize=address,undefined" > /dev/null || exit 1
cmake --build "$B" --target update_fuzz_test -j2 > /dev/null || { echo "build failed"; exit 1; }
cd "$SRC" || exit 1
start=$(date +%s)
MAT_FUZZ_SECONDS=$S MAT_FUZZ_SEED=$SEED ASAN_OPTIONS=detect_leaks=0:halt_on_error=1 \
    UBSAN_OPTIONS=halt_on_error=1:print_stacktrace=1 "$B/bin/update_fuzz_test"
rc=$?
echo "fuzz update-envelope: exit $rc, $(( $(date +%s) - start )) s, seed $SEED, ASan + UBSan"
exit $rc
