package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func writeTemp(t *testing.T, name, body string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestReadCookiesFile(t *testing.T) {
	c, err := readCookiesFile(writeTemp(t, "c.txt", "__Host-mat_sid=matw_a\n\n  __Host-mat_sid=matw_b  \n"))
	if err != nil || len(c) != 2 || c[0] != "__Host-mat_sid=matw_a" || c[1] != "__Host-mat_sid=matw_b" {
		t.Fatalf("got %v %v", c, err)
	}
	for name, body := range map[string]string{
		"empty":      "\n\n",
		"no-equals":  "matw_a\n",
		"set-cookie": "__Host-mat_sid=matw_a; Path=/; Secure\n",
	} {
		if _, err := readCookiesFile(writeTemp(t, name, body)); err == nil {
			t.Errorf("%s: want an error", name)
		}
	}
}

func TestReadClientTagsFile(t *testing.T) {
	l, err := readClientTagsFile(writeTemp(t, "t.json", `[["A","B"],["C"]]`))
	if err != nil || len(l) != 2 || l[1][0] != "C" {
		t.Fatalf("got %v %v", l, err)
	}
	for name, body := range map[string]string{"none": `[]`, "empty-entry": `[["A"],[]]`, "bad": `{"a":1}`} {
		if _, err := readClientTagsFile(writeTemp(t, name, body)); err == nil {
			t.Errorf("%s: want an error", name)
		}
	}
}

func TestForClientWSSCookiesTags(t *testing.T) {
	tc, err := newTLSClient(8443, "", true)
	if err != nil {
		t.Fatal(err)
	}
	o := options{host: "rt", port: 8080, tags: "500", tls: tc, wss: true, origin: originAuto,
		cookies: []string{"k=1", "k=2", "k=3"}, clientTags: [][]string{{"A"}, {"B", "C"}}}
	for idx, want := range map[int]struct {
		cookie string
		tags   int
	}{1: {"k=1", 1}, 2: {"k=2", 2}, 3: {"k=3", 1}, 4: {"k=1", 2}} {
		c := o.forClient(idx)
		if !c.useTLS || c.scheme() != "wss" {
			t.Errorf("client %d: want wss", idx)
		}
		if c.cookie != want.cookie || len(c.tagList()) != want.tags {
			t.Errorf("client %d: cookie %q tags %v", idx, c.cookie, c.tagList())
		}
		if c.originHeader() != "https://rt:8443" {
			t.Errorf("client %d: origin %q", idx, c.originHeader())
		}
	}
	// without -client-tags-file the -tags list stays
	if n := len((options{tags: "500"}).forClient(1).tagList()); n != 500 {
		t.Errorf("tags 500: %d", n)
	}
	// -alternate keeps its odd/even split
	a := options{host: "rt", port: 8080, tls: tc, alternate: true}
	if !a.forClient(1).useTLS || a.forClient(2).useTLS {
		t.Error("-alternate: odd over wss, even over ws")
	}
}

func TestSharedClockAbsoluteLatency(t *testing.T) {
	rs := []clientResult{{Mode: "normal", Accepted: true, lagSamples: []float64{1, 2}, absSamples: []float64{3, 4}}}
	if d := aggregateLatency(rs, options{host: "rt"}); d.ClockShared || d.Absolute.Count != 0 {
		t.Fatalf("off loopback without -shared-clock: %+v", d)
	}
	if d := aggregateLatency(rs, options{host: "rt", sharedClock: true}); !d.ClockShared || d.Absolute.Count != 2 || d.Absolute.MaxMs != 4 {
		t.Fatalf("-shared-clock: %+v", d)
	}
}

func TestParseSnapshotInfo(t *testing.T) {
	tags, denied := parseSnapshotInfo([]byte(`{"type":"snapshot","tags":[{"id":"A"},{"id":"B"}],"denied":["X"]}`))
	if tags != 2 || denied != 1 {
		t.Fatalf("got %d %d", tags, denied)
	}
	if tags, denied := parseSnapshotInfo([]byte(`not json`)); tags != 0 || denied != 0 {
		t.Fatal("bad json: 0 0")
	}
}

// A live server that admits only the expected cookie and checks the subscribed Tags, then sends
// a snapshot with one denied Tag, an access-changed and deltas.
func TestRunClientCookieAndAccessChanged(t *testing.T) {
	var mu sync.Mutex
	var gotTags []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Cookie") != "__Host-mat_sid=matw_ok" {
			http.Error(w, "no session", http.StatusUnauthorized)
			return
		}
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer c.CloseNow()
		ctx := r.Context()
		_ = c.Write(ctx, websocket.MessageText, []byte(`{"type":"hello","protocolVersion":"1.3.0"}`))
		_, data, err := c.Read(ctx)
		if err != nil {
			return
		}
		var sub struct {
			Tags []string `json:"tags"`
		}
		_ = json.Unmarshal(data, &sub)
		mu.Lock()
		gotTags = sub.Tags
		mu.Unlock()
		_ = c.Write(ctx, websocket.MessageText,
			[]byte(`{"type":"snapshot","subscriptionId":"s1","sequence":1,"tags":[{"id":"A"}],"denied":["B"]}`))
		_ = c.Write(ctx, websocket.MessageText, []byte(`{"type":"access-changed"}`))
		for seq := 2; seq < 6; seq++ {
			_ = c.Write(ctx, websocket.MessageText,
				[]byte(`{"type":"delta","subscriptionId":"s1","sequence":`+strconv.Itoa(seq)+`}`))
		}
		<-ctx.Done()
	}))
	defer srv.Close()
	u, _ := url.Parse(srv.URL)
	port, _ := strconv.Atoi(u.Port())
	o := options{host: u.Hostname(), port: port, proto: 1, tags: "500",
		cookies: []string{"__Host-mat_sid=matw_ok"}, clientTags: [][]string{{"A", "B"}}}
	before := time.Now().UnixMilli()
	res := runClient(context.Background(), o.forClient(1), 1, 700*time.Millisecond, modeNormal)
	if !res.Accepted || res.SnapshotTags != 1 || res.Denied != 1 || res.UpdatesReceived != 4 || res.SeqGaps != 0 {
		t.Fatalf("result %+v", res)
	}
	if len(res.AccessChangedAtMs) != 1 || res.AccessChangedAtMs[0] < before {
		t.Fatalf("accessChangedAtMs %v", res.AccessChangedAtMs)
	}
	if res.BytesReceived < 100 {
		t.Fatalf("bytesReceived %d", res.BytesReceived)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(gotTags) != 2 || gotTags[0] != "A" || gotTags[1] != "B" {
		t.Fatalf("subscribed %v", gotTags)
	}
	// a wrong cookie is refused before the upgrade
	bad := o
	bad.cookies = []string{"__Host-mat_sid=matw_no"}
	if r := runClient(context.Background(), bad.forClient(1), 1, 300*time.Millisecond, modeNormal); r.Accepted || r.Error == "" {
		t.Fatalf("wrong cookie: %+v", r)
	}
}
