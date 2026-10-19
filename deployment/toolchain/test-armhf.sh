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
token_bucket_test write_coordinator_test tag_write_audit_test pulse_journal_test
rtu_frame_test serial_port_test serial_ports_test modbus_rtu_driver_test serial_cli_test retain_cli_test
alarm_text_test alarm_defs_test alarm_engine_test alarm_state_table_test alarm_engine_vectors_test
alarm_store_test alarm_service_test
proc_stats_test diagnostics_011_test time_sync_test check_data_test
logic_vectors_test logic_timers_test logic_counters_test logic_totalizer_test logic_runhours_test
logic_schedule_test logic_rules_test logic_skip_test rules_logic_test logic_write_test logic_runtime_test
update_envelope_test update_signature_test update_fuzz_test
access_model_test access_vectors_test access_catalog_test access_store_test account_store_test"
TESTS=${*:-$DEFAULT}
cmake -S . -B "$B" -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_TOOLCHAIN_FILE=deployment/toolchain/armhf.cmake \
  -DMAT_ARMHF_TESTS=ON > /dev/null || { echo "armhf tests: configure failed"; exit 1; }
# Docker on a dev machine has ~3 GB: ninja's default (CPUs + 2) gets cc1plus killed on the large tests.
# shellcheck disable=SC2086
cmake --build "$B" -j "${MAT_BUILD_JOBS:-2}" --target $TESTS || { echo "armhf tests: build failed"; exit 1; }
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
# mat-update-verify (feature 011 T096, FR-069): the armhf tool itself on the shared vectors, with the exit
# codes mat-updater and deploy.sh read (0 valid, 3 signature, 4 no key, 5 invalid, 6 refused for the tree).
case " $TESTS " in
*" update_envelope_test "*)
  if cmake --build "$B" --target mat-update-verify > /dev/null; then
    cp "$B/bin/mat-update-verify" "$T/"
    V=tests/update-vectors
    K="--keys $V/keys-trusted"
    mkdir -p "$T/inst" "$T/nokeys"
    echo '{"version":"1.0.0","releaseSeq":10}' > "$T/inst/build-info.json"
    vfail=0
    for c in "0 $V/valid.matupdate $K" "3 $V/bad/01-sig-byte.matupdate $K" "4 $V/valid.matupdate --keys $T/nokeys" \
             "5 $V/bad/04-payload-byte.matupdate $K" "5 $V/bad/10-link.matupdate $K" \
             "6 $V/bad/16-downgrade.matupdate $K --installed $T/inst" "0 $V/sums/SHA256SUMS --sig $V/sums/SHA256SUMS.sig $K"; do
      # shellcheck disable=SC2086
      set -- $c
      want=$1
      shift
      $QEMU "$T/mat-update-verify" "$@" > "$T/v.out" 2>&1
      got=$?
      [ "$got" = "$want" ] || { vfail=1; echo "armhf mat-update-verify $*: exit $got, want $want"; cat "$T/v.out"; }
    done
    size=$(stat -c %s "$B/bin/mat-update-verify")
    # shellcheck disable=SC2086
    timing=$($QEMU "$T/mat-update-verify" $V/valid.matupdate $K --bench 50 2>&1 >/dev/null | tail -1)
    echo "armhf mat-update-verify: exit codes $([ $vfail = 0 ] && echo ok || echo FAILED), $size bytes, $timing (qemu)"
    [ $vfail = 0 ] || failed=1
  else
    failed=1
    echo "armhf mat-update-verify: build failed"
  fi ;;
esac
rm -rf "$T"
exit $failed
