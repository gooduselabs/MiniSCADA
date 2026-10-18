package main

import (
	"context"
	"testing"
	"time"
)

// fastHeartbeat shortens the heartbeat of the sessions for a fake server with a short idle timeout.
func fastHeartbeat(t *testing.T, d time.Duration) {
	t.Helper()
	old := sessionHeartbeat
	sessionHeartbeat = d
	t.Cleanup(func() { sessionHeartbeat = old })
}

// L3 second part (FR-038): with every slot held and the extra client refused with 4429, client 1
// leaves (clean close, then silent) and a new client must get in within the limit.
func TestReentryCloseAndSilent(t *testing.T) {
	fastHeartbeat(t, 50*time.Millisecond)
	f := newFakeLive(t, 2)
	f.idle = 400 * time.Millisecond
	o := f.options("500")
	r := reentryTest(context.Background(), o, reentryConfig{Clients: 2, Rounds: 2, Limit: 35 * time.Second,
		Retry: 50 * time.Millisecond})
	if r.Error != "" || !r.Pass || len(r.Events) != 4 {
		t.Fatalf("bad reentry: %+v", r)
	}
	for _, m := range []reentryMode{r.Close, r.Silent} {
		if m.Rounds != 2 || m.Reentered != 2 || m.Failed != 0 || m.OverLimit != 0 || !m.Pass || m.ReentryMs.Count != 2 {
			t.Fatalf("bad mode result: %+v", m)
		}
	}
	for _, ev := range r.Events {
		if ev.ExtraCode != 4429 || !ev.Reentered || ev.Attempts < 1 {
			t.Fatalf("bad round: %+v", ev)
		}
	}
	t.Logf("close %+v, silent %+v", r.Close.ReentryMs, r.Silent.ReentryMs)
	// A clean close frees the slot at once; a silent client 1 holds it until the idle timeout.
	if r.Close.ReentryMs.MaxMs >= 300 {
		t.Fatalf("clean close took %v ms", r.Close.ReentryMs.MaxMs)
	}
	if r.Silent.ReentryMs.P50Ms < 300 || r.Silent.ReentryMs.MaxMs > 5000 {
		t.Fatalf("silent reentry %+v, want about the 400 ms idle timeout", r.Silent.ReentryMs)
	}
	waitFor(t, func() bool { return f.count() == 0 })
}

// A silent client 1 still holds the slot when the limit passes: the silent mode fails, the clean
// close still passes.
func TestReentryOverLimit(t *testing.T) {
	fastHeartbeat(t, 50*time.Millisecond)
	f := newFakeLive(t, 1)
	f.idle = 600 * time.Millisecond
	o := f.options("500")
	r := reentryTest(context.Background(), o, reentryConfig{Clients: 1, Rounds: 1, Limit: 200 * time.Millisecond,
		GiveUp: 300 * time.Millisecond, Retry: 50 * time.Millisecond})
	if r.Pass || !r.Close.Pass || r.Silent.Pass {
		t.Fatalf("silent over the limit must fail: %+v", r)
	}
	if r.Silent.Failed+r.Silent.OverLimit == 0 {
		t.Fatalf("silent mode must count a failure: %+v", r.Silent)
	}
}

// The server is not full (the extra client gets in): the round is invalid and fails.
func TestReentryNotFull(t *testing.T) {
	fastHeartbeat(t, 50*time.Millisecond)
	f := newFakeLive(t, 3)
	f.idle = 400 * time.Millisecond
	o := f.options("500")
	r := reentryTest(context.Background(), o, reentryConfig{Clients: 2, Rounds: 1, Limit: 35 * time.Second,
		Retry: 50 * time.Millisecond})
	if r.Pass || r.Close.Pass || len(r.Events) == 0 || r.Events[0].ExtraCode != 0 || r.Events[0].Error == "" {
		t.Fatalf("free slot must fail: %+v", r)
	}
}

// -reentry adds its checks to the summary and takes "newClientAfterRelease35s" off notMeasured.
func TestReentryChecks(t *testing.T) {
	ok := &reentryResult{Close: reentryMode{Rounds: 3, Reentered: 3, Pass: true},
		Silent: reentryMode{Rounds: 3, Reentered: 3, Pass: true}, Pass: true}
	checks, nm := withReentry(buildChecks("L3", summary{}, &l3Result{Attempts: 1, Rejected4429: 1, Pass: true}, nil),
		notMeasured("L3"), ok)
	if len(checks) != 3 || !allPass(checks) {
		t.Fatalf("checks: %+v", checks)
	}
	for _, k := range nm {
		if k == "newClientAfterRelease35s" {
			t.Fatalf("still not measured: %v", nm)
		}
	}
	bad := *ok
	bad.Silent.Pass, bad.Pass = false, false
	checks, _ = withReentry(nil, nil, &bad)
	if allPass(checks) {
		t.Fatal("a failed silent mode must fail the summary")
	}
	checks, nm = withReentry(nil, notMeasured("L3"), nil)
	if len(checks) != 0 || len(nm) != 1 {
		t.Fatalf("no -reentry: %+v %v", checks, nm)
	}
}
