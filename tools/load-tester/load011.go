// Feature 011 (T071, FR-038; specs/011-pilot-hardening/contracts/test-protocols.md §1): the L1, L2,
// L3 and L6 scenarios of the load protocol. L4 (F5 storm) and L5 (SVG FPS) are browser scenarios in
// tests/web-it/f5-storm.mjs and tests/web-it/svg-load.mjs; L7 (logic) and L8 (TLS source limit) are
// not covered by this tool.
//
//	load-tester -host H -tags 500  -clients 10 -extra 1 -duration 14400 -latency -out l1.json   # L1
//	  ... add -alternate -fingerprint <sha256> for odd clients over wss://H:8443 (tls.go)          # L1 8080/8443
//	load-tester -host H -tags 1000 -clients 10 -extra 0 -duration 3600 -latency -out l2.json    # L2
//	load-tester -host H -tags 500  -clients 10 -extra 1 -extra-attempts 50 -duration 120 -reentry 5 -out l3.json
//	load-tester -host H -tags 500  -clients 10 -flap 50 -out l6.json                            # tool-side close
//	load-tester -host H -tags 500  -clients 10 -flap 50 -flap-mode external -out l6.json        # ip link / switch / docker network
//
// JSON result (docs/reports/011-load.md does not exist yet; this is the shape it will cite). The
// keys of the older runs (scenarioId, summary, clientResults, server, startedAt, finishedAt, host,
// tags, build) stay as they were; feature 011 adds:
//
//	{
//	  "format": "mat-load-011", "formatVersion": 1,
//	  "scenario": "L1" | "L2" | "L3" | "L6" | "custom",
//	  "config":  { "tags": "500", "tagCount": 500, "clients": 10, "extra": 1, "extraAttempts": 0,
//	               "flap": 0, "flapMode": "", "reentry": 0, "durationS": 14400, "latency": true },
//	  "latency": { "method": "...", "clockShared": false,
//	               "relative": {"count","p50Ms","p95Ms","maxMs"}, "absolute": {...}, "note": "..." },
//	  "l3":      { "attempts": 50, "closeCodes": [4429, ...], "rejected4429": 50, "accepted": 0,
//	               "errors": 0, "pass": true },
//	  "reentry": { "method": "...", "clients": 10, "rounds": 5, "limitMs": 35000,
//	               "close":  { "rounds": 5, "reentered": 5, "failed": 0, "overLimit": 0, "reentryMs": {...}, "pass": true },
//	               "silent": { ... }, "events": [ { "mode", "round", "extraCloseCode", "reentryMs", "attempts", ... } ],
//	               "pass": true },     (-reentry N, reentry.go)
//	  "flap":    { "mode": "close", "clients": 10, "cycles": 50, "expected": 500, "reconnects": 500,
//	               "failed": 0, "overLimit": 0, "limitMs": 35000, "reconnectMs": {...},
//	               "slotsOpenAfter": 0, "slotsLeaked": 0, "slotsMeasured": true, "events": [...], "pass": true },
//	  "checks":  [ { "name": "...", "pass": true, "value": ..., "limit": "..." } ],
//	  "notMeasured": [ "cpuAvgPct", "cpuPeakPct", "rssMaxMB", ... ],
//	  "pass": true
//	}
//
// "notMeasured" lists what the scenario's threshold needs but this tool cannot measure: CPU and RSS
// come from deployment/device/mat-sample.sh (or tests/web-it/proc-sample.mjs in Docker), never from
// here. A value that was not measured is listed there, never reported as passing.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
)

// validateTags accepts the -tags values: sim (500 SIM.*, older runs), demo, bench, 500 or 1000.
func validateTags(spec string) error {
	switch spec {
	case "sim", "demo", "bench", "500", "1000":
		return nil
	}
	return fmt.Errorf("-tags %q: use 500, 1000, sim, demo or bench", spec)
}

// simTags returns SIM.T0001..SIM.T<n>: the Tags of projects/bench-1000 and projects/soak-standard
// (tools/gen-bench-projects.mjs).
func simTags(n int) []string {
	t := make([]string, 0, n)
	for i := 1; i <= n; i++ {
		t = append(t, fmt.Sprintf("SIM.T%04d", i))
	}
	return t
}

type latencyStats struct {
	Count int     `json:"count"`
	P50Ms float64 `json:"p50Ms"`
	P95Ms float64 `json:"p95Ms"`
	MaxMs float64 `json:"maxMs"`
}

func newLatencyStats(v []float64) latencyStats {
	return latencyStats{Count: len(v), P50Ms: percentile(v, 50), P95Ms: percentile(v, 95), MaxMs: percentile(v, 100)}
}

type loadConfig struct {
	Tags          string `json:"tags"`
	TagCount      int    `json:"tagCount"`
	Clients       int    `json:"clients"`
	Extra         int    `json:"extra"`
	ExtraAttempts int    `json:"extraAttempts"`
	Flap          int    `json:"flap"`
	Reentry       int    `json:"reentry"`
	FlapMode      string `json:"flapMode,omitempty"`
	DurationS     int    `json:"durationS"`
	Latency       bool   `json:"latency"`
}

// scenarioCode maps the flags to the scenario of test-protocols §1 ("custom" for anything else, e.g.
// the older -tags sim runs, which keep their old exit code).
func scenarioCode(c loadConfig) string {
	if c.Tags != "500" && c.Tags != "1000" {
		return "custom"
	}
	switch {
	case c.Flap > 0:
		return "L6"
	case c.Extra > 0 && c.ExtraAttempts > 0:
		return "L3"
	case c.Tags == "1000":
		return "L2"
	default:
		return "L1"
	}
}

// notMeasured lists what the threshold of a scenario needs but this tool does not measure.
func notMeasured(scenario string) []string {
	switch scenario {
	case "L1", "L2":
		// L1 asks for 8080 and 8443 alternately: measured only with -alternate (tls.go, withAlternation).
		return []string{"cpuAvgPct", "cpuPeakPct", "rssMaxMB", "wss8443Alternation"}
	case "L3":
		return []string{"newClientAfterRelease35s"}
	case "L6":
		return []string{"cpuAvgPct", "rssMaxMB"}
	}
	return []string{}
}

// refusedError: the server closed the connection before the snapshot (4429 when full).
type refusedError struct{ code int }

func (e refusedError) Error() string { return fmt.Sprintf("closed with %d before snapshot", e.code) }

func closeCodeOf(err error) int {
	var r refusedError
	if errors.As(err, &r) {
		return r.code
	}
	return -1
}

// session is one live connection that has received its snapshot; a goroutine keeps reading and
// heartbeating until close() or until the connection drops (dropped is closed then).
type session struct {
	c       *websocket.Conn
	cancel  context.CancelFunc
	dropped chan struct{}
	// silence(): the session stops heartbeating and reading (so it answers no ping either) but
	// keeps the TCP connection open, like a client whose cable was pulled on the far side.
	mute     atomic.Bool
	silenced chan struct{}
}

// sessionHeartbeat: how often a session sends {"type":"heartbeat"} (the runtime drops a session
// silent for 15 s with 4408). A variable so the tests can use a short one.
var sessionHeartbeat = 5 * time.Second

// openSession dials, waits for hello, subscribes and waits for the snapshot (at most timeout).
// It returns the time from the dial to the snapshot in ms. dropAfter > 0 treats a silence that
// long as a drop (a network cut sends nothing, not even an error).
func openSession(ctx context.Context, o options, timeout time.Duration) (*session, int64, error) {
	return openSessionIdle(ctx, o, timeout, 0)
}

func openSessionIdle(ctx context.Context, o options, timeout, dropAfter time.Duration) (*session, int64, error) {
	start := time.Now()
	c, err := dial(ctx, o)
	if err != nil {
		return nil, 0, err
	}
	hctx, hcancel := context.WithTimeout(ctx, timeout)
	defer hcancel()
	for {
		_, data, err := c.Read(hctx)
		if err != nil {
			c.CloseNow()
			if st := websocket.CloseStatus(err); st != -1 {
				return nil, 0, refusedError{int(st)}
			}
			return nil, 0, err
		}
		var m msg
		if json.Unmarshal(data, &m) != nil {
			continue
		}
		if m.Type == "hello" {
			if err := c.Write(hctx, websocket.MessageText, subscribeMsg(o, "r1")); err != nil {
				c.CloseNow()
				return nil, 0, err
			}
		}
		if m.Type == "snapshot" {
			break
		}
	}
	ms := time.Since(start).Milliseconds()
	sctx, cancel := context.WithCancel(ctx)
	s := &session{c: c, cancel: cancel, dropped: make(chan struct{}), silenced: make(chan struct{})}
	go s.run(sctx, dropAfter)
	return s, ms, nil
}

func (s *session) run(ctx context.Context, dropAfter time.Duration) {
	defer close(s.dropped)
	go func() {
		t := time.NewTicker(sessionHeartbeat)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				if s.mute.Load() {
					return
				}
				wctx, cancel := context.WithTimeout(ctx, 3*time.Second)
				_ = s.c.Write(wctx, websocket.MessageText, []byte(`{"type":"heartbeat","ts":0}`))
				cancel()
			}
		}
	}()
	for {
		rctx, cancel := ctx, context.CancelFunc(func() {})
		if dropAfter > 0 {
			rctx, cancel = context.WithTimeout(ctx, dropAfter)
		}
		_, _, err := s.c.Read(rctx)
		cancel()
		if err != nil {
			s.c.CloseNow()
			return
		}
		if s.mute.Load() {
			// Stop reading without closing (cancelling a Read would close the connection):
			// nothing is read, no ping answered, until close().
			close(s.silenced)
			<-ctx.Done()
			s.c.CloseNow()
			return
		}
	}
}

// silence makes the session go silent (see session.mute) and returns when its reader has stopped:
// the reader notices at its next message (the runtime sends deltas and heartbeats), at most wait.
func (s *session) silence(wait time.Duration) (time.Time, error) {
	s.mute.Store(true)
	select {
	case <-s.silenced:
		return time.Now(), nil
	case <-s.dropped:
		return time.Time{}, errors.New("connection dropped before it went silent")
	case <-time.After(wait):
		return time.Time{}, fmt.Errorf("no message from the server in %s: reader not stopped", wait)
	}
}

// closeClean ends the session with a close frame (1000) and waits for the close handshake.
func (s *session) closeClean() {
	_ = s.c.Close(websocket.StatusNormalClosure, "reentry")
	s.cancel()
	<-s.dropped
}

// close drops the connection without a close frame (abrupt, like a cable pull from this side).
func (s *session) close() {
	s.cancel()
	s.c.CloseNow()
	<-s.dropped
}

// reconnect retries openSession (4429 while the server still holds the old slot, dial errors while
// the network is down) until a snapshot arrives or giveUp passes. Returns the elapsed ms.
func reconnect(ctx context.Context, o options, giveUp, dropAfter time.Duration) (*session, int64, error) {
	start := time.Now()
	for {
		s, _, err := openSessionIdle(ctx, o, 10*time.Second, dropAfter)
		if err == nil {
			return s, time.Since(start).Milliseconds(), nil
		}
		if time.Since(start) > giveUp || ctx.Err() != nil {
			return nil, time.Since(start).Milliseconds(), err
		}
		time.Sleep(250 * time.Millisecond)
	}
}

type l3Result struct {
	Attempts     int   `json:"attempts"`
	CloseCodes   []int `json:"closeCodes"` // -1: no close code (dial or read error)
	Rejected4429 int   `json:"rejected4429"`
	Accepted     int   `json:"accepted"`
	Errors       int   `json:"errors"`
	Pass         bool  `json:"pass"`
}

// extraAttempts: with the regular clients holding every slot, n successive extra clients must all
// be refused with close 4429 (L3: 100 % of 50 attempts). An accepted extra client is closed at once.
func extraAttempts(ctx context.Context, o options, n int) l3Result {
	r := l3Result{Attempts: n, CloseCodes: []int{}}
	for i := 0; i < n; i++ {
		s, _, err := openSession(ctx, o, 5*time.Second)
		switch {
		case err == nil:
			r.Accepted++
			r.CloseCodes = append(r.CloseCodes, 0)
			s.close()
		default:
			code := closeCodeOf(err)
			r.CloseCodes = append(r.CloseCodes, code)
			if code == closeMaxClients {
				r.Rejected4429++
			} else {
				r.Errors++
			}
		}
		time.Sleep(200 * time.Millisecond)
	}
	r.Pass = n > 0 && r.Rejected4429 == n
	return r
}

type flapConfig struct {
	Clients int
	Cycles  int
	Mode    string        // close: this tool drops the sockets; external: someone cuts the network
	Hold    time.Duration // close mode: time connected before each drop
	Settle  time.Duration // after the last cycle, before reading system/info (> 15 s heartbeat timeout)
	Limit   time.Duration // reconnect threshold (35 s)
	Timeout time.Duration // external mode: give up waiting for the cuts after this long
	// External mode: silence that counts as a drop (a cut sends nothing). 0 = 5 s.
	DropAfter time.Duration
}

type flapEvent struct {
	Client       int    `json:"client"`
	Cycle        int    `json:"cycle"`
	DroppedAt    string `json:"droppedAt"`
	ReconnectMs  int64  `json:"reconnectMs"`
	Reconnected  bool   `json:"reconnected"`
	CloseCode    int    `json:"lastCloseCode,omitempty"`
	ReconnectErr string `json:"error,omitempty"`
}

type flapResult struct {
	Mode           string       `json:"mode"`
	Clients        int          `json:"clients"`
	Cycles         int          `json:"cycles"`
	Expected       int          `json:"expected"`
	Reconnects     int          `json:"reconnects"`
	Failed         int          `json:"failed"`
	OverLimit      int          `json:"overLimit"`
	LimitMs        int64        `json:"limitMs"`
	ReconnectMs    latencyStats `json:"reconnectMs"`
	SlotsOpenAfter int          `json:"slotsOpenAfter"`
	SlotsLeaked    int          `json:"slotsLeaked"` // -1 when not measured
	SlotsMeasured  bool         `json:"slotsMeasured"`
	Events         []flapEvent  `json:"events"`
	Error          string       `json:"error,omitempty"`
	Pass           bool         `json:"pass"`
	// External mode: reconnectMs runs from the drop this tool noticed to the snapshot, so it
	// includes the cut itself; compare droppedAt with the log of the cut.
	Note string `json:"note,omitempty"`
}

// slotsOpen reads the open live sessions from /api/v1/system/info ("clients"); -1, false when the
// field is missing (not measured, never 0).
func slotsOpen(info map[string]any) (int, bool) {
	if v, ok := info["clients"].(float64); ok {
		return int(v), true
	}
	return -1, false
}

// flapTest (L6): Clients sessions, Cycles drops each, every reconnect timed; after the last cycle
// all sessions close and, after Settle, system/info must report 0 open sessions (no leaked slot).
// Run it alone: any other client of the server counts as an open slot.
func flapTest(ctx context.Context, o options, cfg flapConfig) flapResult {
	r := flapResult{Mode: cfg.Mode, Clients: cfg.Clients, Cycles: cfg.Cycles, Expected: cfg.Clients * cfg.Cycles,
		LimitMs: cfg.Limit.Milliseconds(), SlotsLeaked: -1, Events: []flapEvent{}}
	if cfg.DropAfter == 0 {
		cfg.DropAfter = 5 * time.Second
	}
	giveUp := 2 * cfg.Limit
	idle := time.Duration(0)
	if cfg.Mode == "external" {
		idle = cfg.DropAfter
	}
	sessions := make([]*session, cfg.Clients)
	for i := range sessions {
		s, _, err := reconnect(ctx, o, giveUp, idle)
		if err != nil {
			r.Error = fmt.Sprintf("client %d: initial connect: %v", i+1, err)
			for _, s := range sessions[:i] {
				s.close()
			}
			return r
		}
		sessions[i] = s
	}
	var mu sync.Mutex
	var times []float64
	record := func(ev flapEvent, s *session, i int) {
		mu.Lock()
		defer mu.Unlock()
		r.Events = append(r.Events, ev)
		if !ev.Reconnected {
			r.Failed++
			return
		}
		sessions[i] = s
		r.Reconnects++
		times = append(times, float64(ev.ReconnectMs))
		if ev.ReconnectMs > cfg.Limit.Milliseconds() {
			r.OverLimit++
		}
	}
	redial := func(i, cycle int, droppedAt time.Time) bool {
		s, ms, err := reconnect(ctx, o, giveUp, idle)
		ev := flapEvent{Client: i + 1, Cycle: cycle, DroppedAt: droppedAt.UTC().Format(time.RFC3339Nano),
			ReconnectMs: ms, Reconnected: err == nil}
		if err != nil {
			ev.CloseCode, ev.ReconnectErr = closeCodeOf(err), err.Error()
		}
		record(ev, s, i)
		return err == nil
	}

	if cfg.Mode == "external" {
		r.Note = "reconnectMs: from the drop this tool noticed to the snapshot, the cut itself included"
		deadline := time.Now().Add(cfg.Timeout)
		var wg sync.WaitGroup
		for i := range sessions {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				for cycle := 1; cycle <= cfg.Cycles; cycle++ {
					mu.Lock()
					s := sessions[i]
					mu.Unlock()
					if s == nil {
						return
					}
					select {
					case <-s.dropped:
					case <-time.After(time.Until(deadline)):
						return
					}
					if !redial(i, cycle, time.Now()) {
						mu.Lock()
						sessions[i] = nil
						mu.Unlock()
						return
					}
				}
			}(i)
		}
		wg.Wait()
	} else {
		for cycle := 1; cycle <= cfg.Cycles; cycle++ {
			time.Sleep(cfg.Hold)
			now := time.Now()
			var wg sync.WaitGroup
			for i, s := range sessions {
				if s == nil {
					continue
				}
				s.close()
				sessions[i] = nil // set again by record() on success
				wg.Add(1)
				go func(i int) { defer wg.Done(); redial(i, cycle, now) }(i)
			}
			wg.Wait()
		}
	}
	for _, s := range sessions {
		if s != nil {
			s.close()
		}
	}
	time.Sleep(cfg.Settle)
	if n, ok := slotsOpen(systemInfo(o)); ok {
		r.SlotsOpenAfter, r.SlotsLeaked, r.SlotsMeasured = n, n, true
	}
	r.ReconnectMs = newLatencyStats(times)
	r.Pass = r.Reconnects == r.Expected && r.Failed == 0 && r.OverLimit == 0 && r.SlotsMeasured && r.SlotsLeaked == 0
	return r
}

type latencyDoc struct {
	Method      string       `json:"method"`
	ClockShared bool         `json:"clockShared"`
	Relative    latencyStats `json:"relative"`
	Absolute    latencyStats `json:"absolute"`
	Note        string       `json:"note,omitempty"`
}

func isLoopback(host string) bool {
	return host == "127.0.0.1" || host == "localhost" || host == "::1"
}

// aggregateLatency (--latency): the delay of every delta of the accepted normal clients.
// relative = receive time - delta ts - the smallest such difference of that client: it removes the
// unknown clock offset between the machines and also the minimum network delay, so it is a lower
// bound of the end-to-end delay. absolute = receive wall clock - delta ts: only meaningful when this
// tool and the runtime share a clock (loopback, Docker on the same host); left empty otherwise.
func aggregateLatency(rs []clientResult, o options) latencyDoc {
	var rel, abs []float64
	for _, r := range rs {
		if r.Mode != "normal" || !r.Accepted {
			continue
		}
		rel = append(rel, r.lagSamples...)
		abs = append(abs, r.absSamples...)
	}
	d := latencyDoc{
		Method:      "delta ts (server) -> receive time (client); relative removes the clock offset and the minimum delay",
		ClockShared: isLoopback(o.host),
		Relative:    newLatencyStats(rel),
	}
	if d.ClockShared {
		d.Absolute = newLatencyStats(abs)
	} else {
		d.Note = "absolute not measured: the runtime and this tool do not share a clock"
	}
	return d
}

type checkResult struct {
	Name  string `json:"name"`
	Pass  bool   `json:"pass"`
	Value any    `json:"value"`
	Limit string `json:"limit"`
}

// buildChecks: the thresholds of test-protocols §1 that this tool can judge on its own.
func buildChecks(scenario string, s summary, l3 *l3Result, fl *flapResult) []checkResult {
	var cs []checkResult
	switch scenario {
	case "L1", "L2":
		cs = append(cs, checkResult{Name: "0 sequence lost (normal clients)", Pass: s.TotalGaps == 0,
			Value: s.TotalGaps, Limit: "0"})
		if s.Rejected > 0 {
			cs = append(cs, checkResult{Name: "extra clients refused with close 4429",
				Pass: s.ExtraRejectedCorrectly, Value: s.Rejected, Limit: "4429"})
		}
	case "L3":
		if l3 != nil {
			cs = append(cs, checkResult{Name: "every extra client refused with close 4429", Pass: l3.Pass,
				Value: fmt.Sprintf("%d/%d", l3.Rejected4429, l3.Attempts), Limit: "100 %"})
		}
	case "L6":
		if fl != nil {
			cs = append(cs,
				checkResult{Name: "every reconnect within the limit",
					Pass:  fl.Reconnects > 0 && fl.Failed == 0 && fl.OverLimit == 0 && (fl.Expected == 0 || fl.Reconnects == fl.Expected),
					Value: fmt.Sprintf("%d ok, %d failed, %d over, max %.0f ms", fl.Reconnects, fl.Failed, fl.OverLimit, fl.ReconnectMs.MaxMs),
					Limit: "100 % <= 35 s"},
				checkResult{Name: "0 slot leaked", Pass: fl.SlotsMeasured && fl.SlotsLeaked == 0,
					Value: fl.SlotsLeaked, Limit: "0"})
		}
	}
	return cs
}

func allPass(cs []checkResult) bool {
	for _, c := range cs {
		if !c.Pass {
			return false
		}
	}
	return len(cs) > 0
}
