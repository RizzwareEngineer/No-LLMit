package stats

import (
	"math"
	"sort"
	"time"

	"github.com/rizzwareengineer/no-LLMit/engine/history"
)

// Timeline is GET /api/stats/timeline: Profiles and Matchups as of past hands, so the web
// can replay them in step with the race chart. Models are indexes into Models.
type Timeline struct {
	GeneratedAt   time.Time     `json:"generated_at"`
	Hands         int           `json:"hands"`
	Models        []string      `json:"models"`         // by name
	ProfileStep   int           `json:"profile_step"`   // hands between profile snapshots
	MatchupBucket int           `json:"matchup_bucket"` // hands summed into one matchups change point
	Profiles      Table[[]any]  `json:"profiles"`       // hand, model, hands, bb100, vpip, pfr, af
	Matchups      Table[[4]int] `json:"matchups"`       // hand, a, b, chips
}

// Table is rows of values in the order of Fields, rather than repeating object keys.
type Table[R any] struct {
	Fields []string `json:"fields"`
	Rows   []R      `json:"rows"`
}

const (
	profileStep     = 25
	maxProfileSnaps = 120
	maxMatchupSteps = 1200
)

type timelineBuilder struct {
	n       int
	tl      Timeline
	index   map[string]int
	touched []bool         // by model: in a hand since the last matchups change point
	sent    map[[2]int]int // per pair, the running net already sent
}

func newTimelineBuilder(hands []history.HandRecord) *timelineBuilder {
	n := len(hands)
	b := &timelineBuilder{n: n, index: map[string]int{}, sent: map[[2]int]int{}}
	for _, h := range hands {
		for _, s := range h.Seats {
			if _, ok := b.index[s.Name]; !ok {
				b.index[s.Name] = 0
				b.tl.Models = append(b.tl.Models, s.Name)
			}
		}
	}
	sort.Strings(b.tl.Models)
	for i, name := range b.tl.Models {
		b.index[name] = i
	}
	b.touched = make([]bool, len(b.tl.Models))
	b.tl.Hands = n
	b.tl.ProfileStep = profileStep
	if n > profileStep*maxProfileSnaps {
		b.tl.ProfileStep = ceilDiv(n, maxProfileSnaps)
	}
	b.tl.MatchupBucket = max(1, ceilDiv(n, maxMatchupSteps))
	b.tl.Profiles = Table[[]any]{Fields: []string{"hand", "model", "hands", "bb100", "vpip", "pfr", "af"}, Rows: [][]any{}}
	b.tl.Matchups = Table[[4]int]{Fields: []string{"hand", "a", "b", "chips"}, Rows: [][4]int{}}
	return b
}

func ceilDiv(a, b int) int { return (a + b - 1) / b }

// after records the state once hand i (0-based) has been added to accs.
func (b *timelineBuilder) after(i int, h history.HandRecord, accs map[string]*acc) {
	hand, last := i+1, i == b.n-1
	for _, s := range h.Seats {
		b.touched[b.index[s.Name]] = true
	}

	if hand%b.tl.MatchupBucket == 0 || last {
		var ms []int
		for m, t := range b.touched {
			if t {
				ms = append(ms, m)
			}
		}
		for x, ma := range ms {
			for _, mb := range ms[x+1:] {
				v := accs[b.tl.Models[ma]].vs[b.tl.Models[mb]]
				if v == nil {
					continue
				}
				// Sending the change in the rounded running total makes the changes add up
				// to vs.net_chips exactly, which rounds the same running total.
				key := [2]int{ma, mb}
				if d := int(math.Round(v.net)) - b.sent[key]; d != 0 {
					b.sent[key] += d
					b.tl.Matchups.Rows = append(b.tl.Matchups.Rows, [4]int{hand, ma, mb, d})
				}
			}
		}
		clear(b.touched)
	}

	if hand%b.tl.ProfileStep == 0 || last {
		for m, name := range b.tl.Models {
			a := accs[name]
			if a == nil {
				continue // not seated yet
			}
			b.tl.Profiles.Rows = append(b.tl.Profiles.Rows, []any{hand, m, len(a.bbs), round(a.bb100(), 2),
				roundPtr(a.vpip.rate(), 4), roundPtr(a.pfr.rate(), 4), roundPtr(a.af(), 3)})
		}
	}
}

func (b *timelineBuilder) result() Timeline { return b.tl }

func round(x float64, places int) float64 {
	p := math.Pow10(places)
	return math.Round(x*p) / p
}

// roundPtr is nil (JSON null) for a rate with nothing to count.
func roundPtr(x *float64, places int) any {
	if x == nil {
		return nil
	}
	return round(*x, places)
}
