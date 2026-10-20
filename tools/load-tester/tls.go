// L1 over both listeners (feature 011, T079; contracts/test-protocols.md §1: "cổng 8080 (HTTP) và
// 8443 xen kẽ"). With -alternate, odd clients (1, 3, 5, ...) connect to wss://host:<tls-port>
// and even ones to ws://host:<port>; the extra client 11 is odd, so its 4429 comes over wss.
//
//	load-tester -host H -tags 500 -clients 10 -extra 1 -duration 14400 -latency \
//	    -alternate -tls-port 8443 -fingerprint <sha256 hex> -out l1.json
//
// Verification of the device certificate is always an explicit choice: -fingerprint pins the
// SHA-256 of the leaf certificate (the "SHA256 Fingerprint=" line of mat-runtime
// --cert-fingerprint; colons and the prefix are accepted), checked right after the TLS handshake,
// before the HTTP upgrade is sent; -insecure skips verification and says so in the JSON
// ("tls.verify": "insecure"). Neither, or both, is a usage error (exit 2).
//
// Origin: with -alternate an empty -origin means "auto": each client sends the Origin of its own
// listener, http://host:port or https://host:tls-port (what the page served by that listener
// sends; accepted by server/websocket/origin.cpp). Any other -origin is sent as given.
//
// JSON: each clientResults[] entry has "scheme" ("ws" | "wss"); the document adds
// "tls": {"port", "verify", "fingerprint"}, "summaryByScheme": {"ws": summary, "wss": summary},
// "latencyByScheme" (with -latency), and the check "both 8080 (ws) and 8443 (wss) carry live data".
// Only the hold of L1/L2 alternates; -extra-attempts, -reentry, -flap, -resub and -slot-test stay
// on ws://.
package main

import (
	"bytes"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"
)

// originAuto: the -origin value that sends the Origin of the client's own listener.
const originAuto = "auto"

type tlsClient struct {
	Port        int    `json:"port"`
	Verify      string `json:"verify"` // pinned-sha256 | insecure
	Fingerprint string `json:"fingerprint,omitempty"`
	pin         []byte
}

var hex64 = regexp.MustCompile(`^[0-9a-f]{64}$`)

// parseFingerprint accepts "abcd...", "AB:CD:..." or "SHA256 Fingerprint=AB:CD:..." (64 hex).
func parseFingerprint(s string) ([]byte, error) {
	s = strings.TrimSpace(s)
	if i := strings.LastIndex(s, "="); i >= 0 {
		s = s[i+1:]
	}
	s = strings.ToLower(strings.ReplaceAll(s, ":", ""))
	if !hex64.MatchString(s) {
		return nil, fmt.Errorf("fingerprint %q: want the SHA-256 of the certificate, 64 hex digits", s)
	}
	return hex.DecodeString(s)
}

// newTLSClient: exactly one of a pin or insecure (verification is never skipped silently).
func newTLSClient(port int, fingerprint string, insecure bool) (*tlsClient, error) {
	switch {
	case fingerprint != "" && insecure:
		return nil, errors.New("-fingerprint and -insecure exclude each other")
	case insecure:
		return &tlsClient{Port: port, Verify: "insecure"}, nil
	case fingerprint == "":
		return nil, errors.New("wss needs -fingerprint <sha256 of the device certificate> (or -insecure, explicitly)")
	}
	pin, err := parseFingerprint(fingerprint)
	if err != nil {
		return nil, err
	}
	return &tlsClient{Port: port, Verify: "pinned-sha256", Fingerprint: hex.EncodeToString(pin), pin: pin}, nil
}

// config: the chain of a self-signed device certificate cannot be verified, so the pin replaces
// it (VerifyConnection runs on every handshake, before any HTTP byte is sent).
func (c *tlsClient) config() *tls.Config {
	cfg := &tls.Config{InsecureSkipVerify: true, MinVersion: tls.VersionTLS12} // #nosec G402: pinned below, or -insecure on request
	if c.pin != nil {
		pin := c.pin
		cfg.VerifyConnection = func(cs tls.ConnectionState) error {
			if len(cs.PeerCertificates) == 0 {
				return errors.New("no server certificate to compare with the pinned fingerprint")
			}
			sum := sha256.Sum256(cs.PeerCertificates[0].Raw)
			if !bytes.Equal(sum[:], pin) {
				return fmt.Errorf("certificate fingerprint %x is not the pinned %x", sum, pin)
			}
			return nil
		}
	}
	return cfg
}

func (c *tlsClient) httpClient() *http.Client {
	return &http.Client{Transport: &http.Transport{TLSClientConfig: c.config()}}
}

// forClient: the options of client idx (1-based). With -alternate odd clients go over wss.
func (o options) forClient(idx int) options {
	o.useTLS = o.tls != nil && (o.wss || (o.alternate && idx%2 == 1))
	if c, ok := pick(o.cookies, idx); ok {
		o.cookie = c
	}
	if t, ok := pick(o.clientTags, idx); ok {
		o.ownTags = t
	}
	return o
}

func (o options) scheme() string {
	if o.useTLS {
		return "wss"
	}
	return "ws"
}

func (o options) originHeader() string {
	if o.origin != originAuto {
		return o.origin
	}
	if o.useTLS {
		return "https://" + net.JoinHostPort(o.host, strconv.Itoa(o.tls.Port))
	}
	return "http://" + net.JoinHostPort(o.host, strconv.Itoa(o.port))
}

// summarizeByScheme: the summary of the clients of each listener.
func summarizeByScheme(rs []clientResult) map[string]summary {
	parts := map[string][]clientResult{"ws": nil, "wss": nil}
	for _, r := range rs {
		parts[r.Scheme] = append(parts[r.Scheme], r)
	}
	out := map[string]summary{}
	for k, v := range parts {
		out[k] = summarize(v)
	}
	return out
}

func latencyByScheme(rs []clientResult, o options) map[string]latencyDoc {
	out := map[string]latencyDoc{}
	for _, sc := range []string{"ws", "wss"} {
		var part []clientResult
		for _, r := range rs {
			if r.Scheme == sc {
				part = append(part, r)
			}
		}
		out[sc] = aggregateLatency(part, o)
	}
	return out
}

// alternationCheck: L1 asks for 8080 and 8443 alternately; both must carry live data without a
// lost sequence.
func alternationCheck(by map[string]summary) checkResult {
	ws, wss := by["ws"], by["wss"]
	return checkResult{
		Name: "both 8080 (ws) and 8443 (wss) carry live data, 0 sequence lost",
		Pass: ws.Accepted > 0 && wss.Accepted > 0 && ws.TotalGaps == 0 && wss.TotalGaps == 0,
		Value: fmt.Sprintf("ws %d accepted %d lost, wss %d accepted %d lost",
			ws.Accepted, ws.TotalGaps, wss.Accepted, wss.TotalGaps),
		Limit: "both > 0 accepted, 0 lost",
	}
}

// withAlternation adds the alternation check and drops "wss8443Alternation" from notMeasured.
func withAlternation(checks []checkResult, nm []string, by map[string]summary) ([]checkResult, []string) {
	checks = append(checks, alternationCheck(by))
	out := make([]string, 0, len(nm))
	for _, k := range nm {
		if k != "wss8443Alternation" {
			out = append(out, k)
		}
	}
	return checks, out
}
