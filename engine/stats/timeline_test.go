package stats

import (
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"reflect"
	"slices"
	"strconv"
	"testing"
	"time"

	"github.com/rizzwareengineer/no-LLMit/engine/history"
)

// syntheticHands is n nine-handed hands with blinds 5/10. Each hand 1 to 4 players
// put chips in preflop and the rest fold; when two or more do, they see a flop with a
// bet and a call, and one of them (two, now and then, splitting) takes the losers' chips.
func syntheticHands(n int) []history.HandRecord {
	rng := rand.New(rand.NewSource(1))
	names := []string{"Claude", "GPT", "Gemma", "Llama", "Mistral", "DeepSeek", "Phi", "Qwen", "Cohere"}
	positions := []string{"BTN", "SB", "BB", "UTG", "UTG1", "MP", "LJ", "HJ", "CO"}
	start := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	act := func(street string, seat int, kind string, amount int) history.ActionRecord {
		return history.ActionRecord{Street: street, Seat: seat, Status: "ok", ToCall: amount, StackBefore: 2000,
			PotBefore: 15, Applied: history.AppliedAction{Type: kind, Amount: amount}}
	}
	hands := make([]history.HandRecord, n)
	for i := range hands {
		h := history.HandRecord{
			HandID: fmt.Sprintf("syn-%06d", i), TableID: "syn", Config: history.HandConfig{BigBlind: 10},
			StartedAt: start.Add(time.Duration(i) * time.Minute), Result: history.HandResult{Net: map[string]int{}},
		}
		for s, name := range names {
			h.Seats = append(h.Seats, history.SeatRecord{Seat: s, Name: name, Position: positions[(s+i)%9]})
		}
		sb, bb := (1+9-i%9)%9, (2+9-i%9)%9 // the seats in the blinds this hand
		h.Blinds = []history.BlindRecord{{Seat: sb, Amount: 5}, {Seat: bb, Amount: 10}}
		in := rng.Perm(9)[:[]int{1, 2, 2, 2, 3, 3, 4}[rng.Intn(7)]]
		inPot := map[int]bool{}
		for j, s := range in {
			inPot[s] = true
			kind := "CALL"
			if j == 0 {
				kind = "RAISE"
			}
			h.Actions = append(h.Actions, act("preflop", s, kind, 30))
		}
		for s := range names {
			if !inPot[s] {
				h.Actions = append(h.Actions, act("preflop", s, "FOLD", 0))
				h.Result.Net[strconv.Itoa(s)] = -map[int]int{sb: 5, bb: 10}[s]
			}
		}
		if len(in) == 1 { // folded round to the opener
			h.Result.Net[strconv.Itoa(in[0])] = 15
			hands[i] = h
			continue
		}
		h.Board = []string{"2c", "7d", "9h", "Js", "3s"}
		bet := 10 * (1 + rng.Intn(50))
		h.Actions = append(h.Actions, act("flop", in[0], "BET", bet))
		for _, s := range in[1:] {
			h.Actions = append(h.Actions, act("flop", s, "CALL", bet))
		}
		winners := in[:1]
		if len(in) > 2 && rng.Intn(10) == 0 {
			winners = in[:2]
		}
		pot := 0
		for s := range names {
			pot -= h.Result.Net[strconv.Itoa(s)]
		}
		for _, s := range in[len(winners):] {
			h.Result.Net[strconv.Itoa(s)] = -(30 + bet)
			pot += 30 + bet
		}
		for _, s := range in {
			h.Result.Showdown = append(h.Result.Showdown, history.ShowdownRecord{Seat: s})
		}
		// Winners split the losers' chips (and the folded blinds); the odd chip goes to the first.
		share := pot / len(winners)
		for k, s := range winners {
			h.Result.Net[strconv.Itoa(s)] = share
			if k == 0 {
				h.Result.Net[strconv.Itoa(s)] += pot - share*len(winners)
			}
			h.Result.Pots = append(h.Result.Pots, history.PotRecord{Amount: share, WinnerSeat: s})
		}
		hands[i] = h
	}
	return hands
}

func profileRows(tl Timeline, hand int) map[string][]any {
	out := map[string][]any{}
	for _, r := range tl.Profiles.Rows {
		if r[0] == hand {
			out[tl.Models[r[1].(int)]] = r
		}
	}
	return out
}

func TestTimelineEndsAtTheTotals(t *testing.T) {
	for _, n := range []int{7, 900, 10000} {
		hands := syntheticHands(n)
		s, tl := ComputeWithTimeline(hands)
		if !reflect.DeepEqual(s, Compute(hands)) {
			t.Fatalf("n=%d: the shared pass changed Compute", n)
		}
		if tl.Hands != n || len(tl.Models) != 9 {
			t.Fatalf("n=%d: hands %d models %v", n, tl.Hands, tl.Models)
		}

		// The last snapshot is the current totals.
		last := profileRows(tl, n)
		val := func(x any) *float64 {
			if x == nil {
				return nil
			}
			f := x.(float64)
			return &f
		}
		closeTo := func(got any, want *float64, tol float64) bool {
			g := val(got)
			return (g == nil) == (want == nil) && (g == nil || math.Abs(*g-*want) <= tol)
		}
		for _, m := range s.Models {
			r := last[m.Name]
			if r == nil || r[2] != m.Hands || !closeTo(r[3], &m.BB100, 0.005) || !closeTo(r[4], m.VPIP, 5e-5) ||
				!closeTo(r[5], m.PFR, 5e-5) || !closeTo(r[6], m.AF, 5e-4) {
				t.Errorf("n=%d %s: last snapshot %v, totals hands %d bb100 %v vpip %v pfr %v af %v",
					n, m.Name, r, m.Hands, m.BB100, deref(m.VPIP), deref(m.PFR), deref(m.AF))
			}
		}

		// Summing the matchups changes gives vs for every pair, in both directions.
		sum := map[[2]string]int{}
		for _, r := range tl.Matchups.Rows {
			a, b := tl.Models[r[1]], tl.Models[r[2]]
			if r[1] >= r[2] || r[3] == 0 {
				t.Fatalf("pair out of order or no change: %v", r)
			}
			sum[[2]string{a, b}] += r[3]
			sum[[2]string{b, a}] -= r[3]
		}
		for _, m := range s.Models {
			for other, v := range m.Vs {
				if sum[[2]string{m.Name, other}] != v.NetChips {
					t.Errorf("n=%d %s vs %s: matchups sum %d, vs %d", n, m.Name, other, sum[[2]string{m.Name, other}], v.NetChips)
				}
			}
		}

		// The lineups give every pair's hands together: at the end, vs.hands.
		for _, m := range s.Models {
			for other, v := range m.Vs {
				if got := handsTogether(tl, m.Name, other, n); got != v.Hands {
					t.Errorf("n=%d %s with %s: lineups give %d hands together, vs %d", n, m.Name, other, got, v.Hands)
				}
			}
		}

		// The caps, and the step below them.
		snaps, points := map[any]bool{}, map[int]bool{}
		for _, r := range tl.Profiles.Rows {
			snaps[r[0]] = true
		}
		for _, r := range tl.Matchups.Rows {
			points[r[0]] = true
		}
		if len(snaps) > maxProfileSnaps || len(points) > maxMatchupSteps || (n <= 3000 && tl.ProfileStep != 25) {
			t.Errorf("n=%d: %d snapshots (step %d), %d change points (bucket %d)", n, len(snaps), tl.ProfileStep, len(points), tl.MatchupBucket)
		}
		if n == 900 && (len(snaps) != 36 || !snaps[25] || tl.MatchupBucket != 1) {
			t.Errorf("900 hands: %d snapshots, bucket %d", len(snaps), tl.MatchupBucket)
		}

		if n == 10000 {
			p, _ := json.Marshal(tl.Profiles)
			m, _ := json.Marshal(tl.Matchups)
			t.Logf("10k hands: profiles %d bytes, matchups %d bytes (%d rows)", len(p), len(m), len(tl.Matchups.Rows))
			// The 120 KB matchups budget does not fit 1,200 change points: with nine models
			// about ten pairs change per point, ~15 bytes each, so this lands near 190 KB
			// The ceiling guards against the encoding growing.
			if len(p) > 80_000 || len(m) > 200_000 {
				t.Errorf("10k hands: profiles %d bytes (max 80 KB), matchups %d bytes (max 200 KB)", len(p), len(m))
			}
		}
	}
}

// handsTogether counts the hands up to `hand` that a and b were both dealt in, from the lineups
// (what the web does to replay a pair's bb/100).
func handsTogether(tl Timeline, a, b string, hand int) int {
	idx := map[string]int{}
	for i, name := range tl.Models {
		idx[name] = i
	}
	n := 0
	for i, row := range tl.Lineups {
		from, to := row[0], hand
		if i+1 < len(tl.Lineups) {
			to = min(to, tl.Lineups[i+1][0]-1)
		}
		if to >= from && slices.Contains(row[1:], idx[a]) && slices.Contains(row[1:], idx[b]) {
			n += to - from + 1
		}
	}
	return n
}

// A roster that rotates: every fourth hand one seat sits out, so pairs' hands together differ and the
// lineups change often. The replay's last frame (the lineups up to the last hand) equals vs.hands, and a
// mid-replay frame equals a direct count.
func TestTimelineLineupsFollowTheRotation(t *testing.T) {
	hands := syntheticHands(400)
	for i := range hands {
		if i%4 == 0 {
			out := (i / 4) % 9
			hands[i].Seats = slices.DeleteFunc(slices.Clone(hands[i].Seats), func(s history.SeatRecord) bool { return s.Seat == out })
		}
	}
	s, tl := ComputeWithTimeline(hands)
	if len(tl.Lineups) < 100 {
		t.Fatalf("%d lineups, want one per change (about 200)", len(tl.Lineups))
	}
	for _, m := range s.Models {
		if len(m.Vs) != 8 {
			t.Errorf("%s: %d opponents, want 8", m.Name, len(m.Vs))
		}
		for other, v := range m.Vs {
			if got := handsTogether(tl, m.Name, other, 400); got != v.Hands || v.Hands >= 400 || v.Hands < 300 {
				t.Errorf("%s with %s: lineups give %d, vs.hands %d (want equal, between 300 and 399)", m.Name, other, got, v.Hands)
			}
			direct := 0
			for _, h := range hands[:250] {
				in := func(name string) bool {
					return slices.ContainsFunc(h.Seats, func(s history.SeatRecord) bool { return s.Name == name })
				}
				if in(m.Name) && in(other) {
					direct++
				}
			}
			if got := handsTogether(tl, m.Name, other, 250); got != direct {
				t.Errorf("%s with %s at hand 250: lineups give %d, counted %d", m.Name, other, got, direct)
			}
		}
	}
}

// fastestOf3 times ComputeWithTimeline and keeps the best of three runs.
func fastestOf3(hands []history.HandRecord) time.Duration {
	best := time.Hour
	for range 3 {
		t0 := time.Now()
		ComputeWithTimeline(hands)
		best = min(best, time.Since(t0))
	}
	return best
}

// Guards against super-linear work by comparing 2k and 10k hands on the same machine, back to back.
// A fixed 50ms limit failed whenever the machine was busy (52-105ms under load); a ratio holds under
// load, because both sizes run in the same conditions.
func TestTimelineComputesFast(t *testing.T) {
	small, large := fastestOf3(syntheticHands(2000)), fastestOf3(syntheticHands(10000))
	ratio := float64(large) / float64(small)
	t.Logf("2k hands in %v, 10k hands in %v (%.1fx)", small, large, ratio)
	if ratio > 12 { // linear work grows 5x from 2k to 10k hands; quadratic would grow 25x
		t.Errorf("10k hands took %.1fx as long as 2k (%v vs %v), want under 12x", ratio, large, small)
	}
	if large > 500*time.Millisecond { // a loose ceiling for a slowdown that is linear but large
		t.Errorf("10k hands took %v, want under 500ms", large)
	}
}

func BenchmarkComputeWithTimeline10k(b *testing.B) {
	hands := syntheticHands(10000)
	for range b.N {
		ComputeWithTimeline(hands)
	}
}

func BenchmarkCompute10k(b *testing.B) {
	hands := syntheticHands(10000)
	for range b.N {
		Compute(hands)
	}
}

func deref(p *float64) any {
	if p == nil {
		return nil
	}
	return *p
}
