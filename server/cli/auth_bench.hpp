// `mat-runtime --auth-bench [--m <KiB>] [--t <n>]` (specs/005-device-online research R7, ADR-011,
// task T055): times the Argon2id password hash the runtime uses, with the parameters of new hashes
// unless given (p = 1). It only computes: no file, no configuration, any user.
//
// Prints the median, minimum and maximum wall time of kAuthBenchRuns hashes (after one warm-up),
// the CPU time, the RSS before and at its peak, the hash memory, the machine, the verdict against
// the target of R7 (0.3–0.8 s per sign-in on the BL335; SC-007 caps it at 1 s), and one line ready
// for the measurements table of ADR-011.
// Exit codes: 0 ok; 2 bad arguments (m outside 8192–65536 KiB, t outside 1–10); 4 the hash
// failed (out of memory).
#pragma once
#include <ostream>

namespace mat {

constexpr int kAuthBenchRuns = 10;

int runAuthBenchCli(int argc, char** argv, std::ostream& out, std::ostream& err);

}  // namespace mat
