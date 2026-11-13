package api

import (
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/rizzwareengineer/no-LLMit/engine/client"
	"github.com/rizzwareengineer/no-LLMit/engine/history"
	"github.com/rizzwareengineer/no-LLMit/engine/stats"
)

type replies = []client.LLMDecisionResponse

// statsHands plays five three-handed hands through the engine. A is the button, B the
// small blind and C the big blind every time; stacks are 2000 and blinds 5/10.
func statsHands(t *testing.T) []history.HandRecord {
	var hands []history.HandRecord
	play := func(holes [][]string, board []string, script replies) {
		h, _ := playTable(t, abc, nil, holes, board, script)
		h.HandID = fmt.Sprintf("tbl_stats-%06d", len(hands)+1) // each test game restarts at hand 1
		hands = append(hands, h)
	}
	// 1. A opens, B folds, C calls; C checks the flop, A c-bets and C folds.
	play(nil, nil, replies{reply("RAISE", 30), reply("FOLD", 0), reply("CALL", 0),
		reply("CHECK", 0), reply("RAISE", 40), reply("FOLD", 0)})
	// 2. A and B limp, C folds when it could check; A's aces beat B at showdown.
	play([][]string{{"As", "Ad"}, {"7c", "2d"}, {"5h", "6h"}}, []string{"Kh", "9s", "4c", "3d", "Jh"},
		replies{reply("CALL", 0), reply("CALL", 0), reply("FOLD", 0),
			reply("CHECK", 0), reply("CHECK", 0), reply("CHECK", 0), reply("CHECK", 0), reply("CHECK", 0), reply("CHECK", 0)})
	// 3. A's raise is illegal twice and B's replies are unparseable: both forced folds.
	play(nil, nil, replies{missed("illegal", "RAISE", 12), missed("unparseable", "FOLD", 0)})
	// 4. A opens with Ah2h, C calls with TcJs and shoves the 9h8h7c flop; A calls and hits.
	play([][]string{{"Ah", "2h"}, {"3c", "4d"}, {"Tc", "Js"}}, []string{"9h", "8h", "7c", "3h", "4s"},
		replies{reply("RAISE", 30), reply("FOLD", 0), reply("CALL", 0), reply("ALL_IN", 0), reply("CALL", 0)})
	// 5. A opens aces, B calls kings, C folds; B shoves the turn drawing dead and A calls.
	play([][]string{{"As", "Ah"}, {"Ks", "Kh"}, {"4h", "5h"}}, []string{"Ac", "7d", "2c", "9s", "Qd"},
		replies{reply("RAISE", 30), reply("CALL", 0), reply("FOLD", 0),
			reply("CHECK", 0), reply("CHECK", 0), reply("ALL_IN", 0), reply("CALL", 0)})
	return hands
}

func TestStatsFromScriptedHands(t *testing.T) {
	hands := statsHands(t)
	wantNet := [][3]int{{35, -5, -30}, {20, -10, -10}, {0, -5, 5}, {2005, -5, -2000}, {2010, -2000, -10}}
	for i, h := range hands {
		for seat, want := range wantNet[i] {
			if got := h.Result.Net[string(rune('0'+seat))]; got != want {
				t.Fatalf("hand %d seat %d net %d, want %d (positions %v)", i+1, seat, got, want, h.Seats)
			}
		}
	}

	stats.WarmAIEV(hands, -1)
	s := stats.Compute(hands)
	m := map[string]stats.Model{}
	for _, x := range s.Models {
		m[x.Name] = x
	}
	a, b, c := m["A"], m["B"], m["C"]

	rate := func(who, stat string, got *float64, want float64) {
		t.Helper()
		if got == nil || math.Abs(*got-want) > 1e-9 {
			t.Errorf("%s %s = %v, want %v", who, stat, deref(got), want)
		}
	}
	null := func(who, stat string, got *float64) {
		t.Helper()
		if got != nil {
			t.Errorf("%s %s = %v, want null", who, stat, *got)
		}
	}

	// A: an ok preflop decision in 4 hands (hand 3 was a forced fold), voluntary in all 4,
	// raised in 1, 4, 5. C-bet chances in 1 (bet) and 5 (checked); in 4 C bet first.
	rate("A", "vpip", a.VPIP, 1)
	rate("A", "pfr", a.PFR, 0.75)
	null("A", "three_bet", a.ThreeBet)
	rate("A", "cbet", a.CBet, 0.5)
	null("A", "fold_to_cbet", a.FoldToCBet)
	rate("A", "af", a.AF, 0.5) // one bet, two calls postflop
	rate("A", "wtsd", a.WTSD, 0.75)
	rate("A", "wsd", a.WSD, 1)
	rate("A", "avg_bet_pct_pot", a.AvgBetPctPot, 40.0/65)
	rate("A", "fold_when_check_free", a.FoldCheckFree, 0)
	rate("A", "error_rate", a.ErrorRate, 1.0/12)
	rate("A", "retry_rate", a.RetryRate, 1.0/12)

	// B: folded to the open in 1 and 4, limped in 2, called in 5; hand 3 is excluded.
	rate("B", "vpip", b.VPIP, 0.5)
	rate("B", "pfr", b.PFR, 0)
	rate("B", "three_bet", b.ThreeBet, 0)
	rate("B", "wtsd", b.WTSD, 1)
	rate("B", "wsd", b.WSD, 0)
	rate("B", "fold_when_check_free", b.FoldCheckFree, 0)
	rate("B", "error_rate", b.ErrorRate, 1.0/10)

	// C: called in 1 and 4, folded in 2 (for free) and 5; faced A's c-bet once and folded.
	rate("C", "vpip", c.VPIP, 0.5)
	rate("C", "pfr", c.PFR, 0)
	rate("C", "three_bet", c.ThreeBet, 0)
	rate("C", "fold_to_cbet", c.FoldToCBet, 1)
	rate("C", "fold_when_check_free", c.FoldCheckFree, 1.0/3)
	rate("C", "wtsd", c.WTSD, 0.5)
	rate("C", "wsd", c.WSD, 0)
	null("C", "af", c.AF) // a shove and no calls

	if a.NetChips != 4070 || b.NetChips != -2025 || c.NetChips != -2045 {
		t.Errorf("net chips %d %d %d", a.NetChips, b.NetChips, c.NetChips)
	}
	if a.Hands != 5 || math.Abs(a.BB100-8140) > 1e-9 || a.ByPosition["BTN"].Hands != 5 || math.Abs(a.ByPosition["BTN"].BB100-8140) > 1e-9 {
		t.Errorf("A hands %d bb100 %v by position %+v", a.Hands, a.BB100, a.ByPosition)
	}
	if a.BiggestPotWon != 4010 || a.BiggestPotLost != 0 || c.BiggestPotLost != 4005 {
		t.Errorf("biggest pots: A won %d lost %d, C lost %d", a.BiggestPotWon, a.BiggestPotLost, c.BiggestPotLost)
	}
	if v := a.Vs["C"]; v != (stats.Vs{Pots: 2, NetChips: 2030, Hands: 5}) {
		t.Errorf("A vs C %+v", v)
	}
	if v := a.Vs["B"]; v != (stats.Vs{Pots: 2, NetChips: 2010, Hands: 5}) {
		t.Errorf("A vs B %+v", v)
	}
	// B and C never both put chips in, but were dealt in together every hand.
	if v := b.Vs["C"]; v != (stats.Vs{Hands: 5}) {
		t.Errorf("B vs C %+v", v)
	}

	// All-in EV. Hand 4: Ah2h has 362/990 of the 4005 pot after the flop shove (see
	// stats.TestEquityFlushDrawByCount). Hand 5: kings were dead, so it equals the result.
	wantA := 35 + 20 + 0 + (362.0/990*4005 - 2000) + 2010
	wantC := -30 - 10 + 5 + (628.0/990*4005 - 2000) - 10
	if math.Abs(a.AIEVBB100-wantA/10/5*100) > 1e-6 || math.Abs(c.AIEVBB100-wantC/10/5*100) > 1e-6 || b.AIEVBB100 != b.BB100 {
		t.Errorf("aiev bb100: A %v want %v, C %v want %v, B %v want %v", a.AIEVBB100, wantA*2, c.AIEVBB100, wantC*2, b.AIEVBB100, b.BB100)
	}

	// Property: the table's bb/100 and all-in EV bb/100 sum to zero.
	sum, aiev := 0.0, 0.0
	for _, x := range s.Models {
		sum += x.BB100
		aiev += x.AIEVBB100
	}
	if math.Abs(sum) > 1e-9 || math.Abs(aiev) > 1e-9 {
		t.Errorf("bb100 sums to %v, aiev to %v", sum, aiev)
	}

	if s.Scope.Hands != 5 || s.Scope.Sessions != 1 || s.Partial {
		t.Errorf("scope %+v partial %v", s.Scope, s.Partial)
	}
}

func deref(p *float64) any {
	if p == nil {
		return nil
	}
	return *p
}

func newTestCache(load func() ([]history.HandRecord, error)) *statsCache {
	return &statsCache{load: load, dirty: make(chan struct{}, 1), retryWait: time.Hour, seen: map[string]bool{}}
}

func (c *statsCache) get(url string) (int, stats.Stats) {
	w := httptest.NewRecorder()
	c.handle(w, httptest.NewRequest("GET", url, nil))
	var s stats.Stats
	json.Unmarshal(gunzip(w), &s)
	return w.Code, s
}

// gunzip is a stats answer's body; 503s are plain text.
func gunzip(w *httptest.ResponseRecorder) []byte {
	zr, err := gzip.NewReader(w.Body)
	if err != nil {
		return nil
	}
	b, _ := io.ReadAll(zr)
	return b
}

func waitFor(t *testing.T, what string, ok func() bool) {
	t.Helper()
	for deadline := time.Now().Add(5 * time.Second); !ok(); time.Sleep(5 * time.Millisecond) {
		if time.Now().After(deadline) {
			t.Fatal("timed out waiting for " + what)
		}
	}
}

// The stats of trimmed hands are the stats of the hands as saved.
func TestTrimHandKeepsWhatStatsRead(t *testing.T) {
	hands := statsHands(t)
	var trimmed []history.HandRecord
	for _, h := range hands {
		trimmed = append(trimmed, trimHand(h))
	}
	want, _ := json.Marshal(stats.Compute(hands))
	got, _ := json.Marshal(stats.Compute(trimmed))
	if string(got) != string(want) {
		t.Errorf("trimmed stats differ:\n%s\nwant\n%s", got, want)
	}
}

func TestStatsEndpoint(t *testing.T) {
	hands := statsHands(t)
	c := newTestCache(func() ([]history.HandRecord, error) { return hands[:4:4], nil })
	if code, _ := c.get("/api/stats"); code != http.StatusServiceUnavailable {
		t.Errorf("before the first load: %d", code)
	}

	c.seated = []string{"A", "B"}
	go c.run()
	c.Add(hands[4]) // a hand saved while loading is kept
	waitFor(t, "5 hands", func() bool { _, s := c.get("/api/stats"); return s.Scope.Hands == 5 })
	if _, s := c.get("/api/stats"); !reflect.DeepEqual(s.Seated, c.seated) || s.GeneratedAt.IsZero() {
		t.Errorf("all-time seated: %v, generated %v", s.Seated, s.GeneratedAt)
	}
}

func TestStatsStay503UntilALoadSucceeds(t *testing.T) {
	hands := statsHands(t)
	failed := make(chan struct{})
	calls := 0
	c := newTestCache(func() ([]history.HandRecord, error) {
		if calls++; calls == 1 {
			close(failed)
			return nil, fmt.Errorf("database down")
		}
		return hands, nil
	})
	c.retryWait = 200 * time.Millisecond
	go c.run()
	<-failed
	c.Add(hands[0]) // a hand saved meanwhile must not make the table look loaded
	time.Sleep(20 * time.Millisecond)
	if code, s := c.get("/api/stats"); code != http.StatusServiceUnavailable {
		t.Errorf("after a failed first load: %d with %d hands", code, s.Scope.Hands)
	}
	waitFor(t, "the retry", func() bool { _, s := c.get("/api/stats"); return s.Scope.Hands == 5 })
}

func TestStatsHandsInPlayOrder(t *testing.T) {
	hands := statsHands(t)
	start := time.Date(2026, 11, 1, 20, 0, 0, 0, time.UTC)
	for i := range hands {
		hands[i].StartedAt, hands[i].EndedAt = start.Add(time.Duration(i)*time.Minute), start.Add(time.Duration(i)*time.Minute+30*time.Second)
		if i < 2 {
			hands[i].TableID = "tbl_old"
		}
	}
	c := newTestCache(nil)
	for _, i := range []int{3, 1, 4, 0, 2} { // saved out of play order, as spill replays can be
		c.add(hands[i])
	}
	for i, h := range c.hands {
		if h.HandID != hands[i].HandID {
			t.Fatalf("hand %d is %s, want %s", i, h.HandID, hands[i].HandID)
		}
	}
	c.recompute()
	if _, all := c.get("/api/stats"); all.Scope.Hands != 5 || all.Scope.Sessions != 2 {
		t.Errorf("scope %+v", all.Scope)
	}
}

func (c *statsCache) getTimeline(url string) (int, stats.Timeline) {
	w := httptest.NewRecorder()
	c.handleTimeline(w, httptest.NewRequest("GET", url, nil))
	var tl stats.Timeline
	json.Unmarshal(gunzip(w), &tl)
	return w.Code, tl
}

func TestStatsTimelineByScopeAndGzip(t *testing.T) {
	hands := statsHands(t)
	for i := range hands[:2] {
		hands[i].TableID = "tbl_old"
	}
	c := newTestCache(nil)
	if code, _ := c.getTimeline("/api/stats/timeline"); code != http.StatusServiceUnavailable {
		t.Errorf("before the first load: %d", code)
	}
	for _, h := range hands {
		c.add(h)
	}
	c.recompute()

	// The timeline ends at /api/stats: the last profile row per model has its hands, and the
	// matchups add up to its vs.
	for _, url := range []string{""} {
		_, s := c.get("/api/stats" + url)
		code, tl := c.getTimeline("/api/stats/timeline" + url)
		if code != 200 || tl.Hands != s.Scope.Hands || tl.GeneratedAt.IsZero() || len(tl.Profiles.Fields) != 7 {
			t.Fatalf("%q: %d, %d hands, want %d", url, code, tl.Hands, s.Scope.Hands)
		}
		hands, net := map[string]float64{}, map[[2]string]int{}
		for _, r := range tl.Profiles.Rows {
			hands[tl.Models[int(r[1].(float64))]] = r[2].(float64)
		}
		for _, r := range tl.Matchups.Rows {
			a, b := tl.Models[r[1]], tl.Models[r[2]]
			net[[2]string{a, b}] += r[3]
			net[[2]string{b, a}] -= r[3]
		}
		for _, m := range s.Models {
			if hands[m.Name] != float64(m.Hands) {
				t.Errorf("%q %s: timeline ends at %v hands, stats %d", url, m.Name, hands[m.Name], m.Hands)
			}
			for other, v := range m.Vs {
				if net[[2]string{m.Name, other}] != v.NetChips {
					t.Errorf("%q %s vs %s: matchups %d, vs %d", url, m.Name, other, net[[2]string{m.Name, other}], v.NetChips)
				}
			}
		}
	}
	// Both endpoints send the JSON gzipped whatever Accept-Encoding says, so a client that
	// leaves it out cannot pull the raw body, five times the bytes.
	for _, url := range []string{"/api/stats", "/api/stats/timeline"} {
		for _, accept := range []string{"", "identity", "gzip, deflate, br"} {
			w := httptest.NewRecorder()
			r := httptest.NewRequest("GET", url, nil)
			if accept != "" {
				r.Header.Set("Accept-Encoding", accept)
			}
			timeline := strings.Contains(url, "timeline")
			c.serve(w, r, timeline)
			want := c.all
			if timeline {
				want = c.timeline
			}
			if w.Header().Get("Content-Encoding") != "gzip" || string(gunzip(w)) != string(want.json) || w.Body.Len() >= len(want.json) {
				t.Errorf("%s with %q: Content-Encoding %q, %d bytes for %d of JSON", url, accept, w.Header().Get("Content-Encoding"), w.Body.Len(), len(want.json))
			}
		}
	}
}

func TestLoadSupabaseHandsWithSmallRowCap(t *testing.T) {
	const total, cap = 1201, 500 // the server returns at most 500 rows whatever is asked
	var ranges []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ranges = append(ranges, r.Header.Get("Range"))
		var from, to int
		fmt.Sscanf(r.Header.Get("Range"), "%d-%d", &from, &to)
		rows := []string{}
		for i := from; i <= to && i < total && len(rows) < cap; i++ {
			rows = append(rows, fmt.Sprintf(`{"doc":{"hand_id":"h%d"}}`, i))
		}
		w.Write([]byte("[" + strings.Join(rows, ",") + "]"))
	}))
	defer srv.Close()

	hands, err := loadSupabaseHands(srv.URL, "k", time.Time{})
	if err != nil || len(hands) != total || hands[total-1].HandID != "h1200" {
		t.Fatalf("%d hands, %v", len(hands), err)
	}
	if want := []string{"0-999", "500-1499", "1000-1999", "1201-2200"}; strings.Join(ranges, ",") != strings.Join(want, ",") {
		t.Errorf("ranges %v, want %v", ranges, want)
	}
}

// After the first load, only hands saved since the last load are fetched, and they are added.
// The poll asks by save time: another writer's hand can start before this engine's newest
// hand yet land after the load, and asking by start time would never fetch it.
func TestStatsPollsOnlyNewHands(t *testing.T) {
	hands := statsHands(t)
	var mu sync.Mutex
	loads, since := 0, []time.Time{}
	c := newTestCache(func() ([]history.HandRecord, error) {
		mu.Lock()
		defer mu.Unlock()
		loads++
		return hands[:2:2], nil
	})
	c.loadSince = func(s time.Time) ([]history.HandRecord, error) {
		mu.Lock()
		defer mu.Unlock()
		since = append(since, s)
		if len(since) == 1 {
			return nil, nil
		}
		return []history.HandRecord{hands[2], hands[3]}, nil // the other writer's late hand, and ours again
	}
	c.pollEvery = 20 * time.Millisecond
	c.seated = []string{"A", "B"}
	start := time.Now()
	go c.run()
	waitFor(t, "2 hands", func() bool { _, s := c.get("/api/stats"); return s.Scope.Hands == 2 })
	c.Add(hands[3]) // this engine's own hand, started after hands[2]
	waitFor(t, "4 hands", func() bool { _, s := c.get("/api/stats"); return s.Scope.Hands == 4 })
	time.Sleep(60 * time.Millisecond) // more polls: nothing new, nothing added twice
	mu.Lock()
	defer mu.Unlock()
	if _, s := c.get("/api/stats"); s.Scope.Hands != 4 || loads != 1 {
		t.Errorf("%d hands after %d full loads, want 4 after 1", s.Scope.Hands, loads)
	}
	if len(since) < 2 || since[0].Before(start.Add(-time.Minute)) || since[0].After(time.Now().Add(-time.Minute)) {
		t.Fatalf("polled since %v, want a minute before the load at %v", since, start)
	}
	for i := 1; i < len(since); i++ {
		if since[i].Before(since[i-1]) {
			t.Errorf("polled since %v, want each poll to start where the last one did", since)
		}
	}
}

func TestSupabaseHandsSince(t *testing.T) {
	var queries []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		queries = append(queries, r.URL.RawQuery)
		w.Write([]byte("[]"))
	}))
	defer srv.Close()
	since := time.Date(2026, 11, 9, 20, 56, 46, 280093000, time.FixedZone("EST", -5*3600))
	if _, err := loadSupabaseHands(srv.URL, "k", since); err != nil {
		t.Fatal(err)
	}
	if len(queries) != 1 || !strings.Contains(queries[0], "created_at=gte.2026-11-10T01%3A56%3A46.280093Z") {
		t.Errorf("queries %v", queries)
	}
}

// TestStatsEventSize logs the bytes of one per-hand stats event, for the Numbers in
// docs/system-design.md: 2,000 hands (the dataset fixture's 40 nine-handed hands, cycled),
// then one more. Run it with go test -run TestStatsEventSize -v ./api/.
func TestStatsEventSize(t *testing.T) {
	f, err := os.Open("../../dataset/tests/fixtures/generated/hands.jsonl")
	if err != nil {
		t.Skip(err)
	}
	fixture, err := history.ReadHands(f)
	f.Close()
	if err != nil {
		t.Fatal(err)
	}
	// Hands that end all-in before the river are left out: each copy would be worked out again.
	fixture = slices.DeleteFunc(fixture, func(h history.HandRecord) bool {
		return len(h.Result.Showdown) > 1 && h.Actions[len(h.Actions)-1].Street != "river"
	})
	c := newTestCache(nil)
	c.hub = newHub()
	start := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	for i := range 2001 {
		h := fixture[i%len(fixture)]
		h.HandID, h.StartedAt = fmt.Sprintf("size-%06d", i), start.Add(time.Duration(i)*time.Minute)
		c.add(h)
		if i == 1999 {
			c.recompute()
		}
	}
	c.recompute()
	frames := c.hub.since(0, false).frames
	t.Logf("full stats frame %d bytes; per-hand stats event %d bytes", len(frames[0]), len(frames[len(frames)-1]))
}

// Over many random hands saved the way the table saves them, the stats lose no chip: the
// models' nets add up to zero, and so do their all-in EV results once every all-in is worked out.
func TestStatsOfRandomHandsAddUp(t *testing.T) {
	hands := playRandomHands(t, 5, 2)
	stats.WarmAIEV(hands, -1)
	s := stats.Compute(hands)
	net, aiev := 0, 0.0
	for _, m := range s.Models {
		net += m.NetChips
		aiev += m.AIEVBB100 * float64(m.Hands) / 100
	}
	if s.Partial || net != 0 || math.Abs(aiev) > 1e-6 {
		t.Errorf("partial %v, nets add up to %d chips, all-in EV to %.9f BB; want false, 0, 0", s.Partial, net, aiev)
	}
}
