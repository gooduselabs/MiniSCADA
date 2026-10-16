// load-tester: simulates live clients against mat-runtime (/api/v1/live, protocol 1.0.0,
// specs/002-vertical-slice/contracts/live-ws.md) or the Sprint 0 PoC (-proto 0).
//
//	load-tester -host 192.168.1.110 -clients 10 -extra 1 -tags sim -duration 300 -out r.json
//	load-tester -host ... -clients 9 -slow 1 -extra 0 -duration 600 # slow client: stops reading, dropped after write timeout
//	load-tester -host ... -origin http://evil.example -clients 1 # must be refused (HTTP 403)
//	load-tester -host ... -resub 100                            # snapshot/subscribe race (FR-020)
//	load-tester -host ... -slot-test                            # heartbeat timeout frees the slot
//	load-tester -host ... -tags 500|1000 -extra-attempts 50 -flap 50 -latency  # feature 011, see load011.go
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
	case "bench": // feature 010: the 200 Tags of tools/bench-project.mjs
		t := make([]string, 0, 200)
		for k := 0; k < 200; k++ {
			c := 'T'
			if k%20 == 19 {
				c = 'S'
			}
			t = append(t, fmt.Sprintf("BENCH.%c%04d", c, k+1))
		}
		return t
	case "500":
		return simTags(500)
	case "1000":
		return simTags(1000)
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

// runMeta identifies a result file: when it ran (startedAt is taken before the first client),
// against which host, with which tags, and which runtime build answered (R-15).
func runMeta(o options, startedAt time.Time, infoAtStart map[string]any) map[string]any {
	return map[string]any{
		"startedAt":  startedAt.UTC().Format(time.RFC3339),
		"finishedAt": time.Now().UTC().Format(time.RFC3339),
		"host":       fmt.Sprintf("%s:%d", o.host, o.port),
		"tags":       o.tags,
		"build":      buildInfo(infoAtStart),
	}
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
	flag.StringVar(&o.tags, "tags", "sim", "tags to subscribe: 500 | 1000 (SIM.T0001.., tools/gen-bench-projects.mjs) | sim (500 SIM.*, older runs) | demo (5 tank/motor tags) | bench")
	flag.StringVar(&o.origin, "origin", "", "send this Origin header (browser-like client)")
	clients := flag.Int("clients", 10, "regular clients")
	extra := flag.Int("extra", 1, "extra clients connecting after the regular ones (should be rejected)")
	slow := flag.Int("slow", 0, "additional slow clients that stop reading after the snapshot")
	resub := flag.Int("resub", 0, "run the resubscribe race test with N subscriptions instead")
	duration := flag.Int("duration", 60, "seconds to hold regular clients")
	extraAttemptsN := flag.Int("extra-attempts", 0, "feature 011 L3: N successive extra clients (instead of -extra parallel ones), each must get close 4429")
	flapN := flag.Int("flap", 0, "feature 011 L6: N disconnect/reconnect cycles of the -clients sessions instead of the hold")
	flapMode := flag.String("flap-mode", "close", "close: this tool drops the sockets | external: wait for cuts made outside (ip link, switch port, docker network)")
	flapHold := flag.Int("flap-hold", 5, "close mode: seconds connected before each drop")
	flapSettle := flag.Int("flap-settle", 20, "seconds after the last cycle before reading system/info clients (> 15 s heartbeat timeout)")
	flapTimeout := flag.Int("flap-timeout", 0, "external mode: seconds to wait for all cuts (0 = 120 s per cycle)")
	latency := flag.Bool("latency", false, "feature 011: end-to-end delta delay over all normal clients (p50, p95, max)")
	out := flag.String("out", "", "write JSON result to file")
	slot := flag.Bool("slot-test", false, "run the heartbeat-timeout slot release test instead")
	var q queryOptions
	flag.IntVar(&q.threads, "query-threads", 0, "feature 010: threads that call GET /api/v1/history/series over HTTPS while the live clients hold")
	flag.StringVar(&q.group, "query-group", "", "history group of the queries")
	flag.StringVar(&q.tags, "query-tags", "", "comma separated Tags of the queries")
	flag.StringVar(&q.user, "query-user", "", "account of the queries (any role)")
	qpw := flag.String("query-password-env", "", "name of the environment variable that holds the password")
	flag.IntVar(&q.httpsPort, "https-port", 8443, "HTTPS port of the queries")
	flag.IntVar(&q.spanH, "query-span-h", 24, "hours each query asks for")
	flag.IntVar(&q.maxPoints, "query-max-points", 1000, "maxPoints of the queries")
	flag.StringVar(&q.res, "query-res", "", "res of the queries (auto when empty)")
	flag.Parse()
	q = queryOptionsFromEnv(q, *qpw)
	if err := validateTags(o.tags); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	if *flapMode != "close" && *flapMode != "external" {
		fmt.Fprintln(os.Stderr, "-flap-mode: close or external")
		os.Exit(2)
	}
	cfg := loadConfig{Tags: o.tags, TagCount: len(o.tagList()), Clients: *clients, Extra: *extra,
		ExtraAttempts: *extraAttemptsN, Flap: *flapN, DurationS: *duration, Latency: *latency}
	if *flapN > 0 {
		cfg.FlapMode = *flapMode
	}
	scenario := scenarioCode(cfg)

	ctx := context.Background()
	infoAtStart := systemInfo(o)
	startedAt := time.Now()
	if *slot {
		fmt.Printf("host %s:%d, build %v, startedAt %s\n", o.host, o.port, buildInfo(infoAtStart),
			startedAt.UTC().Format(time.RFC3339))
		if !slotTest(ctx, o) {
			os.Exit(1)
		}
		return
	}
	if *resub > 0 {
		r := resubTest(ctx, o, *resub)
		doc := runMeta(o, startedAt, infoAtStart)
		doc["scenarioId"] = fmt.Sprintf("resub-%d", *resub)
		doc["result"] = r
		doc["server"] = systemInfo(o)
		writeDoc(doc, *out)
		if !r.Pass {
			os.Exit(1)
		}
		return
	}

	if *flapN > 0 {
		timeout := time.Duration(*flapTimeout) * time.Second
		if timeout == 0 {
			timeout = time.Duration(*flapN) * 120 * time.Second
		}
		fr := flapTest(ctx, o, flapConfig{Clients: *clients, Cycles: *flapN, Mode: *flapMode,
			Hold: time.Duration(*flapHold) * time.Second, Settle: time.Duration(*flapSettle) * time.Second,
			Limit: 35 * time.Second, Timeout: timeout})
		doc := runMeta(o, startedAt, infoAtStart)
		checks := buildChecks(scenario, summary{}, nil, &fr)
		nm := notMeasured(scenario)
		if *flapMode == "close" {
			nm = append(nm, "realNetworkCut") // this tool closed the sockets; a cut is -flap-mode external
		}
		for k, v := range map[string]any{
			"format": "mat-load-011", "formatVersion": 1, "scenario": scenario,
			"scenarioId": fmt.Sprintf("flap-%dx%d-%s-%s", *clients, *flapN, *flapMode, o.tags),
			"config":     cfg, "flap": fr, "checks": checks, "notMeasured": nm, "pass": allPass(checks),
			"server": systemInfo(o),
		} {
			doc[k] = v
		}
		writeDoc(doc, *out)
		if !allPass(checks) {
			os.Exit(1)
		}
		return
	}

	hold := time.Duration(*duration) * time.Second
	parallelExtra := *extra
	if *extraAttemptsN > 0 {
		parallelExtra = 0 // L3: successive attempts instead
		if need := time.Duration(*extraAttemptsN)*600*time.Millisecond + 10*time.Second; need > hold {
			fmt.Fprintf(os.Stderr, "warning: -duration %d s may end before %d extra attempts (~%s)\n",
				*duration, *extraAttemptsN, need)
		}
	}
	n := *clients + *slow + parallelExtra
	var queryDone chan queryResult
	stopQueries := make(chan struct{})
	if q.threads > 0 {
		queryDone = make(chan queryResult, 1)
		go func() { queryDone <- runQueries(o, q, stopQueries) }()
	}
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
	var l3 *l3Result
	if *extraAttemptsN > 0 {
		r := extraAttempts(ctx, o, *extraAttemptsN)
		l3 = &r
	}
	for j := 0; j < parallelExtra; j++ {
		wg.Add(1)
		idx := *clients + *slow + j
		go func() { defer wg.Done(); results[idx] = runClient(ctx, o, idx+1, 5*time.Second, modeNormal) }()
	}
	wg.Wait()
	var queryDoc any
	if queryDone != nil {
		close(stopQueries)
		queryDoc = <-queryDone
	}

	doc := runMeta(o, startedAt, infoAtStart)
	s := summarize(results)
	if queryDoc != nil {
		doc["query"] = queryDoc
	}
	checks := buildChecks(scenario, s, l3, nil)
	if l3 != nil {
		doc["l3"] = l3
	}
	if *latency {
		doc["latency"] = aggregateLatency(results, o)
	}
	for k, v := range map[string]any{
		"format":        "mat-load-011",
		"formatVersion": 1,
		"scenario":      scenario,
		"config":        cfg,
		"checks":        checks,
		"notMeasured":   notMeasured(scenario),
		"pass":          allPass(checks),
		"scenarioId":    fmt.Sprintf("load-%dx+%dslow+%d-%s", *clients, *slow, *extra, o.tags),
		"durationS":     *duration,
		"protocol":      o.proto,
		"origin":        o.origin,
		"clients":       n,
		"clientResults": results,
		"summary":       s,
		"server":        systemInfo(o),
	} {
		doc[k] = v
	}
	writeDoc(doc, *out)
	if s.ProtocolMismatch > 0 || (scenario != "custom" && !allPass(checks)) {
		os.Exit(1)
	}
}
