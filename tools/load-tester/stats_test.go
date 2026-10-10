package main

import "testing"

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
