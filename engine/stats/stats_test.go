package stats

import (
	"math"
	"testing"

	"github.com/rizzwareengineer/no-LLMit/engine/game"
)

func cards(t *testing.T, ss ...string) []game.Card {
	t.Helper()
	cs, err := parseCards(ss)
	if err != nil {
		t.Fatal(err)
	}
	return cs
}

func near(a, b float64) bool { return math.Abs(a-b) < 1e-9 }

func TestCI95OnFixedSample(t *testing.T) {
	// Mean 2.5, sample sd √(5/3), so the half width is 1.96 × √(5/3) / 2.
	ci := ci95([]float64{1, 2, 3, 4})
	half := 1.96 * math.Sqrt(5.0/3) / 2
	if ci == nil || !near(ci[0], 100*(2.5-half)) || !near(ci[1], 100*(2.5+half)) {
		t.Errorf("ci95 = %v, want [%.4f, %.4f]", ci, 100*(2.5-half), 100*(2.5+half))
	}
	if ci95([]float64{3}) != nil {
		t.Error("one hand has no interval")
	}
}

func TestCurveDownsampling(t *testing.T) {
	short := curve([]float64{1, -2, 0.5})
	if len(short) != 4 || short[0] != [2]float64{0, 0} || short[3] != [2]float64{3, -0.5} {
		t.Errorf("short curve: %v", short)
	}
	for _, n := range []int{199, 200, 1000, 1001, 12345} {
		bbs := make([]float64, n)
		for i := range bbs {
			bbs[i] = 1
		}
		c := curve(bbs)
		if len(c) > maxCurvePoints || c[0] != [2]float64{0, 0} || c[len(c)-1] != [2]float64{float64(n), float64(n)} {
			t.Errorf("n=%d: %d points, first %v, last %v", n, len(c), c[0], c[len(c)-1])
		}
		for i := 1; i < len(c); i++ {
			if c[i][0] <= c[i-1][0] || c[i][1] != c[i][0] {
				t.Fatalf("n=%d: point %d is %v after %v", n, i, c[i], c[i-1])
			}
		}
	}
}

func TestEquityAcesVsKingsDeadOnTurn(t *testing.T) {
	// Aces have a set; kings can only make a smaller set, so they are drawing dead.
	eq := equity([][]game.Card{cards(t, "As", "Ah"), cards(t, "Ks", "Kh")}, cards(t, "Ac", "7d", "2c", "9s"))
	if eq[0] != 1 || eq[1] != 0 {
		t.Errorf("equity = %v, want [1 0]", eq)
	}
}

func TestEquityFlushDrawByCount(t *testing.T) {
	// Ah2h on 9h8h7c against a made jack-high straight (TcJs). Of the 990 turn and river
	// pairs, the flush hits in 990 - C(36,2) = 360; a non-heart ten and jack (TsJc, TsJd,
	// TdJc, TdJd) puts the straight on the board for a split in 4; the straight wins 626.
	eq := equity([][]game.Card{cards(t, "Ah", "2h"), cards(t, "Tc", "Js")}, cards(t, "9h", "8h", "7c"))
	if !near(eq[0], 362.0/990) || !near(eq[1], 628.0/990) {
		t.Errorf("equity = %v, want [%v %v]", eq, 362.0/990, 628.0/990)
	}
}

func TestEquityPreflopIsSeededAndClose(t *testing.T) {
	holes := [][]game.Card{cards(t, "As", "Ah"), cards(t, "Ks", "Kh")}
	a, b := equity(holes, nil), equity(holes, nil)
	// AA vs KK with no shared suits is about 82%; 10k samples are within ±1.5% at 4 sd.
	if a[0] != b[0] || math.Abs(a[0]-0.82) > 0.015 || !near(a[0]+a[1], 1) {
		t.Errorf("preflop equity %v then %v", a, b)
	}
}

func TestBuildPotsWithSidePot(t *testing.T) {
	// Seat 1 is all-in for 100, seats 2 and 3 put in 300, seat 4 folded after 50.
	pots := buildPots(map[int]float64{1: 100, 2: 300, 3: 300, 4: 50}, []int{1, 2, 3})
	if len(pots) != 2 || pots[0].amount != 350 || len(pots[0].eligible) != 3 || pots[1].amount != 400 || len(pots[1].eligible) != 2 {
		t.Errorf("pots = %+v", pots)
	}
}
