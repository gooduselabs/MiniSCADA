#!/bin/sh
# Unit tests of the armhf build under qemu-user, inside the toolchain image (feature 006 T003).
# The tests are cross compiled (-DMAT_ARMHF_TESTS=ON, EXCLUDE_FROM_ALL), each copied to a temporary
# directory (qemu-user reads a Windows bind mount badly) and run with `qemu-arm -L ...`. They read the
# shared vectors from the source tree. The floating point of the 32-bit build must give the same bits
# as x64 on tests/*-vectors (-ffp-contract=off), the retained store its 64-bit integers, ...
# Usage (from /src): sh deployment/toolchain/test-armhf.sh [build dir, default build/armhf] [test ...]
set -u
# The fuzz of the Modbus frames runs a few seconds under qemu (the ctest run on x64 takes 60).
export MAT_FUZZ_SECONDS=${MAT_FUZZ_SECONDS:-8}
B=${1:-build/armhf}
[ $# -gt 0 ] && shift
DEFAULT="tag_store_test audit_log_test local_store_test sqlite_sync_test expression_vectors_test parser_test
value_table_test codec_test scaling_test web_session_test roles_test write_extensions_test server_cert_test widget_catalog_test sim_generators_test calc_graph_test merge_planner_test backoff_test
diag_counters_test scheduler_test retain_store_test tag_model_test engine_test simulation_driver_test
legacy_vectors_test source_filter_test config_test
frames_test tcp_socket_test modbus_tcp_driver_test modbus_tcp_write_test modbus_fuzz_test test_probe_test
token_bucket_test write_coordinator_test tag_write_audit_test
rtu_frame_test serial_port_test serial_ports_test modbus_rtu_driver_test serial_cli_test retain_cli_test
alarm_text_test alarm_defs_test alarm_engine_test alarm_state_table_test alarm_engine_vectors_test
alarm_store_test alarm_service_test"
TESTS=${*:-$DEFAULT}
cmake -S . -B "$B" -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_TOOLCHAIN_FILE=deployment/toolchain/armhf.cmake \
  -DMAT_ARMHF_TESTS=ON > /dev/null || { echo "armhf tests: configure failed"; exit 1; }
# shellcheck disable=SC2086
cmake --build "$B" --target $TESTS || { echo "armhf tests: build failed"; exit 1; }
T=$(mktemp -d /tmp/mat-armhf-tests-XXXXXX)
QEMU="qemu-arm -L /usr/arm-linux-gnueabihf"
failed=0
for t in $TESTS; do
  cp "$B/bin/$t" "$T/"
  start=$(date +%s)
  if $QEMU "$T/$t" > "$T/$t.log" 2>&1; then
    n=$(grep -c '^\[       OK \]' "$T/$t.log")
    echo "armhf $t: $n tests passed ($(( $(date +%s) - start )) s)"
  else
    failed=1
    echo "armhf $t: FAILED"
    tail -40 "$T/$t.log"
  fi
done
rm -rf "$T"
exit $failed
