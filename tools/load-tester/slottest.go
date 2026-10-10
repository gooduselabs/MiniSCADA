package main

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// slotTest verifies the heartbeat timeout: 9 healthy clients + 1 silent client (no heartbeat)
// fill all 10 slots. A probe at ~5 s must be rejected (4429); after the 15 s timeout a probe
// must be accepted, and the silent client must have been closed with 4408.
func slotTest(ctx context.Context, o options) bool {
	var wg sync.WaitGroup
	hold := 45 * time.Second
	for i := 0; i < 9; i++ {
		wg.Add(1)
		go func(i int) { defer wg.Done(); runClient(ctx, o, i+1, hold, modeNormal) }(i)
		time.Sleep(50 * time.Millisecond)
	}
	wg.Add(1)
	var silentRes clientResult
	go func() { defer wg.Done(); silentRes = runClient(ctx, o, 10, hold, modeSilent) }()

	time.Sleep(5 * time.Second)
	early := runClient(ctx, o, 11, 3*time.Second, modeNormal)
	fmt.Printf("probe @5s : accepted=%v closeCode=%d (expect rejected, 4429)\n", early.Accepted, early.CloseCode)

	time.Sleep(22 * time.Second) // now ~30 s, well past the 15 s timeout
	late := runClient(ctx, o, 12, 3*time.Second, modeNormal)
	fmt.Printf("probe @30s: accepted=%v (expect accepted)\n", late.Accepted)

	wg.Wait()
	fmt.Printf("silent client closeCode=%d after %d ms (expect 4408 after ~15 s)\n",
		silentRes.CloseCode, silentRes.ClosedAfterMs)
	ok := !early.Accepted && early.CloseCode == closeMaxClients && late.Accepted
	if o.proto == 1 {
		ok = ok && silentRes.CloseCode == 4408
	}
	fmt.Printf("SLOT TEST: pass=%v\n", ok)
	return ok
}
