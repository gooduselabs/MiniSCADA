// Query mode (feature 010, T072): N goroutines call GET /api/v1/history/series and /aggregate over
// HTTPS with a Bearer token while the live clients of main.go hold their sockets. Reports the latency
// distribution of the answers, the 429 BUSY answers and how fast they came (the limit must say no in
// <= 100 ms), and any other status.
//
//	load-tester ... -query-threads 3 -query-group dien -query-tags METER1.KW -query-user xem1 \
//	    -query-password-env MAT_LT_PW -https-port 8443 -query-span-h 24
package main

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
)

type queryOptions struct {
	threads   int
	group     string
	tags      string
	user      string
	password  string
	httpsPort int
	spanH     int
	maxPoints int
	res       string
}

type queryResult struct {
	Requests   int         `json:"requests"`
	OK         int         `json:"ok"`
	Busy429    int         `json:"busy429"`
	BusyMaxMs  float64     `json:"busyMaxMs"`
	Other      map[int]int `json:"otherStatus"`
	P50Ms      float64     `json:"p50Ms"`
	P95Ms      float64     `json:"p95Ms"`
	MaxMs      float64     `json:"maxMs"`
	LoginError string      `json:"loginError,omitempty"`
}

func httpsClient() *http.Client {
	return &http.Client{
		Timeout:   30 * time.Second,
		Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}, // test tool, self-signed device certificate
	}
}

func loginToken(c *http.Client, host string, port int, user, password string) (string, error) {
	body, _ := json.Marshal(map[string]string{"user": user, "password": password})
	resp, err := c.Post(fmt.Sprintf("https://%s:%d/api/v1/auth/login", host, port), "application/json", strings.NewReader(string(body)))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("login: HTTP %d", resp.StatusCode)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		return "", err
	}
	tok, _ := m["token"].(string)
	return tok, nil
}

// runQueries runs until `stop` is closed. Every thread has its own session (one request per session).
func runQueries(o options, q queryOptions, stop <-chan struct{}) queryResult {
	var mu sync.Mutex
	res := queryResult{Other: map[int]int{}}
	var durs []float64
	var wg sync.WaitGroup
	for i := 0; i < q.threads; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			c := httpsClient()
			tok, err := loginToken(c, o.host, q.httpsPort, q.user, q.password)
			if err != nil {
				mu.Lock()
				res.LoginError = err.Error()
				mu.Unlock()
				return
			}
			for n := 0; ; n++ {
				select {
				case <-stop:
					return
				default:
				}
				now := time.Now().UnixMilli()
				span := int64(q.spanH) * 3600 * 1000
				v := url.Values{}
				v.Set("group", q.group)
				v.Set("tags", q.tags)
				v.Set("from", fmt.Sprint(now-span))
				v.Set("to", fmt.Sprint(now))
				v.Set("maxPoints", fmt.Sprint(q.maxPoints))
				if q.res != "" {
					v.Set("res", q.res)
				}
				req, _ := http.NewRequest("GET", fmt.Sprintf("https://%s:%d/api/v1/history/series?%s", o.host, q.httpsPort, v.Encode()), nil)
				req.Header.Set("Authorization", "Bearer "+tok)
				t0 := time.Now()
				resp, err := c.Do(req)
				ms := float64(time.Since(t0).Microseconds()) / 1000
				mu.Lock()
				res.Requests++
				if err != nil {
					res.Other[-1]++
				} else {
					io.Copy(io.Discard, resp.Body)
					resp.Body.Close()
					switch resp.StatusCode {
					case 200:
						res.OK++
						durs = append(durs, ms)
					case 429:
						res.Busy429++
						if ms > res.BusyMaxMs {
							res.BusyMaxMs = ms
						}
					default:
						res.Other[resp.StatusCode]++
					}
				}
				mu.Unlock()
				time.Sleep(200 * time.Millisecond)
			}
		}(i)
	}
	wg.Wait()
	sort.Float64s(durs)
	res.P50Ms = percentile(durs, 50)
	res.P95Ms = percentile(durs, 95)
	if len(durs) > 0 {
		res.MaxMs = durs[len(durs)-1]
	}
	return res
}

func queryOptionsFromEnv(q queryOptions, passwordEnv string) queryOptions {
	if passwordEnv != "" {
		q.password = os.Getenv(passwordEnv)
	}
	return q
}
