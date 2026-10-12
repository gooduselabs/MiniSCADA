package main

import (
	"testing"
	"time"
)

// T-048: the MAJOR of hello.protocolVersion is read and checked.
func TestProtocolMajor(t *testing.T) {
	for v, want := range map[string]int{"1.0.0": 1, "1.4.2": 1, "2.0.0": 2, "10.1.0": 10} {
		if got, ok := protocolMajor(v); !ok || got != want {
			t.Fatalf("protocolMajor(%q) = %d, %v; want %d", v, got, ok, want)
		}
	}
	for _, v := range []string{"", "x.1.0", "1", ".1.0"} {
		if _, ok := protocolMajor(v); ok {
			t.Fatalf("protocolMajor(%q) must fail", v)
		}
	}
	s := summarize([]clientResult{{Mode: "normal", Accepted: true},
		{Mode: "normal", ProtocolVersion: "2.0.0", ProtocolMismatch: true}})
	if s.ProtocolMismatch != 1 {
		t.Fatalf("protocolMismatch = %d, want 1", s.ProtocolMismatch)
	}
}

// T-056: a slow client records when the server ended its connection (first failed write or read),
// without having to read the payload.
func TestFirstFailureKeepsTheFirstTime(t *testing.T) {
	var f firstFailure
	if f.ms() != 0 {
		t.Fatal("no failure -> 0")
	}
	f.mark(10500 * time.Millisecond)
	f.mark(12000 * time.Millisecond)
	if f.ms() != 10500 {
		t.Fatalf("first failure = %d ms, want 10500", f.ms())
	}
	s := summarize([]clientResult{{Mode: "slow", TerminatedAfterMs: 10500},
		{Mode: "slow"}, {Mode: "normal", Accepted: true}})
	if s.SlowTerminated != 1 || s.MaxSlowTerminatedAfterMs != 10500 {
		t.Fatalf("bad slow summary: %+v", s)
	}
}

// R-15: the runtime build that answered, read from system/info before the clients start.
func TestBuildInfo(t *testing.T) {
	b := buildInfo(map[string]any{"runtimeVersion": "0.3.0", "protocolVersion": "1.0.0",
		"uptimeS": 120.0, "clients": 3.0})
	if b["runtimeVersion"] != "0.3.0" || b["protocolVersion"] != "1.0.0" || b["uptimeSAtStart"] != 120.0 {
		t.Fatalf("bad build info: %v", b)
	}
	if _, ok := b["clients"]; ok {
		t.Fatal("only the build fields")
	}
	if buildInfo(nil) != nil {
		t.Fatal("no system/info -> nil")
	}
}

func TestPercentile(t *testing.T) {
	v := []float64{10, 20, 30, 40, 50, 60, 70, 80, 90, 100}
	if got := percentile(v, 95); got != 100 {
		t.Fatalf("p95 = %v, want 100", got)
	}
	if got := percentile(v, 50); got != 50 {
		t.Fatalf("p50 = %v, want 50", got)
	}
	if got := percentile(nil, 95); got != 0 {
		t.Fatalf("empty = %v, want 0", got)
	}
}

func TestGapCounter(t *testing.T) {
	var g gapCounter
	for _, s := range []uint64{5, 6, 7, 10, 11} { // 8,9 missing -> one gap
		g.observe(s)
	}
	if g.gaps != 1 {
		t.Fatalf("gaps = %d, want 1", g.gaps)
	}
}

// Feature 003 (SC-006): the longest pause between two deltas while the historian cleans up.
func TestMaxDeltaGap(t *testing.T) {
	r := finish(clientResult{Mode: "normal", Accepted: true}, gapCounter{}, []float64{250, 260, 1200, 250}, nil)
	if r.MaxDeltaGapMs != 1200 {
		t.Fatalf("maxDeltaGapMs = %v, want 1200", r.MaxDeltaGapMs)
	}
	s := summarize([]clientResult{r, {Mode: "normal", Accepted: true, MaxDeltaGapMs: 300},
		{Mode: "slow", MaxDeltaGapMs: 9000}})
	if s.MaxDeltaGapMs != 1200 {
		t.Fatalf("summary maxDeltaGapMs = %v, want 1200 (slow clients excluded)", s.MaxDeltaGapMs)
	}
}

func TestSummarize(t *testing.T) {
	rs := []clientResult{
		{Mode: "normal", Accepted: true}, {Mode: "normal", Accepted: true},
		{Mode: "normal", Accepted: false, CloseCode: 4429},
	}
	s := summarize(rs)
	if s.Accepted != 2 || s.Rejected != 1 || !s.ExtraRejectedCorrectly {
		t.Fatalf("bad summary: %+v", s)
	}
	rs[2].CloseCode = 1000
	if summarize(rs).ExtraRejectedCorrectly {
		t.Fatal("close code 1000 must not count as correct rejection")
	}
}

func TestClockOffsetLag(t *testing.T) {
	var c clockOffset
	if c.lag(100, 0) != 0 {
		t.Fatal("no observation -> 0")
	}
	c.observe(1050, 1000) // fastest: 50 ms (offset + min delay)
	c.observe(1300, 1200) // 100 ms
	if got := c.lag(1300, 1200); got != 50 {
		t.Fatalf("lag = %v, want 50", got)
	}
	if got := c.lag(1040, 1000); got != 0 {
		t.Fatalf("lag below min clamps to 0, got %v", got)
	}
}

func TestSummarizeSlowClientsSeparately(t *testing.T) {
	rs := []clientResult{
		{Mode: "normal", Accepted: true, P95LatencyMs: 260, LagP95Ms: 20},
		{Mode: "normal", Accepted: true, SeqGaps: 1, P95LatencyMs: 300, LagP95Ms: 35},
		{Mode: "slow", Accepted: true, SeqGaps: 9, ResyncRequired: true, CloseCode: 4409},
	}
	s := summarize(rs)
	if s.TotalGaps != 1 || s.SlowClients != 1 || s.SlowResyncRequired != 1 || s.SlowClosed4409 != 1 {
		t.Fatalf("bad summary: %+v", s)
	}
	if s.MaxP95IntervalMs != 300 || s.MaxLagP95Ms != 35 || s.Accepted != 2 {
		t.Fatalf("bad maxima: %+v", s)
	}
}
