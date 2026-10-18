package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// fakeLive is a minimal /api/v1/live server for the tests (never a device): it admits up to max
// sessions, refuses the next ones with close 4429, sends hello, then a snapshot after subscribe,
// then a delta every 20 ms (ts 5 ms in the past). /api/v1/system/info reports the open sessions.
type fakeLive struct {
	srv    *httptest.Server
	max    int
	idle   time.Duration // > 0: a session that sends nothing this long is closed with 4408 (heartbeat timeout)
	mu     sync.Mutex
	active map[*websocket.Conn]context.CancelFunc
}

func newFakeLive(t *testing.T, max int) *fakeLive {
	t.Helper()
	f := &fakeLive{max: max, active: map[*websocket.Conn]context.CancelFunc{}}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/system/info", func(w http.ResponseWriter, _ *http.Request) {
		f.mu.Lock()
		n := len(f.active)
		f.mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]any{"runtimeVersion": "fake", "protocolVersion": "1.0.0",
			"clients": n, "maxClients": f.max, "uptimeS": 1})
	})
	mux.HandleFunc("/api/v1/live", f.handle)
	f.srv = httptest.NewServer(mux)
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeLive) options(tags string) options {
	u, _ := url.Parse(f.srv.URL)
	port, _ := strconv.Atoi(u.Port())
	return options{host: u.Hostname(), port: port, proto: 1, tags: tags}
}

func (f *fakeLive) handle(w http.ResponseWriter, r *http.Request) {
	c, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	f.mu.Lock()
	if len(f.active) >= f.max {
		f.mu.Unlock()
		cancel()
		c.Close(4429, "max clients")
		return
	}
	f.active[c] = cancel
	f.mu.Unlock()
	defer func() {
		f.mu.Lock()
		delete(f.active, c)
		f.mu.Unlock()
		cancel()
		c.CloseNow()
	}()
	if c.Write(ctx, websocket.MessageText, []byte(`{"type":"hello","protocolVersion":"1.0.0"}`)) != nil {
		return
	}
	subscribed := make(chan struct{})
	var lastMsg atomic.Int64
	lastMsg.Store(time.Now().UnixNano())
	go func() {
		once := sync.Once{}
		for {
			_, data, err := c.Read(ctx)
			if err != nil {
				cancel()
				return
			}
			lastMsg.Store(time.Now().UnixNano())
			var m msg
			if json.Unmarshal(data, &m) == nil && m.Type == "subscribe" {
				once.Do(func() { close(subscribed) })
			}
		}
	}()
	select {
	case <-subscribed:
	case <-ctx.Done():
		return
	}
	seq := uint64(1)
	send := func(typ string) error {
		b := fmt.Sprintf(`{"type":%q,"subscriptionId":"s1","sequence":%d,"ts":%d}`, typ, seq,
			time.Now().Add(-5*time.Millisecond).UnixMilli())
		seq++
		return c.Write(ctx, websocket.MessageText, []byte(b))
	}
	if send("snapshot") != nil {
		return
	}
	t := time.NewTicker(20 * time.Millisecond)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if f.idle > 0 && time.Since(time.Unix(0, lastMsg.Load())) > f.idle {
				// Like civet_transport expire(): the close frame may not get through to a client
				// that stopped reading, so the slot is released here, not after the handshake.
				f.mu.Lock()
				delete(f.active, c)
				f.mu.Unlock()
				go c.Close(4408, "HEARTBEAT_TIMEOUT")
				<-ctx.Done()
				return
			}
			if send("delta") != nil {
				return
			}
		}
	}
}

// cut drops every open session without a close frame (a network cut seen from the client).
func (f *fakeLive) cut() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := len(f.active)
	for c, cancel := range f.active {
		cancel()
		c.CloseNow()
	}
	return n
}

// FR-038: --tags 500|1000 subscribe SIM.T0001.. (the Tags of tools/gen-bench-projects.mjs).
func TestTagCounts(t *testing.T) {
	for spec, n := range map[string]int{"500": 500, "1000": 1000} {
		l := options{tags: spec}.tagList()
		if len(l) != n || l[0] != "SIM.T0001" || l[n-1] != fmt.Sprintf("SIM.T%04d", n) {
			t.Fatalf("--tags %s: %d tags, first %q, last %q", spec, len(l), l[0], l[len(l)-1])
		}
	}
	for _, ok := range []string{"sim", "demo", "bench", "500", "1000"} {
		if err := validateTags(ok); err != nil {
			t.Fatalf("validateTags(%q) = %v", ok, err)
		}
	}
	if validateTags("750") == nil {
		t.Fatal("--tags 750 must be refused")
	}
}

func TestLatencyStats(t *testing.T) {
	s := newLatencyStats([]float64{4, 1, 3, 2, 100, 5, 6, 7, 8, 9})
	if s.Count != 10 || s.P50Ms != 5 || s.P95Ms != 100 || s.MaxMs != 100 {
		t.Fatalf("bad stats: %+v", s)
	}
	if e := newLatencyStats(nil); e.Count != 0 || e.MaxMs != 0 {
		t.Fatalf("empty: %+v", e)
	}
}

// Contract test-protocols §1: the scenario code follows from the flags.
func TestScenarioCode(t *testing.T) {
	cases := []struct {
		c    loadConfig
		want string
	}{
		{loadConfig{Tags: "500", Clients: 10}, "L1"},
		{loadConfig{Tags: "1000", Clients: 10}, "L2"},
		{loadConfig{Tags: "500", Clients: 10, Extra: 1, ExtraAttempts: 50}, "L3"},
		{loadConfig{Tags: "500", Clients: 10, Flap: 50}, "L6"},
		{loadConfig{Tags: "demo", Clients: 3}, "custom"},
	}
	for _, c := range cases {
		if got := scenarioCode(c.c); got != c.want {
			t.Fatalf("scenarioCode(%+v) = %s, want %s", c.c, got, c.want)
		}
	}
	// CPU and RSS come from mat-sample / proc-sample, never from this tool: always listed as not measured.
	nm := notMeasured("L1")
	has := map[string]bool{}
	for _, k := range nm {
		has[k] = true
	}
	if !has["cpuAvgPct"] || !has["rssMaxMB"] {
		t.Fatalf("notMeasured(L1) = %v", nm)
	}
}

// L3: the 11th client is refused with close 4429; every attempt records its close code.
func TestExtraAttemptsRecordCloseCode(t *testing.T) {
	f := newFakeLive(t, 2)
	o := f.options("500")
	ctx := context.Background()
	hold := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			s, _, err := openSession(ctx, o, 5*time.Second)
			if err != nil {
				t.Errorf("client %d: %v", i, err)
				return
			}
			<-hold
			s.close()
		}(i)
	}
	waitFor(t, func() bool { return f.count() == 2 })
	r := extraAttempts(ctx, o, 3)
	close(hold)
	wg.Wait()
	if r.Attempts != 3 || r.Rejected4429 != 3 || len(r.CloseCodes) != 3 || r.CloseCodes[0] != 4429 || !r.Pass {
		t.Fatalf("bad L3 result: %+v", r)
	}
	// With a free slot the extra client is accepted: the check must fail.
	r = extraAttempts(ctx, o, 1)
	if r.Pass || r.Accepted != 1 {
		t.Fatalf("free slot must fail L3: %+v", r)
	}
}

// L6 (tool side): N clients close abruptly and reconnect; reconnect times and slots left.
func TestFlapCloseMode(t *testing.T) {
	f := newFakeLive(t, 3)
	o := f.options("500")
	r := flapTest(context.Background(), o, flapConfig{Clients: 3, Cycles: 4, Mode: "close",
		Hold: 50 * time.Millisecond, Settle: 200 * time.Millisecond, Limit: 35 * time.Second})
	if r.Cycles != 4 || r.Reconnects != 12 || r.Failed != 0 || r.OverLimit != 0 {
		t.Fatalf("bad flap: %+v", r)
	}
	if !r.SlotsMeasured || r.SlotsLeaked != 0 || !r.Pass || r.ReconnectMs.Count != 12 {
		t.Fatalf("bad flap slots/pass: %+v", r)
	}
}

// L6 (external cut: ip link, switch port, docker network disconnect): the tool notices the drop
// and reconnects; here the fake server cuts every session twice.
func TestFlapExternalMode(t *testing.T) {
	f := newFakeLive(t, 2)
	o := f.options("500")
	done := make(chan flapResult, 1)
	go func() {
		done <- flapTest(context.Background(), o, flapConfig{Clients: 2, Cycles: 2, Mode: "external",
			Settle: 200 * time.Millisecond, Limit: 35 * time.Second, Timeout: 20 * time.Second})
	}()
	for k := 0; k < 2; k++ {
		waitFor(t, func() bool { return f.count() == 2 })
		time.Sleep(100 * time.Millisecond)
		f.cut()
	}
	r := <-done
	if r.Reconnects != 4 || r.Failed != 0 || !r.Pass || r.SlotsLeaked != 0 {
		t.Fatalf("bad external flap: %+v", r)
	}
}

// Slots cannot be read (no system/info): reported as not measured, never as 0.
func TestSlotsLeakedUnknown(t *testing.T) {
	n, ok := slotsOpen(nil)
	if ok || n != -1 {
		t.Fatalf("slotsOpen(nil) = %d, %v", n, ok)
	}
	n, ok = slotsOpen(map[string]any{"clients": 2.0})
	if !ok || n != 2 {
		t.Fatalf("slotsOpen = %d, %v", n, ok)
	}
}

// --latency: end-to-end delay of deltas aggregated over the normal clients.
func TestLatencyAggregate(t *testing.T) {
	f := newFakeLive(t, 2)
	o := f.options("500")
	rs := []clientResult{
		runClient(context.Background(), o, 1, 600*time.Millisecond, modeNormal),
		runClient(context.Background(), o, 2, 600*time.Millisecond, modeNormal),
	}
	l := aggregateLatency(rs, o)
	if l.Relative.Count < 10 || l.Absolute.Count != l.Relative.Count {
		t.Fatalf("too few samples: %+v", l)
	}
	if !l.ClockShared || l.Absolute.P50Ms < 5 {
		t.Fatalf("loopback: absolute delay must be valid and >= 5 ms: %+v", l)
	}
	l = aggregateLatency(rs, options{host: "192.168.1.110"})
	if l.ClockShared {
		t.Fatal("another host: clocks are not shared")
	}
}

func TestChecks(t *testing.T) {
	cs := buildChecks("L1", summary{TotalGaps: 0}, nil, nil)
	if len(cs) != 1 || !cs[0].Pass {
		t.Fatalf("L1 checks: %+v", cs)
	}
	cs = buildChecks("L1", summary{TotalGaps: 2}, nil, nil)
	if cs[0].Pass {
		t.Fatal("seq gaps must fail")
	}
	l3 := &l3Result{Attempts: 2, Rejected4429: 1, Pass: false}
	if allPass(buildChecks("L3", summary{}, l3, nil)) {
		t.Fatal("L3 with one accepted extra must fail")
	}
	fl := &flapResult{Reconnects: 3, Pass: true, SlotsMeasured: true}
	if !allPass(buildChecks("L6", summary{}, nil, fl)) {
		t.Fatal("L6 pass")
	}
}

func (f *fakeLive) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.active)
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("condition not met in 5 s")
		}
		time.Sleep(10 * time.Millisecond)
	}
}
