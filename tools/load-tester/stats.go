package main

import (
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// clientResult: one simulated client (extends clientResults[] of
// specs/001-platform-validation/contracts/measurement.schema.json).
type clientResult struct {
	ClientIndex     int     `json:"clientIndex"`
	Mode            string  `json:"mode"`
	Accepted        bool    `json:"accepted"`
	CloseCode       int     `json:"closeCode,omitempty"`
	ClosedAfterMs   int64   `json:"closedAfterMs,omitempty"`
	ErrorCode       string  `json:"errorCode,omitempty"`
	Error           string  `json:"error,omitempty"`
	Snapshots       int     `json:"snapshots"`
	UpdatesReceived int     `json:"updatesReceived"`
	SeqGaps         int     `json:"seqGaps"`
	P95LatencyMs    float64 `json:"p95LatencyMs"`  // p95 of inter-delta interval (jitter proxy)
	MaxDeltaGapMs   float64 `json:"maxDeltaGapMs"` // longest inter-delta interval (screen pause)
	LagP50Ms        float64 `json:"lagP50Ms"`      // delta delay above the fastest message seen
	LagP95Ms        float64 `json:"lagP95Ms"`
	ResyncRequired  bool    `json:"resyncRequired,omitempty"`
	SlowDrained     int     `json:"slowDrainedMessages,omitempty"`
	HeartbeatErrors int     `json:"heartbeatErrors,omitempty"`
	HeartbeatError  string  `json:"heartbeatError,omitempty"`
	// Slow client: ms from the handshake to the first failed write or read, i.e. when the server
	// dropped the session (write timeout) although this client never read the payload (T-056).
	TerminatedAfterMs int64  `json:"terminatedAfterMs,omitempty"`
	ProtocolVersion   string `json:"protocolVersion,omitempty"`  // from hello (T-048)
	ProtocolMismatch  bool   `json:"protocolMismatch,omitempty"` // MAJOR differs from -proto 1
}

type summary struct {
	Accepted                 int     `json:"accepted"`
	Rejected                 int     `json:"rejected"`
	ExtraRejectedCorrectly   bool    `json:"extraRejectedCorrectly"` // every rejected client got close code 4429
	TotalGaps                int     `json:"totalSeqGaps"`           // normal clients only
	MaxP95IntervalMs         float64 `json:"maxP95IntervalMs"`       // normal clients only
	MaxDeltaGapMs            float64 `json:"maxDeltaGapMs"`          // normal clients only
	MaxLagP95Ms              float64 `json:"maxLagP95Ms"`            // normal clients only
	SlowClients              int     `json:"slowClients"`
	SlowResyncRequired       int     `json:"slowResyncRequired"`
	SlowClosed4409           int     `json:"slowClosed4409"`
	SlowTerminated           int     `json:"slowTerminated"`           // slow clients dropped by the server
	MaxSlowTerminatedAfterMs int64   `json:"maxSlowTerminatedAfterMs"` // latest of those drops
	ProtocolMismatch         int     `json:"protocolMismatch"`         // clients that refused hello (T-048)
}

type resubResult struct {
	Requested   int    `json:"requested"`
	Snapshots   int    `json:"snapshots"`
	Gaps        int    `json:"gaps"`
	StaleDeltas int    `json:"staleDeltas"`
	Pass        bool   `json:"pass"`
	Error       string `json:"error,omitempty"`
}

const (
	closeMaxClients = 4429
	closeResync     = 4409
)

func percentile(v []float64, p float64) float64 {
	if len(v) == 0 {
		return 0
	}
	s := append([]float64(nil), v...)
	sort.Float64s(s)
	idx := int(float64(len(s))*p/100.0+0.9999999) - 1
	if idx < 0 {
		idx = 0
	}
	if idx >= len(s) {
		idx = len(s) - 1
	}
	return s[idx]
}

// gapCounter counts discontinuities in a monotonically increasing sequence.
type gapCounter struct {
	last uint64
	seen bool
	gaps int
}

func (g *gapCounter) observe(seq uint64) {
	if g.seen && seq != g.last+1 {
		g.gaps++
	}
	g.last, g.seen = seq, true
}

// clockOffset estimates (local clock - server clock + minimum one-way delay) as the smallest
// recv-ts seen. lag() is then the extra delay of a message above the fastest one: it removes the
// unknown clock offset between the two machines but also the minimum network delay (a lower bound
// of the real Tag -> client delay, see docs/reports/sprint1-acceptance.md).
type clockOffset struct {
	min  float64
	seen bool
}

func (c *clockOffset) observe(recvMs, serverTs int64) {
	d := float64(recvMs - serverTs)
	if !c.seen || d < c.min {
		c.min, c.seen = d, true
	}
}

func (c *clockOffset) lag(recvMs, serverTs int64) float64 {
	if !c.seen {
		return 0
	}
	return math.Max(0, float64(recvMs-serverTs)-c.min)
}

// protocolMajor returns the MAJOR of a SemVer such as "1.0.0" (T-048).
func protocolMajor(v string) (int, bool) {
	head, _, found := strings.Cut(v, ".")
	n, err := strconv.Atoi(head)
	if !found || err != nil || head == "" {
		return 0, false
	}
	return n, true
}

// firstFailure keeps the time of the first failed write or read on a connection: for a client
// that never reads, the first heartbeat write that fails is when the server dropped it (T-056).
type firstFailure struct {
	mu  sync.Mutex
	at  time.Duration
	set bool
}

func (f *firstFailure) mark(d time.Duration) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if !f.set {
		f.at, f.set = d, true
	}
}

func (f *firstFailure) ms() int64 {
	f.mu.Lock()
	defer f.mu.Unlock()
	if !f.set {
		return 0
	}
	return f.at.Milliseconds()
}

// buildInfo picks the runtime build out of /api/v1/system/info read before the clients start,
// so that a result file can be matched with a deploy (uptime gives the process start, R-15).
func buildInfo(info map[string]any) map[string]any {
	if info == nil {
		return nil
	}
	return map[string]any{
		"runtimeVersion":  info["runtimeVersion"],
		"protocolVersion": info["protocolVersion"],
		"uptimeSAtStart":  info["uptimeS"],
	}
}

func summarize(rs []clientResult) summary {
	s := summary{ExtraRejectedCorrectly: true}
	for _, r := range rs {
		if r.ProtocolMismatch {
			s.ProtocolMismatch++
		}
		if r.Mode == "slow" {
			s.SlowClients++
			if r.ResyncRequired {
				s.SlowResyncRequired++
			}
			if r.CloseCode == closeResync {
				s.SlowClosed4409++
			}
			if r.TerminatedAfterMs > 0 {
				s.SlowTerminated++
				if r.TerminatedAfterMs > s.MaxSlowTerminatedAfterMs {
					s.MaxSlowTerminatedAfterMs = r.TerminatedAfterMs
				}
			}
			continue
		}
		s.TotalGaps += r.SeqGaps
		s.MaxP95IntervalMs = math.Max(s.MaxP95IntervalMs, r.P95LatencyMs)
		s.MaxDeltaGapMs = math.Max(s.MaxDeltaGapMs, r.MaxDeltaGapMs)
		s.MaxLagP95Ms = math.Max(s.MaxLagP95Ms, r.LagP95Ms)
		if r.Accepted {
			s.Accepted++
			continue
		}
		s.Rejected++
		if r.CloseCode != closeMaxClients {
			s.ExtraRejectedCorrectly = false
		}
	}
	return s
}
