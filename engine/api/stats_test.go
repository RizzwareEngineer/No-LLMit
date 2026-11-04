package api

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
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
	bad := reply("FOLD", 0)
	bad.Status = "unparseable"
	var hands []history.HandRecord
	play := func(holes [][]string, board []string, script replies) {
		h, _ := playDealt(t, holes, board, script)
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
	play(nil, nil, replies{reply("RAISE", 12), reply("RAISE", 12), bad, bad})
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
	if a.Hands != 5 || a.Decisions != 12 || math.Abs(a.BB100-8140) > 1e-9 || a.ByPosition["BTN"].Hands != 5 || math.Abs(a.ByPosition["BTN"].BB100-8140) > 1e-9 {
		t.Errorf("A hands %d decisions %d bb100 %v by position %+v", a.Hands, a.Decisions, a.BB100, a.ByPosition)
	}
	if a.BiggestPotWon != 4010 || a.BiggestPotLost != 0 || c.BiggestPotLost != 4005 {
		t.Errorf("biggest pots: A won %d lost %d, C lost %d", a.BiggestPotWon, a.BiggestPotLost, c.BiggestPotLost)
	}
	if v := a.Vs["C"]; v != (stats.Vs{Pots: 2, NetChips: 2030}) {
		t.Errorf("A vs C %+v", v)
	}
	if v := a.Vs["B"]; v != (stats.Vs{Pots: 2, NetChips: 2010}) {
		t.Errorf("A vs B %+v", v)
	}
	if _, ok := b.Vs["C"]; ok {
		t.Errorf("B and C never both put chips in: %+v", b.Vs)
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

	if s.Scope.Hands != 5 || len(s.Sessions) != 1 || s.Sessions[0].ID != "tbl_test" || s.Sessions[0].EndedAt == nil || s.Partial {
		t.Errorf("scope %+v sessions %+v", s.Scope, s.Sessions)
	}
}

func deref(p *float64) any {
	if p == nil {
		return nil
	}
	return *p
}

func newTestCache(load func() ([]history.HandRecord, error)) *statsCache {
	return &statsCache{load: load, dirty: make(chan struct{}, 1), retryWait: time.Hour, seen: map[string]bool{}, changed: map[string]bool{}}
}

func (c *statsCache) get(url string) (int, stats.Stats) {
	w := httptest.NewRecorder()
	c.handle(w, httptest.NewRequest("GET", url, nil))
	var s stats.Stats
	json.Unmarshal(w.Body.Bytes(), &s)
	return w.Code, s
}

func waitFor(t *testing.T, what string, ok func() bool) {
	t.Helper()
	for deadline := time.Now().Add(5 * time.Second); !ok(); time.Sleep(5 * time.Millisecond) {
		if time.Now().After(deadline) {
			t.Fatal("timed out waiting for " + what)
		}
	}
}

func TestStatsEndpoint(t *testing.T) {
	hands := statsHands(t)
	c := newTestCache(func() ([]history.HandRecord, error) { return hands[:4:4], nil })
	if code, _ := c.get("/api/stats"); code != http.StatusServiceUnavailable {
		t.Errorf("before the first load: %d", code)
	}

	go c.run()
	c.Add(hands[4]) // a hand saved while loading is kept
	waitFor(t, "5 hands", func() bool { _, s := c.get("/api/stats"); return s.Scope.Hands == 5 })
	if code, s := c.get("/api/stats?session=tbl_test"); code != 200 || s.Scope.Hands != 5 || s.GeneratedAt.IsZero() {
		t.Errorf("session: %d %+v", code, s.Scope)
	}
	if code, _ := c.get("/api/stats?session=nope"); code != http.StatusNotFound {
		t.Errorf("unknown session: %d", code)
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

func TestStatsSessionsInPlayOrderAndLiveOnlyLast(t *testing.T) {
	hands := statsHands(t)
	start := time.Date(2026, 11, 1, 20, 0, 0, 0, time.UTC)
	for i := range hands {
		hands[i].StartedAt, hands[i].EndedAt = start.Add(time.Duration(i)*time.Minute), start.Add(time.Duration(i)*time.Minute+30*time.Second)
		if i < 2 {
			hands[i].TableID = "tbl_old"
		}
	}
	c := newTestCache(nil)
	for _, i := range []int{3, 1, 4, 0} { // saved out of play order, as spill replays can be
		c.add(hands[i])
	}
	c.recompute(true)

	session := func(id string) stats.Session {
		_, s := c.get("/api/stats?session=" + id)
		return s.Sessions[0]
	}
	if old := session("tbl_old"); old.EndedAt == nil || !old.StartedAt.Equal(hands[0].StartedAt) || !old.EndedAt.Equal(hands[1].EndedAt) {
		t.Errorf("finished session: %+v", old)
	}
	if cur := session("tbl_test"); cur.EndedAt != nil || !cur.StartedAt.Equal(hands[3].StartedAt) {
		t.Errorf("live session: %+v", cur)
	}
	if _, all := c.get("/api/stats"); len(all.Sessions) != 2 || all.Sessions[0].ID != "tbl_old" || all.Sessions[0].EndedAt == nil || all.Sessions[1].EndedAt != nil {
		t.Errorf("all-time sessions: %+v", all.Sessions)
	}

	// A new hand re-encodes the live session and all-time, not the finished one.
	c.mu.Lock()
	oldBytes := string(c.bySession["tbl_old"])
	c.mu.Unlock()
	time.Sleep(time.Millisecond) // so a re-encode would carry a new generated_at
	c.add(hands[2])
	c.recompute(false)
	if _, all := c.get("/api/stats"); all.Scope.Hands != 5 {
		t.Errorf("all-time hands %d", all.Scope.Hands)
	}
	c.mu.Lock()
	unchanged := string(c.bySession["tbl_old"]) == oldBytes
	c.mu.Unlock()
	if !unchanged {
		t.Error("finished session was recomputed for a hand in another session")
	}
	if cur := session("tbl_test"); cur.Hands != 3 {
		t.Errorf("live session hands %d", cur.Hands)
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

	hands, err := loadSupabaseHands(srv.URL, "k")
	if err != nil || len(hands) != total || hands[total-1].HandID != "h1200" {
		t.Fatalf("%d hands, %v", len(hands), err)
	}
	if want := []string{"0-999", "500-1499", "1000-1999", "1201-2200"}; strings.Join(ranges, ",") != strings.Join(want, ",") {
		t.Errorf("ranges %v, want %v", ranges, want)
	}
}
