package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeLiveTLS adds an HTTPS listener (like the runtime's 8443) to fakeLive: both listeners share
// the same slots. The Origin check is the runtime's (server/websocket/origin.cpp): no Origin, or
// http://<Host>, or https://<Host> over TLS; anything else gets 403 before the handshake.
type fakeLiveTLS struct {
	*fakeLive
	plainSrv *httptest.Server // the 8080 of the test: fakeLive's handler behind the Origin check
	tlsSrv   *httptest.Server
	hmu      sync.Mutex
	seen     []string // "<scheme> <origin>" of each admitted handshake
	refused  int      // handshakes refused because of the Origin
}

func newFakeLiveTLS(t *testing.T, max int) *fakeLiveTLS {
	t.Helper()
	f := &fakeLiveTLS{fakeLive: newFakeLive(t, max)}
	inner := f.srv.Config.Handler // system/info and live of fakeLive
	wrap := func(tls bool) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/api/v1/live" {
				inner.ServeHTTP(w, r)
				return
			}
			origin := r.Header.Get("Origin")
			ok := origin == "" || origin == "http://"+r.Host || (tls && origin == "https://"+r.Host)
			scheme := "ws"
			if tls {
				scheme = "wss"
			}
			f.hmu.Lock()
			if ok {
				f.seen = append(f.seen, scheme+" "+origin)
			} else {
				f.refused++
			}
			f.hmu.Unlock()
			if !ok {
				http.Error(w, "Origin not allowed", http.StatusForbidden)
				return
			}
			f.handle(w, r)
		})
	}
	f.plainSrv = httptest.NewServer(wrap(false))
	t.Cleanup(f.plainSrv.Close)
	f.tlsSrv = httptest.NewTLSServer(wrap(true))
	t.Cleanup(f.tlsSrv.Close)
	return f
}

func (f *fakeLiveTLS) pin() string {
	sum := sha256.Sum256(f.tlsSrv.Certificate().Raw)
	return hex.EncodeToString(sum[:])
}

func (f *fakeLiveTLS) alternateOptions(t *testing.T, pin string, insecure bool) options {
	t.Helper()
	o := f.options("500")
	pu, _ := url.Parse(f.plainSrv.URL)
	o.port, _ = strconv.Atoi(pu.Port())
	u, _ := url.Parse(f.tlsSrv.URL)
	port, _ := strconv.Atoi(u.Port())
	tc, err := newTLSClient(port, pin, insecure)
	if err != nil {
		t.Fatal(err)
	}
	o.tls = tc
	o.alternate = true
	o.origin = originAuto
	return o
}

func (f *fakeLiveTLS) handshakes() []string {
	f.hmu.Lock()
	defer f.hmu.Unlock()
	return append([]string(nil), f.seen...)
}

func (f *fakeLiveTLS) refusedCount() int {
	f.hmu.Lock()
	defer f.hmu.Unlock()
	return f.refused
}

func TestParseFingerprint(t *testing.T) {
	want := strings.Repeat("ab", 32)
	for _, in := range []string{
		want,
		strings.ToUpper(want),
		strings.TrimSuffix(strings.Repeat("AB:", 32), ":"),
		"SHA256 Fingerprint=" + strings.TrimSuffix(strings.Repeat("AB:", 32), ":"),
		"sha256 Fingerprint=" + strings.TrimSuffix(strings.Repeat("ab:", 32), ":") + "\n",
	} {
		b, err := parseFingerprint(in)
		if err != nil || hex.EncodeToString(b) != want {
			t.Fatalf("parseFingerprint(%q) = %x, %v", in, b, err)
		}
	}
	for _, bad := range []string{"", "abcd", strings.Repeat("zz", 32), strings.Repeat("ab", 33)} {
		if _, err := parseFingerprint(bad); err == nil {
			t.Fatalf("parseFingerprint(%q) must fail", bad)
		}
	}
}

// Verification of 8443 is an explicit choice: a pin or -insecure, never both, never neither.
func TestTLSChoiceIsExplicit(t *testing.T) {
	pin := strings.Repeat("ab", 32)
	if _, err := newTLSClient(8443, "", false); err == nil {
		t.Fatal("neither -fingerprint nor -insecure must be refused")
	}
	if _, err := newTLSClient(8443, pin, true); err == nil {
		t.Fatal("-fingerprint and -insecure together must be refused")
	}
	c, err := newTLSClient(8443, pin, false)
	if err != nil || c.Verify != "pinned-sha256" || c.Fingerprint != pin {
		t.Fatalf("pinned: %+v, %v", c, err)
	}
	c, err = newTLSClient(8443, "", true)
	if err != nil || c.Verify != "insecure" {
		t.Fatalf("insecure: %+v, %v", c, err)
	}
}

// -alternate: odd clients over wss://host:<tls-port>, even ones over ws://host:<port>; with
// -origin auto each sends the Origin of its own scheme and port.
func TestForClientAlternates(t *testing.T) {
	tc, _ := newTLSClient(8443, strings.Repeat("ab", 32), false)
	o := options{host: "10.0.0.5", port: 8080, proto: 1, tls: tc, alternate: true, origin: originAuto}
	c1, c2 := o.forClient(1), o.forClient(2)
	if c1.scheme() != "wss" || c1.wsURL() != "wss://10.0.0.5:8443/api/v1/live" || c1.originHeader() != "https://10.0.0.5:8443" {
		t.Fatalf("client 1: %s %s %q", c1.scheme(), c1.wsURL(), c1.originHeader())
	}
	if c2.scheme() != "ws" || c2.wsURL() != "ws://10.0.0.5:8080/api/v1/live" || c2.originHeader() != "http://10.0.0.5:8080" {
		t.Fatalf("client 2: %s %s %q", c2.scheme(), c2.wsURL(), c2.originHeader())
	}
	// Without -alternate nothing changes: ws, the -origin given as is.
	p := options{host: "10.0.0.5", port: 8080, origin: "http://evil.example"}
	if p.forClient(1).scheme() != "ws" || p.forClient(1).originHeader() != "http://evil.example" {
		t.Fatal("no -alternate: plain ws and the given Origin")
	}
	if (options{host: "::1", port: 8080, origin: originAuto}).originHeader() != "http://[::1]:8080" {
		t.Fatal("IPv6 Origin needs brackets")
	}
}

// Against a fake runtime with both listeners: 4 clients, 2 per scheme, every Origin accepted,
// one summary per scheme.
func TestAlternateAgainstFakeTLS(t *testing.T) {
	f := newFakeLiveTLS(t, 4)
	o := f.alternateOptions(t, f.pin(), false)
	rs := make([]clientResult, 4)
	var wg sync.WaitGroup
	for i := range rs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			rs[i] = runClient(context.Background(), o.forClient(i+1), i+1, 500*time.Millisecond, modeNormal)
		}(i)
	}
	wg.Wait()
	for _, r := range rs {
		if !r.Accepted || r.UpdatesReceived == 0 || r.SeqGaps != 0 {
			t.Fatalf("client %d: %+v", r.ClientIndex, r)
		}
		want := "ws"
		if r.ClientIndex%2 == 1 {
			want = "wss"
		}
		if r.Scheme != want {
			t.Fatalf("client %d scheme %q, want %q", r.ClientIndex, r.Scheme, want)
		}
	}
	hs := f.handshakes()
	tlsHost := strings.TrimPrefix(f.tlsSrv.URL, "https://")
	plainHost := strings.TrimPrefix(f.plainSrv.URL, "http://")
	var nWss, nWs int
	for _, h := range hs {
		switch h {
		case "wss https://" + tlsHost:
			nWss++
		case "ws http://" + plainHost:
			nWs++
		default:
			t.Fatalf("unexpected handshake %q", h)
		}
	}
	if nWss != 2 || nWs != 2 || f.refusedCount() != 0 {
		t.Fatalf("handshakes %v, refused %d", hs, f.refusedCount())
	}
	by := summarizeByScheme(rs)
	if by["ws"].Accepted != 2 || by["wss"].Accepted != 2 || by["wss"].TotalGaps != 0 {
		t.Fatalf("by scheme: %+v", by)
	}
	c := alternationCheck(by)
	if !c.Pass {
		t.Fatalf("alternation check: %+v", c)
	}
}

// A wrong pin: the handshake stops after TLS, no slot is taken, the error names the fingerprint.
func TestPinMismatchRefused(t *testing.T) {
	f := newFakeLiveTLS(t, 2)
	o := f.alternateOptions(t, strings.Repeat("00", 32), false)
	r := runClient(context.Background(), o.forClient(1), 1, 300*time.Millisecond, modeNormal)
	if r.Accepted || !strings.Contains(r.Error, "fingerprint") || r.Scheme != "wss" {
		t.Fatalf("wrong pin must fail: %+v", r)
	}
	if len(f.handshakes()) != 0 {
		t.Fatalf("no handshake may reach the server: %v", f.handshakes())
	}
	// -insecure (explicit) connects whatever the certificate.
	o = f.alternateOptions(t, "", true)
	r = runClient(context.Background(), o.forClient(1), 1, 300*time.Millisecond, modeNormal)
	if !r.Accepted {
		t.Fatalf("-insecure: %+v", r)
	}
}

// -alternate measures what notMeasured listed for L1/L2.
func TestWithAlternation(t *testing.T) {
	by := map[string]summary{"ws": {Accepted: 5}, "wss": {Accepted: 5}}
	cs, nm := withAlternation(buildChecks("L1", summary{}, nil, nil), notMeasured("L1"), by)
	if !allPass(cs) || len(cs) != 2 {
		t.Fatalf("checks: %+v", cs)
	}
	for _, k := range nm {
		if k == "wss8443Alternation" {
			t.Fatalf("still not measured: %v", nm)
		}
	}
	if len(nm) != len(notMeasured("L1"))-1 {
		t.Fatalf("only wss8443Alternation leaves notMeasured: %v", nm)
	}
}

// One scheme without an accepted client (e.g. 8443 down) fails the alternation check.
func TestAlternationCheckNeedsBothSchemes(t *testing.T) {
	by := map[string]summary{"ws": {Accepted: 5}, "wss": {Accepted: 0, Rejected: 5}}
	if alternationCheck(by).Pass {
		t.Fatal("no wss client accepted must fail")
	}
	by = map[string]summary{"ws": {Accepted: 5}, "wss": {Accepted: 5, TotalGaps: 1}}
	if alternationCheck(by).Pass {
		t.Fatal("a gap over wss must fail")
	}
}
