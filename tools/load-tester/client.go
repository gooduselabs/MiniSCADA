package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
)

type clientMode int

const (
	modeNormal clientMode = iota
	modeSilent            // never sends anything: the server must drop it after 15 s (4408)
	modeSlow              // keeps sending heartbeats but stops reading after the snapshot
)

type msg struct {
	Type            string `json:"type"`
	Code            string `json:"code"`
	Sequence        uint64 `json:"sequence"`
	SubscriptionID  string `json:"subscriptionId"`
	TS              int64  `json:"ts"`
	ProtocolVersion string `json:"protocolVersion"`
}

func dial(ctx context.Context, o options) (*websocket.Conn, error) {
	dctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	var opts *websocket.DialOptions
	if o.origin != "" {
		opts = &websocket.DialOptions{HTTPHeader: http.Header{"Origin": []string{o.origin}}}
	}
	c, _, err := websocket.Dial(dctx, o.wsURL(), opts)
	if err != nil {
		return nil, err
	}
	c.SetReadLimit(1 << 20)
	return c, nil
}

func subscribeMsg(o options, requestID string) []byte {
	if o.proto == 0 {
		return []byte(`{"type":"subscribe","requestId":"sub-001","tags":"all","mode":"delta"}`)
	}
	b, _ := json.Marshal(map[string]any{
		"type": "subscribe", "requestId": requestID, "tags": o.tagList(), "mode": "delta",
	})
	return b
}

func runClient(ctx context.Context, o options, idx int, hold time.Duration, mode clientMode) clientResult {
	res := clientResult{ClientIndex: idx, Mode: [...]string{"normal", "silent", "slow"}[mode]}
	c, err := dial(ctx, o)
	if err != nil {
		res.CloseCode = -1
		res.Error = err.Error()
		return res
	}
	defer c.CloseNow()

	rctx, stop := context.WithTimeout(ctx, hold)
	defer stop()

	var gaps gapCounter
	var intervals, lags []float64
	var lastDelta time.Time
	var offset clockOffset
	subscribed := false
	start := time.Now()
	// Receive times on a monotonic base: a wall-clock step on this machine (w32time) must not
	// distort the lag measurement. Server timestamps remain wall clock (device side).
	startWallMs := start.UnixMilli()
	monoMs := func(t time.Time) int64 { return startWallMs + t.Sub(start).Milliseconds() }
	var hbErrors atomic.Int64
	var hbLastErr atomic.Value
	// First failed write or read. A slow client never reads, so its first failed heartbeat write
	// tells when the server dropped it: an upper bound, within one or two heartbeat periods (the
	// write right after the server's shutdown may still be accepted by the kernel).
	var term firstFailure
	done := func() clientResult {
		res.HeartbeatErrors = int(hbErrors.Load())
		if e, ok := hbLastErr.Load().(string); ok {
			res.HeartbeatError = e
		}
		if mode == modeSlow {
			res.TerminatedAfterMs = term.ms()
		}
		return finish(res, gaps, intervals, lags)
	}

	// Heartbeat so the server keeps the slot; the slow client heartbeats more often so that the
	// server's ping/pong idle check never fires while it is not reading.
	period := 5 * time.Second
	if mode == modeSlow {
		period = 2 * time.Second
	}
	go func() {
		t := time.NewTicker(period)
		defer t.Stop()
		for {
			select {
			case <-rctx.Done():
				return
			case <-t.C:
				if mode != modeSilent {
					wctx, wcancel := context.WithTimeout(rctx, 3*time.Second)
					if err := c.Write(wctx, websocket.MessageText, []byte(`{"type":"heartbeat","ts":0}`)); err != nil {
						if rctx.Err() == nil {
							term.mark(time.Since(start))
						}
						hbErrors.Add(1)
						hbLastErr.Store(err.Error())
					}
					wcancel()
				}
			}
		}
	}()

	for {
		_, data, err := c.Read(rctx)
		if err != nil {
			if rctx.Err() == nil {
				term.mark(time.Since(start))
			}
			if st := websocket.CloseStatus(err); st != -1 {
				res.CloseCode = int(st)
				res.ClosedAfterMs = time.Since(start).Milliseconds()
			}
			break
		}
		now := time.Now()
		var m msg
		if json.Unmarshal(data, &m) != nil {
			continue
		}
		if m.TS > 0 {
			offset.observe(monoMs(now), m.TS)
		}
		switch m.Type {
		case "error":
			res.Accepted = false
			res.ErrorCode = m.Code
		case "hello":
			res.ProtocolVersion = m.ProtocolVersion
			if o.proto == 1 {
				// contracts/live-ws.md rule 8: another MAJOR is incompatible (T-048).
				if major, ok := protocolMajor(m.ProtocolVersion); !ok || major != 1 {
					res.ProtocolMismatch = true
					res.Error = fmt.Sprintf("protocolVersion %q: MAJOR is not 1", m.ProtocolVersion)
					c.Close(websocket.StatusNormalClosure, "incompatible protocol")
					return done()
				}
			}
			res.Accepted = true
			if !subscribed {
				subscribed = true
				_ = c.Write(rctx, websocket.MessageText, subscribeMsg(o, "r1"))
			}
		case "snapshot":
			gaps = gapCounter{} // resync: restart continuity tracking
			gaps.observe(m.Sequence)
			res.Snapshots++
			if mode == modeSlow {
				// Stop reading: data piles up in the kernel buffers, then in the server queue.
				<-rctx.Done()
				res.SlowDrained = drain(c, &res)
				return done()
			}
		case "delta":
			res.UpdatesReceived++
			gaps.observe(m.Sequence)
			if !lastDelta.IsZero() {
				intervals = append(intervals, float64(now.Sub(lastDelta).Milliseconds()))
			}
			lastDelta = now
			if m.TS > 0 {
				lags = append(lags, offset.lag(monoMs(now), m.TS))
			}
		case "resync_required":
			res.ResyncRequired = true
		}
	}
	return done()
}

// drain reads whatever the server managed to queue for a slow client (looking for
// resync_required and the close code) for at most 30 s.
func drain(c *websocket.Conn, res *clientResult) int {
	dctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	n := 0
	for {
		_, data, err := c.Read(dctx)
		if err != nil {
			if st := websocket.CloseStatus(err); st != -1 {
				res.CloseCode = int(st)
			} else {
				res.Error = err.Error()
			}
			return n
		}
		n++
		var m msg
		if json.Unmarshal(data, &m) == nil && m.Type == "resync_required" {
			res.ResyncRequired = true
		}
	}
}

func finish(res clientResult, gaps gapCounter, intervals, lags []float64) clientResult {
	res.SeqGaps = gaps.gaps
	res.P95LatencyMs = percentile(intervals, 95)
	res.MaxDeltaGapMs = percentile(intervals, 100)
	res.LagP50Ms = percentile(lags, 50)
	res.LagP95Ms = percentile(lags, 95)
	return res
}

// resubTest: one client subscribes N times while deltas flow; after each snapshot the next delta
// of that subscription must be sequence+1, and no delta of an older subscription may follow it.
func resubTest(ctx context.Context, o options, n int) resubResult {
	r := resubResult{Requested: n}
	c, err := dial(ctx, o)
	if err != nil {
		r.Error = err.Error()
		return r
	}
	defer c.CloseNow()
	tctx, cancel := context.WithTimeout(ctx, time.Duration(n)*time.Second+30*time.Second)
	defer cancel()
	current := ""
	var last uint64
	deltasSince := 0
	next := 1
	for {
		_, data, err := c.Read(tctx)
		if err != nil {
			r.Error = err.Error()
			break
		}
		var m msg
		if json.Unmarshal(data, &m) != nil {
			continue
		}
		switch m.Type {
		case "hello":
			_ = c.Write(tctx, websocket.MessageText, subscribeMsg(o, fmt.Sprintf("r%d", next)))
		case "heartbeat":
			_ = c.Write(tctx, websocket.MessageText, []byte(`{"type":"heartbeat","ts":0}`))
		case "snapshot":
			r.Snapshots++
			current, last, deltasSince = m.SubscriptionID, m.Sequence, 0
		case "delta":
			if m.SubscriptionID != current {
				r.StaleDeltas++
				continue
			}
			if m.Sequence != last+1 {
				r.Gaps++
			}
			last = m.Sequence
			deltasSince++
			// Resubscribe after 1-3 deltas so registrations land at varying points of the tick.
			if deltasSince >= 1+next%3 {
				if next >= n {
					r.Pass = r.Snapshots == n && r.Gaps == 0 && r.StaleDeltas == 0
					c.Close(websocket.StatusNormalClosure, "done")
					return r
				}
				next++
				_ = c.Write(tctx, websocket.MessageText, subscribeMsg(o, fmt.Sprintf("r%d", next)))
			}
		}
	}
	return r
}
