// Feature 011 (FR-038; contracts/test-protocols.md §1 L3, second part): "client 1 leaves, a new
// client gets in within 35 s". With -reentry N, after the L3 hold (or on its own) this tool opens
// -clients sessions (every slot of the runtime), then runs N rounds of each mode:
//
//	close:  the extra client must get close 4429; client 1 (the oldest session) sends a close
//	        frame (1000); time from that moment until a new client receives its snapshot.
//	silent: the extra client must get close 4429; client 1 stops heartbeating and reading (no ping
//	        answered, TCP kept open, like a cable pulled on its side); time from the moment its
//	        reader stopped until a new client receives its snapshot. The runtime frees the slot
//	        at its heartbeat timeout (15 s, close 4408), so expect about 15 s.
//
// The new client attempts every 250 ms (4429 while the slot is held) and becomes the newest
// session, so every round releases the oldest. JSON: "reentry" (reentryResult); checks:
// "new client within 35 s after client 1 closes" and "... after client 1 goes silent".
package main

import (
	"context"
	"fmt"
	"time"
)

type reentryConfig struct {
	Clients int           // sessions that fill the runtime (maxClients)
	Rounds  int           // rounds of each mode
	Limit   time.Duration // threshold (35 s)
	GiveUp  time.Duration // stop trying a new client after this long (0 = 2 × Limit)
	Retry   time.Duration // pause between attempts of the new client (0 = 250 ms)
}

type reentryRound struct {
	Mode      string `json:"mode"` // close | silent
	Round     int    `json:"round"`
	ExtraCode int    `json:"extraCloseCode"` // close code of the extra client before release (4429; 0 = accepted)
	ReentryMs int64  `json:"reentryMs"`
	Attempts  int    `json:"attempts"`
	LastCode  int    `json:"lastCloseCode,omitempty"`
	Reentered bool   `json:"reentered"`
	Error     string `json:"error,omitempty"`
	Pass      bool   `json:"pass"`
}

type reentryMode struct {
	Rounds    int          `json:"rounds"`
	Reentered int          `json:"reentered"`
	Failed    int          `json:"failed"`
	OverLimit int          `json:"overLimit"`
	ReentryMs latencyStats `json:"reentryMs"`
	Pass      bool         `json:"pass"`
}

type reentryResult struct {
	Method  string         `json:"method"`
	Clients int            `json:"clients"`
	Rounds  int            `json:"rounds"`
	LimitMs int64          `json:"limitMs"`
	Close   reentryMode    `json:"close"`
	Silent  reentryMode    `json:"silent"`
	Events  []reentryRound `json:"events"`
	Error   string         `json:"error,omitempty"`
	Pass    bool           `json:"pass"`
}

// admit tries new clients until one receives its snapshot or giveUp passes.
func admit(ctx context.Context, o options, giveUp, retry time.Duration) (*session, int, int, error) {
	start := time.Now()
	attempts, last := 0, 0
	for {
		attempts++
		s, _, err := openSession(ctx, o, 10*time.Second)
		if err == nil {
			return s, attempts, last, nil
		}
		last = closeCodeOf(err)
		if time.Since(start) > giveUp || ctx.Err() != nil {
			return nil, attempts, last, err
		}
		time.Sleep(retry)
	}
}

func reentryTest(ctx context.Context, o options, cfg reentryConfig) reentryResult {
	if cfg.GiveUp == 0 {
		cfg.GiveUp = 2 * cfg.Limit
	}
	if cfg.Retry == 0 {
		cfg.Retry = 250 * time.Millisecond
	}
	r := reentryResult{
		Method: "every slot held, extra client must get 4429; client 1 (oldest) closes (close frame 1000) or goes " +
			"silent (no heartbeat, no read, TCP open); reentryMs: from that moment to the snapshot of a new client " +
			"(attempt every " + cfg.Retry.String() + ")",
		Clients: cfg.Clients, Rounds: cfg.Rounds, LimitMs: cfg.Limit.Milliseconds(), Events: []reentryRound{},
	}
	sessions := make([]*session, 0, cfg.Clients)
	defer func() {
		for _, s := range sessions {
			s.close()
		}
	}()
	for i := 0; i < cfg.Clients; i++ {
		s, _, _, err := admit(ctx, o, cfg.GiveUp, cfg.Retry)
		if err != nil {
			r.Error = fmt.Sprintf("client %d: initial connect: %v", i+1, err)
			return r
		}
		sessions = append(sessions, s)
	}

	round := func(mode string, n int) reentryRound {
		ev := reentryRound{Mode: mode, Round: n}
		extra, _, err := openSession(ctx, o, 5*time.Second)
		if err == nil {
			extra.close()
			ev.Error = "extra client accepted: the runtime was not full (check maxClients and maxLiveClientsPerSource)"
			return ev
		}
		ev.ExtraCode = closeCodeOf(err)
		if ev.ExtraCode != closeMaxClients {
			ev.Error = fmt.Sprintf("extra client: %v (want close 4429)", err)
			return ev
		}
		old := sessions[0]
		sessions = sessions[1:]
		var start time.Time
		if mode == "close" {
			start = time.Now()
			old.closeClean()
		} else {
			start, err = old.silence(10 * time.Second)
			if err != nil {
				old.close()
				ev.Error = "client 1: " + err.Error()
				return ev
			}
			defer old.close() // after the new client is in: the runtime has already dropped it
		}
		s, attempts, last, err := admit(ctx, o, cfg.GiveUp, cfg.Retry)
		ev.ReentryMs, ev.Attempts, ev.LastCode = time.Since(start).Milliseconds(), attempts, last
		if err != nil {
			ev.Error = fmt.Sprintf("no new client in %s: %v", cfg.GiveUp, err)
			return ev
		}
		sessions = append(sessions, s)
		ev.LastCode = 0
		ev.Reentered = true
		ev.Pass = ev.ReentryMs <= cfg.Limit.Milliseconds()
		return ev
	}
	// refill puts the runtime back to Clients sessions after a failed round.
	refill := func() bool {
		for len(sessions) < cfg.Clients {
			s, _, _, err := admit(ctx, o, cfg.GiveUp, cfg.Retry)
			if err != nil {
				r.Error = fmt.Sprintf("refill after a failed round: %v", err)
				return false
			}
			sessions = append(sessions, s)
		}
		return true
	}
	modes := []struct {
		name string
		res  *reentryMode
	}{{"close", &r.Close}, {"silent", &r.Silent}}
	for _, m := range modes {
		var times []float64
		for n := 1; n <= cfg.Rounds && r.Error == ""; n++ {
			ev := round(m.name, n)
			r.Events = append(r.Events, ev)
			m.res.Rounds++
			switch {
			case !ev.Reentered:
				m.res.Failed++
			default:
				m.res.Reentered++
				times = append(times, float64(ev.ReentryMs))
				if !ev.Pass {
					m.res.OverLimit++
				}
			}
			if !ev.Reentered && !refill() {
				break
			}
		}
		m.res.ReentryMs = newLatencyStats(times)
		m.res.Pass = m.res.Rounds == cfg.Rounds && cfg.Rounds > 0 && m.res.Failed == 0 && m.res.OverLimit == 0
	}
	r.Pass = r.Error == "" && r.Close.Pass && r.Silent.Pass
	return r
}

// withReentry adds the two L3 re-entry checks and takes "newClientAfterRelease35s" off the list of
// what was not measured. r == nil (no -reentry): unchanged.
func withReentry(checks []checkResult, nm []string, r *reentryResult) ([]checkResult, []string) {
	if r == nil {
		return checks, nm
	}
	for _, m := range []struct {
		name string
		res  reentryMode
	}{{"closes", r.Close}, {"goes silent", r.Silent}} {
		checks = append(checks, checkResult{
			Name: "new client within 35 s after client 1 " + m.name,
			Pass: m.res.Pass,
			Value: fmt.Sprintf("%d/%d in, %d failed, %d over, p50 %.0f ms, max %.0f ms", m.res.Reentered, m.res.Rounds,
				m.res.Failed, m.res.OverLimit, m.res.ReentryMs.P50Ms, m.res.ReentryMs.MaxMs),
			Limit: "100 % <= 35 s",
		})
	}
	out := make([]string, 0, len(nm))
	for _, k := range nm {
		if k != "newClientAfterRelease35s" {
			out = append(out, k)
		}
	}
	return checks, out
}
