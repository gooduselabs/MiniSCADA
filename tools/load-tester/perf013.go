// Feature 013 (T032, SC-006): live clients logged in with a web session, each with its own Tag
// list, so that the cost of the access rules can be measured with the same load as without them.
//
//	load-tester -host rt -wss -tls-port 8443 -fingerprint <sha256> -cookies-file cookies.txt \
//	    -client-tags-file tags.json -clients 10 -extra 0 -duration 90 -latency -out r.json
//
// -wss: every client over wss://host:<tls-port> (a session cookie is __Host-, so it only goes over
// HTTPS); needs -fingerprint or -insecure like -alternate, and sends the Origin of the wss
// listener unless -origin is given.
// -cookies-file: one Cookie header value per line ("__Host-mat_sid=matw_..."); client i (1-based)
// sends line (i-1) mod n. The sessions are opened beforehand (web login, e.g. tools/load/perf013.mjs):
// this tool never sees a password.
// -client-tags-file: a JSON array of Tag arrays; client i subscribes to entry (i-1) mod n instead
// of -tags.
//
// Each clientResults[] entry then adds snapshotTags and denied (from the first snapshot),
// bytesReceived (text payload bytes) and accessChangedAtMs (receive wall clock, UnixMilli, of
// every {"type":"access-changed"}), so a driver on the same clock can time a rule change.
package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
)

// readCookiesFile: non-empty lines, trimmed; a line must look like name=value without ';' or a
// line break (one cookie, not a Set-Cookie line).
func readCookiesFile(path string) ([]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var out []string
	sc := bufio.NewScanner(f)
	for n := 1; sc.Scan(); n++ {
		l := strings.TrimSpace(sc.Text())
		if l == "" {
			continue
		}
		if !strings.Contains(l, "=") || strings.ContainsAny(l, ";\r\n") {
			return nil, fmt.Errorf("%s:%d: want name=value (one cookie)", path, n)
		}
		out = append(out, l)
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("%s: no cookie", path)
	}
	return out, nil
}

// readClientTagsFile: a JSON array of non-empty arrays of Tag ids.
func readClientTagsFile(path string) ([][]string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var out [][]string
	if err := json.Unmarshal(b, &out); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	if len(out) == 0 {
		return nil, errors.New(path + ": no Tag list")
	}
	for i, l := range out {
		if len(l) == 0 {
			return nil, fmt.Errorf("%s: entry %d is empty", path, i)
		}
	}
	return out, nil
}

// pick returns entry (idx-1) mod len of a per-client list (idx is 1-based).
func pick[T any](list []T, idx int) (T, bool) {
	var zero T
	if len(list) == 0 || idx < 1 {
		return zero, false
	}
	return list[(idx-1)%len(list)], true
}

// snapshotInfo: the parts of a snapshot read only for -client-tags-file / -cookies-file runs (a
// separate decode, so the shape of "tags" in other messages never matters).
type snapshotInfo struct {
	Tags   []json.RawMessage `json:"tags"`
	Denied []string          `json:"denied"`
}

func parseSnapshotInfo(data []byte) (tags, denied int) {
	var s snapshotInfo
	if json.Unmarshal(data, &s) != nil {
		return 0, 0
	}
	return len(s.Tags), len(s.Denied)
}
