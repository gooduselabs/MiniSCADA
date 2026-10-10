// load-tester: simulates live clients against mat-runtime (/api/v1/live, protocol 1.0.0,
// specs/002-vertical-slice/contracts/live-ws.md) or the Sprint 0 PoC (-proto 0).
//
//	load-tester -host 192.168.1.110 -clients 10 -extra 1 -tags sim -duration 300 -out r.json
//	load-tester -host ... -clients 9 -slow 1 -duration 600     # slow client (send queue overflow)
//	load-tester -host ... -origin http://evil.example -clients 1 # must be refused (HTTP 403)
//	load-tester -host ... -resub 100                            # snapshot/subscribe race (FR-020)
//	load-tester -host ... -slot-test                            # heartbeat timeout frees the slot
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"sync"
	"time"
)

type options struct {
	host, origin, tags string
	port, proto        int
}

func (o options) wsURL() string { return fmt.Sprintf("ws://%s:%d/api/v1/live", o.host, o.port) }

func (o options) tagList() []string {
	switch o.tags {
	case "demo":
		return []string{"TANK01.LEVEL", "MOTOR01.RUN", "MOTOR01.SPEED", "TANK01.INFLOW", "TANK01.TEMP"}
	default:
		t := make([]string, 0, 500)
		for i := 1; i <= 500; i++ {
			t = append(t, fmt.Sprintf("SIM.T%04d", i))
		}
		return t
	}
}

// systemInfo returns /api/v1/system/info (nil when unavailable, e.g. the PoC).
func systemInfo(o options) map[string]any {
	c := http.Client{Timeout: 3 * time.Second}
	resp, err := c.Get(fmt.Sprintf("http://%s:%d/api/v1/system/info", o.host, o.port))
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	var m map[string]any
	if json.Unmarshal(b, &m) != nil {
		return nil
	}
	return m
}

func writeDoc(doc map[string]any, out string) {
	b, _ := json.MarshalIndent(doc, "", "  ")
	if out != "" {
		_ = os.WriteFile(out, b, 0o644)
	}
	fmt.Println(string(b))
}

func main() {
	var o options
	flag.StringVar(&o.host, "host", "127.0.0.1", "server host")
	flag.IntVar(&o.port, "port", 8080, "server port")
	flag.IntVar(&o.proto, "proto", 1, "live protocol: 1 = mat-runtime 1.0.0, 0 = Sprint 0 PoC")
	flag.StringVar(&o.tags, "tags", "sim", "tags to subscribe: sim (500 SIM.*) | demo (5 tank/motor tags)")
	flag.StringVar(&o.origin, "origin", "", "send this Origin header (browser-like client)")
	clients := flag.Int("clients", 10, "regular clients")
	extra := flag.Int("extra", 1, "extra clients connecting after the regular ones (should be rejected)")
	slow := flag.Int("slow", 0, "additional slow clients that stop reading after the snapshot")
	resub := flag.Int("resub", 0, "run the resubscribe race test with N subscriptions instead")
	duration := flag.Int("duration", 60, "seconds to hold regular clients")
	out := flag.String("out", "", "write JSON result to file")
	slot := flag.Bool("slot-test", false, "run the heartbeat-timeout slot release test instead")
	flag.Parse()

	ctx := context.Background()
	if *slot {
		if !slotTest(ctx, o) {
			os.Exit(1)
		}
		return
	}
	if *resub > 0 {
		r := resubTest(ctx, o, *resub)
		writeDoc(map[string]any{"scenarioId": fmt.Sprintf("resub-%d", *resub), "result": r,
			"server": systemInfo(o)}, *out)
		if !r.Pass {
			os.Exit(1)
		}
		return
	}

	hold := time.Duration(*duration) * time.Second
	n := *clients + *slow + *extra
	results := make([]clientResult, n)
	var wg sync.WaitGroup
	for i := 0; i < *clients+*slow; i++ {
		wg.Add(1)
		mode := modeNormal
		if i >= *clients {
			mode = modeSlow
		}
		go func(i int, mode clientMode) {
			defer wg.Done()
			results[i] = runClient(ctx, o, i+1, hold, mode)
		}(i, mode)
		time.Sleep(50 * time.Millisecond)
	}
	time.Sleep(2 * time.Second) // let the regular clients settle
	for j := 0; j < *extra; j++ {
		wg.Add(1)
		idx := *clients + *slow + j
		go func() { defer wg.Done(); results[idx] = runClient(ctx, o, idx+1, 5*time.Second, modeNormal) }()
	}
	wg.Wait()

	writeDoc(map[string]any{
		"scenarioId":    fmt.Sprintf("load-%dx+%dslow+%d-%s", *clients, *slow, *extra, o.tags),
		"startedAt":     time.Now().UTC().Format(time.RFC3339),
		"durationS":     *duration,
		"protocol":      o.proto,
		"origin":        o.origin,
		"clients":       n,
		"clientResults": results,
		"summary":       summarize(results),
		"server":        systemInfo(o),
	}, *out)
}
