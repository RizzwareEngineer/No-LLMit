// Turns saved hands into the per-model statistics served at GET /api/stats. The shape
// is docs/stats-api-contract.json; every formula is written out in docs/stats.md.
package stats

import (
	"math"
	"sort"
	"time"

	"github.com/rizzwareengineer/no-LLMit/engine/history"
)

type Stats struct {
	GeneratedAt time.Time `json:"generated_at"`
	Scope       Scope     `json:"scope"`
	Sessions    []Session `json:"sessions"`
	Models      []Model   `json:"models"`
	// Seated is the table's current lineup, set by the engine; absent until it knows it.
	Seated []string `json:"seated,omitempty"`
	// Partial is true while some all-ins are still being worked out; those hands count at
	// their actual result in aiev_bb100 until then.
	Partial bool `json:"partial"`
}

type Scope struct {
	TableID       string `json:"table_id"`
	PromptVersion string `json:"prompt_version"`
	BigBlind      int    `json:"big_blind"`
	Hands         int    `json:"hands"`
	Sessions      int    `json:"sessions"`
}

type Session struct {
	ID        string     `json:"id"`
	StartedAt time.Time  `json:"started_at"`
	EndedAt   *time.Time `json:"ended_at"` // the caller sets null for the session still being played
	Hands     int        `json:"hands"`
}

// Rates are null when nothing qualified for them (for example c-bet with no c-bet chance).
type Model struct {
	Name           string              `json:"name"`
	Model          string              `json:"model"`
	Hands          int                 `json:"hands"`
	NetChips       int                 `json:"net_chips"`
	BB100          float64             `json:"bb100"`
	BB100CI        *[2]float64         `json:"bb100_ci"`
	AIEVBB100      float64             `json:"aiev_bb100"`
	VPIP           *float64            `json:"vpip"`
	PFR            *float64            `json:"pfr"`
	ThreeBet       *float64            `json:"three_bet"`
	AF             *float64            `json:"af"`
	CBet           *float64            `json:"cbet"`
	FoldToCBet     *float64            `json:"fold_to_cbet"`
	WTSD           *float64            `json:"wtsd"`
	WSD            *float64            `json:"wsd"`
	AvgBetPctPot   *float64            `json:"avg_bet_pct_pot"`
	FoldCheckFree  *float64            `json:"fold_when_check_free"`
	ErrorRate      *float64            `json:"error_rate"`
	RetryRate      *float64            `json:"retry_rate"`
	MissRate       *float64            `json:"miss_rate"`
	AvgLatencyMs   int                 `json:"avg_latency_ms"`
	CostUSD        float64             `json:"cost_usd"`
	BiggestPotWon  int                 `json:"biggest_pot_won"`
	BiggestPotLost int                 `json:"biggest_pot_lost"`
	ByPosition     map[string]Position `json:"by_position"`
	CumulativeBB   [][2]float64        `json:"cumulative_bb"`
	// The same curve scored by all-in EV: a hand that ended all-in counts its equity share, not the runout.
	CumulativeAIEVBB [][2]float64  `json:"cumulative_aiev_bb"`
	Vs               map[string]Vs `json:"vs"`
}

type Position struct {
	Hands int      `json:"hands"`
	VPIP  *float64 `json:"vpip"`
	PFR   *float64 `json:"pfr"`
	BB100 float64  `json:"bb100"`
}

type Vs struct {
	Pots     int `json:"pots"`
	NetChips int `json:"net_chips"`
	Hands    int `json:"hands"` // hands both were dealt in
}

// SessionID is the session a hand belongs to. Until there is a sessions table, each
// table id is one session.
func SessionID(h history.HandRecord) string { return h.TableID }

const maxCurvePoints = 200

// count is a numerator over a denominator; its rate is null when the denominator is 0.
type count struct{ n, d float64 }

func (c *count) add(hit bool) {
	c.d++
	if hit {
		c.n++
	}
}

func (c count) rate() *float64 {
	if c.d == 0 {
		return nil
	}
	r := c.n / c.d
	return &r
}

type acc struct {
	name, model                       string
	bbs, aievBBs                      []float64 // per hand, in big blinds
	bbSum                             float64   // of bbs, added in the same order mean would
	net                               int
	vpip, pfr, threeBet, cbet, ftc    count
	wtsd, wsd, checkFree, errs, retry count
	miss                              count
	aggr, calls                       float64
	betPct                            count // n is the sum of bet/pot, d the number of bets
	latency                           float64
	cost                              float64
	potWon, potLost                   int
	pos                               map[string]*posAcc
	vs                                map[string]*vsAcc
}

type posAcc struct {
	hands     int
	vpip, pfr count
	bb        float64
}

type vsAcc struct {
	pots  int
	net   float64
	hands int // hands both were dealt in, pot or not
}

// Compute builds the stats for the given hands, which must be in the order played. It
// never runs the equity calculator: call WarmAIEV first. GeneratedAt, and nulling the
// live session's ended_at, are left for the caller.
func Compute(hands []history.HandRecord) Stats {
	s, _ := compute(hands, nil)
	return s
}

// ComputeWithTimeline is Compute plus the timeline, from the same pass over the hands.
func ComputeWithTimeline(hands []history.HandRecord) (Stats, Timeline) {
	tl := newTimelineBuilder(hands)
	return compute(hands, tl)
}

func compute(hands []history.HandRecord, tl *timelineBuilder) (Stats, Timeline) {
	out := Stats{Sessions: []Session{}, Models: []Model{}}
	accs := map[string]*acc{}
	get := func(name string) *acc {
		if accs[name] == nil {
			accs[name] = &acc{name: name, pos: map[string]*posAcc{}, vs: map[string]*vsAcc{}}
		}
		return accs[name]
	}

	sessionIdx := map[string]int{}
	for hi, h := range hands {
		id := SessionID(h)
		i, ok := sessionIdx[id]
		if !ok {
			i = len(out.Sessions)
			sessionIdx[id] = i
			out.Sessions = append(out.Sessions, Session{ID: id, StartedAt: h.StartedAt})
		}
		ended := h.EndedAt
		out.Sessions[i].EndedAt = &ended
		out.Sessions[i].Hands++
		out.Scope = Scope{TableID: h.TableID, PromptVersion: h.Config.PromptVersion, BigBlind: h.Config.BigBlind}
		if !addHand(h, get) {
			out.Partial = true
		}
		if tl != nil {
			tl.after(hi, h, accs)
		}
	}
	out.Scope.Hands = len(hands)
	out.Scope.Sessions = len(out.Sessions)

	for _, a := range accs {
		out.Models = append(out.Models, a.result())
	}
	sort.Slice(out.Models, func(i, j int) bool {
		if out.Models[i].NetChips != out.Models[j].NetChips {
			return out.Models[i].NetChips > out.Models[j].NetChips
		}
		return out.Models[i].Name < out.Models[j].Name
	})
	if tl == nil {
		return out, Timeline{}
	}
	return out, tl.result()
}

func aggressive(a history.ActionRecord) bool {
	switch a.Applied.Type {
	case "BET", "RAISE":
		return true
	case "ALL_IN":
		return a.StackBefore > a.ToCall // more than a call
	}
	return false
}

func putsChipsIn(a history.ActionRecord) bool {
	switch a.Applied.Type {
	case "CALL", "BET", "RAISE", "ALL_IN":
		return true
	}
	return false
}

func checkLegal(a history.ActionRecord) bool {
	for _, l := range a.LegalActions {
		if l.Type == "CHECK" {
			return true
		}
	}
	return false
}

// seatHand is what one seat did in one hand.
type seatHand struct {
	name             string
	a                *acc
	okPre, vpip, pfr bool
	threeOpp, three  bool
	cbetOpp, cbet    bool
	ftcOpp, ftc      bool
	foldedPre, inPot bool
	showdown, wonPot bool
}

// addHand adds one hand to the accumulators. It returns false when the hand's all-in EV
// was not computed yet and its actual result stood in.
func addHand(h history.HandRecord, get func(string) *acc) bool {
	bb := float64(h.Config.BigBlind)
	if bb == 0 {
		bb = 1
	}
	sh := make(map[int]*seatHand, len(h.Seats)) // sized: a full table outgrows a small map
	for _, s := range h.Seats {
		a := get(s.Name)
		sh[s.Seat] = &seatHand{name: s.Name, a: a}
		if s.Model != "" {
			a.model = s.Model
		}
	}

	raises, pfa := 0, -1 // preflop aggressive actions so far, and the last aggressor
	flopBet, cbetMade, raisedAfterCbet, pfaActed := false, false, false, false
	ftcSeen := map[int]bool{}
	for _, act := range h.Actions {
		s := sh[act.Seat]
		if s == nil {
			continue
		}
		a := s.a
		ok := act.Status == "ok"
		aggr := aggressive(act)

		a.errs.add(!ok)
		a.retry.add(act.Retried)
		// The model's own miss: its reply was still illegal or unreadable after its one retry, so the
		// engine checked or folded for it. Provider failures (timeouts, API errors) have statuses of their own.
		a.miss.add(act.Status == "illegal" || act.Status == "unparseable")
		a.latency += float64(act.LatencyMs)
		if act.CostUSD != nil {
			a.cost += *act.CostUSD
		}
		if putsChipsIn(act) {
			s.inPot = true
		}
		if ok && checkLegal(act) {
			a.checkFree.add(act.Applied.Type == "FOLD")
		}

		switch act.Street {
		case "preflop":
			if act.Applied.Type == "FOLD" {
				s.foldedPre = true
			}
			if ok {
				s.okPre = true
				s.vpip = s.vpip || putsChipsIn(act)
				s.pfr = s.pfr || aggr
				if raises == 1 && !s.threeOpp {
					s.threeOpp, s.three = true, aggr
				}
			}
			if aggr {
				raises++
				pfa = act.Seat
			}
		case "flop":
			if act.Seat == pfa && !pfaActed && !flopBet {
				pfaActed = true
				if ok {
					s.cbetOpp, s.cbet = true, aggr
				}
				cbetMade = aggr
			} else if cbetMade && !raisedAfterCbet && act.Seat != pfa && act.ToCall > 0 && !ftcSeen[act.Seat] {
				ftcSeen[act.Seat] = true
				if ok {
					s.ftcOpp, s.ftc = true, act.Applied.Type == "FOLD"
				}
			}
			if act.Seat == pfa {
				pfaActed = true
			}
			if aggr {
				raisedAfterCbet = cbetMade && flopBet
				flopBet = true
			}
		}

		if act.Street != "preflop" && ok {
			if aggr {
				a.aggr++
				if act.ToCall == 0 && act.PotBefore > 0 {
					a.betPct.n += float64(act.Applied.Amount) / float64(act.PotBefore)
					a.betPct.d++
				}
			} else if putsChipsIn(act) {
				a.calls++
			}
		}
	}

	for _, sd := range h.Result.Showdown {
		if s := sh[sd.Seat]; s != nil {
			s.showdown, s.inPot = true, true
		}
	}
	// The pot is every chip put in, less the part of the biggest bet nobody called.
	var put []int
	contrib := contributions(h)
	for _, c := range contrib {
		put = append(put, c)
	}
	sort.Sort(sort.Reverse(sort.IntSlice(put)))
	totalPot, totalWon := 0, 0.0
	for i, c := range put {
		totalPot += c
		if i == 0 && len(put) > 1 {
			totalPot -= c - put[1]
		}
	}
	for _, p := range h.Result.Pots {
		if s := sh[p.WinnerSeat]; s != nil {
			s.wonPot = true
		}
	}
	for _, n := range h.Result.Net {
		if n > 0 {
			totalWon += float64(n)
		}
	}

	aiev, evDone := aievNet(h)
	for _, seat := range h.Seats {
		s, a := sh[seat.Seat], sh[seat.Seat].a
		net := netOf(&h, seat.Seat)
		a.net += net
		a.bbs = append(a.bbs, float64(net)/bb)
		a.bbSum += float64(net) / bb
		a.aievBBs = append(a.aievBBs, aiev[seat.Seat]/bb)

		p := a.pos[seat.Position]
		if p == nil {
			p = &posAcc{}
			a.pos[seat.Position] = p
		}
		p.hands++
		p.bb += float64(net) / bb
		if s.okPre {
			a.vpip.add(s.vpip)
			a.pfr.add(s.pfr)
			p.vpip.add(s.vpip)
			p.pfr.add(s.pfr)
		}
		if s.threeOpp {
			a.threeBet.add(s.three)
		}
		if s.cbetOpp {
			a.cbet.add(s.cbet)
		}
		if s.ftcOpp {
			a.ftc.add(s.ftc)
		}
		if len(h.Board) >= 3 && !s.foldedPre {
			a.wtsd.add(s.showdown)
		}
		if s.showdown {
			a.wsd.add(s.wonPot)
		}
		if net > 0 {
			a.potWon = max(a.potWon, totalPot)
		} else if net < 0 && s.inPot {
			a.potLost = max(a.potLost, totalPot)
		}

		// Head to head: each loser's chips are shared among the winners in proportion
		// to what they won, and only hands where both put chips in or reached showdown count.
		for _, other := range h.Seats {
			if other.Seat == seat.Seat {
				continue
			}
			v := a.vs[other.Name]
			if v == nil {
				v = &vsAcc{}
				a.vs[other.Name] = v
			}
			v.hands++ // dealt in together: the hands bb/100 between them is per 100 of
			if !s.inPot || !sh[other.Seat].inPot {
				continue
			}
			v.pots++
			on := netOf(&h, other.Seat)
			if net > 0 && on < 0 {
				v.net += float64(-on) * float64(net) / totalWon
			} else if net < 0 && on > 0 {
				v.net -= float64(-net) * float64(on) / totalWon
			}
		}
	}
	return evDone
}

func (a *acc) result() Model {
	n := len(a.bbs)
	decisions := int(a.errs.d)
	m := Model{
		Name: a.name, Model: a.model, Hands: n,
		NetChips: a.net, BB100: a.bb100(), BB100CI: ci95(a.bbs), AIEVBB100: 100 * mean(a.aievBBs),
		VPIP: a.vpip.rate(), PFR: a.pfr.rate(), AF: a.af(), ThreeBet: a.threeBet.rate(),
		CBet: a.cbet.rate(), FoldToCBet: a.ftc.rate(), WTSD: a.wtsd.rate(), WSD: a.wsd.rate(),
		AvgBetPctPot: a.betPct.rate(), FoldCheckFree: a.checkFree.rate(),
		ErrorRate: a.errs.rate(), RetryRate: a.retry.rate(), MissRate: a.miss.rate(),
		CostUSD: a.cost, BiggestPotWon: a.potWon, BiggestPotLost: a.potLost,
		ByPosition: map[string]Position{}, CumulativeBB: curve(a.bbs), CumulativeAIEVBB: curve(a.aievBBs), Vs: map[string]Vs{},
	}
	if decisions > 0 {
		m.AvgLatencyMs = int(math.Round(a.latency / float64(decisions)))
	}
	for name, p := range a.pos {
		m.ByPosition[name] = Position{Hands: p.hands, VPIP: p.vpip.rate(), PFR: p.pfr.rate(), BB100: 100 * p.bb / float64(p.hands)}
	}
	for name, v := range a.vs {
		m.Vs[name] = Vs{Pots: v.pots, NetChips: int(math.Round(v.net)), Hands: v.hands}
	}
	return m
}

// bb100 is 100 × mean(bbs), from the running sum so timeline snapshots cost nothing.
func (a *acc) bb100() float64 {
	if len(a.bbs) == 0 {
		return 0
	}
	return 100 * (a.bbSum / float64(len(a.bbs)))
}

// af is postflop bets and raises over calls; null with no calls.
func (a *acc) af() *float64 {
	if a.calls == 0 {
		return nil
	}
	af := a.aggr / a.calls
	return &af
}

func mean(xs []float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	sum := 0.0
	for _, x := range xs {
		sum += x
	}
	return sum / float64(len(xs))
}

// ci95 is the 95% confidence interval of bb/100 by the normal approximation:
// 100 × (mean ± 1.96 × sample standard deviation / √n). Null below two hands.
func ci95(bbs []float64) *[2]float64 {
	n := float64(len(bbs))
	if n < 2 {
		return nil
	}
	m, ss := mean(bbs), 0.0
	for _, x := range bbs {
		ss += (x - m) * (x - m)
	}
	half := 1.96 * math.Sqrt(ss/(n-1)) / math.Sqrt(n)
	return &[2]float64{100 * (m - half), 100 * (m + half)}
}

// curve is the running total in big blinds after each hand, starting at [0, 0], thinned
// to at most maxCurvePoints evenly spaced points that always include the last hand.
func curve(bbs []float64) [][2]float64 {
	n := len(bbs)
	step := 1
	if n+1 > maxCurvePoints {
		step = (n + maxCurvePoints - 3) / (maxCurvePoints - 2) // ceil(n / (max-2))
	}
	out := [][2]float64{{0, 0}}
	total := 0.0
	for i, x := range bbs {
		total += x
		if (i+1)%step == 0 || i == n-1 {
			out = append(out, [2]float64{float64(i + 1), total})
		}
	}
	return out
}
