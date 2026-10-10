package main

import (
	"math"
	"sort"
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
	P95LatencyMs    float64 `json:"p95LatencyMs"` // p95 of inter-delta interval (jitter proxy)
	LagP50Ms        float64 `json:"lagP50Ms"`     // delta delay above the fastest message seen
	LagP95Ms        float64 `json:"lagP95Ms"`
	ResyncRequired  bool    `json:"resyncRequired,omitempty"`
	SlowDrained     int     `json:"slowDrainedMessages,omitempty"`
	HeartbeatErrors int     `json:"heartbeatErrors,omitempty"`
	HeartbeatError  string  `json:"heartbeatError,omitempty"`
}

type summary struct {
	Accepted               int     `json:"accepted"`
	Rejected               int     `json:"rejected"`
	ExtraRejectedCorrectly bool    `json:"extraRejectedCorrectly"` // every rejected client got close code 4429
	TotalGaps              int     `json:"totalSeqGaps"`           // normal clients only
	MaxP95IntervalMs       float64 `json:"maxP95IntervalMs"`       // normal clients only
	MaxLagP95Ms            float64 `json:"maxLagP95Ms"`            // normal clients only
	SlowClients            int     `json:"slowClients"`
	SlowResyncRequired     int     `json:"slowResyncRequired"`
	SlowClosed4409         int     `json:"slowClosed4409"`
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

func summarize(rs []clientResult) summary {
	s := summary{ExtraRejectedCorrectly: true}
	for _, r := range rs {
		if r.Mode == "slow" {
			s.SlowClients++
			if r.ResyncRequired {
				s.SlowResyncRequired++
			}
			if r.CloseCode == closeResync {
				s.SlowClosed4409++
			}
			continue
		}
		s.TotalGaps += r.SeqGaps
		s.MaxP95IntervalMs = math.Max(s.MaxP95IntervalMs, r.P95LatencyMs)
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
