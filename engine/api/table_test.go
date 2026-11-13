package api

import (
	"errors"
	"github.com/rizzwareengineer/no-LLMit/engine/client"
	"github.com/rizzwareengineer/no-LLMit/engine/game"
	"github.com/rizzwareengineer/no-LLMit/engine/history"
	"os"
	"reflect"
	"regexp"
	"strings"
	"testing"
	"time"
)

func TestNextOpen(t *testing.T) {
	ny, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Skip("no tzdata")
	}
	tbl := &Table{openHour: 9, closeHour: 21, hoursZone: ny}
	cases := []struct{ now, want time.Time }{
		{time.Date(2026, 11, 3, 22, 0, 0, 0, ny), time.Date(2026, 11, 4, 9, 0, 0, 0, ny)},
		{time.Date(2026, 11, 3, 6, 30, 0, 0, ny), time.Date(2026, 11, 3, 9, 0, 0, 0, ny)},
		{time.Date(2026, 11, 3, 9, 0, 0, 0, ny), time.Date(2026, 11, 4, 9, 0, 0, 0, ny)},
	}
	for _, c := range cases {
		if got := tbl.nextOpen(c.now); !got.Equal(c.want) {
			t.Errorf("nextOpen(%v) = %v, want %v", c.now, got, c.want)
		}
	}
}

func TestSeatedPlayersFallsBackWhenServiceIsDown(t *testing.T) {
	down := func() ([]string, error) { return nil, errors.New("LLM service not reachable") }
	if got := seatedPlayers(down, 3, 0); !reflect.DeepEqual(got, defaultPlayers) {
		t.Errorf("down: got %v", got)
	}
	empty := func() ([]string, error) { return nil, nil }
	if got := seatedPlayers(empty, 3, 0); !reflect.DeepEqual(got, defaultPlayers) {
		t.Errorf("empty: got %v", got)
	}
}

func TestSeatedPlayersWaitsForAStartingService(t *testing.T) {
	want, calls := []string{"A", "B", "C"}, 0
	late := func() ([]string, error) {
		if calls++; calls < 3 {
			return nil, errors.New("LLM service not reachable")
		}
		return want, nil
	}
	if got := seatedPlayers(late, 12, 0); !reflect.DeepEqual(got, want) || calls != 3 {
		t.Errorf("got %v after %d calls", got, calls)
	}
}

// defaultPlayers must equal DEFAULT_LINEUP in llm/registry.py: the first SEATS (9) keys of MODELS.
func TestDefaultPlayersMatchRegistry(t *testing.T) {
	src, err := os.ReadFile("../../llm/registry.py")
	if err != nil {
		t.Fatal(err)
	}
	block := strings.SplitN(strings.SplitN(string(src), "MODELS = {", 2)[1], "}", 2)[0]
	var names []string
	for _, m := range regexp.MustCompile(`(?m)^\s*"([^"]+)":`).FindAllStringSubmatch(block, -1) {
		names = append(names, m[1])
	}
	if !strings.Contains(string(src), "DEFAULT_LINEUP = list(MODELS)[:SEATS]") || !strings.Contains(string(src), "SEATS = 9") {
		t.Fatal("registry.py no longer derives DEFAULT_LINEUP as the first 9 of MODELS; update this test")
	}
	if len(names) < 9 || !reflect.DeepEqual(names[:9], defaultPlayers) {
		t.Errorf("registry default lineup %v, engine defaultPlayers %v", names, defaultPlayers)
	}
}

// A hand in which no model call succeeded is an outage; a hand with one answer, or one of
// the models' own misses, is not.
func TestOutage(t *testing.T) {
	failed := client.LLMDecisionResponse{Action: "FOLD", Status: "api_error", Error: "401 Unauthorized"}
	unreachable := client.LLMDecisionResponse{Action: "FOLD", Status: "service_error"}
	miss := client.LLMDecisionResponse{Action: "FOLD", Status: "unparseable", Raw: "dunno"}
	for _, c := range []struct {
		name   string
		script replies
		want   bool
	}{
		{"every call failed at the provider", replies{failed, failed}, true},
		{"the LLM service was unreachable", replies{unreachable, failed}, true},
		{"one model answered", replies{reply("FOLD", 0), failed}, false},
		{"the models' own misses", replies{miss, miss}, false},
		{"misses and failures, no answer", replies{miss, failed}, true},
	} {
		// Button A acts first three-handed, then the small blind B; both folds end the hand.
		r, _ := playTable(t, []string{"A", "B", "C"}, nil, nil, nil, c.script)
		if got := outage(r); got != c.want {
			t.Errorf("%s: outage %v, want %v (statuses %v)", c.name, got, c.want, statuses(r))
		}
	}
}

func statuses(r history.HandRecord) []string {
	var out []string
	for _, a := range r.Actions {
		out = append(out, a.Status)
	}
	return out
}

// A voided hand puts every stack, winnings and the button back, so the next hand is dealt as
// if it never was.
func TestVoidedHandRestoresStacksAndButton(t *testing.T) {
	gs := game.NewGame(game.GameConfig{PlayerNames: []string{"A", "B", "C", "D"}, StartingStack: 1000, Stakes: game.Stakes{SmallBlind: 5, BigBlind: 10}})
	gs.ButtonIdx = 0
	gs.Players[3].Stack = 7
	start := startOf(gs)
	if err := gs.StartHand(); err != nil {
		t.Fatal(err)
	}
	for !gs.IsHandComplete() && gs.IsWaitingForAction() { // D shoves for 7, the rest fold where they can
		typ := game.ActionFold
		if gs.CurrentPlayerIdx == 3 {
			typ = game.ActionAllIn
		}
		if err := gs.ProcessAction(game.Action{Type: typ, PlayerIdx: gs.CurrentPlayerIdx}); err != nil {
			t.Fatal(err)
		}
		if gs.NeedToAdvanceStreet() {
			gs.AdvanceStreet()
		}
	}
	for gs.NeedToAdvanceStreet() {
		gs.AdvanceStreet()
	}
	start.restore(gs)
	for i, p := range gs.Players {
		if p.Stack != start.stacks[i] || p.Winnings != 0 {
			t.Errorf("%s has %d and winnings %d, want %d and 0 back", p.Name, p.Stack, p.Winnings, start.stacks[i])
		}
	}
	if gs.ButtonIdx != 0 {
		t.Errorf("button %d, want 0 back", gs.ButtonIdx)
	}
	if len(gs.Winners) != 0 {
		t.Errorf("winners %+v kept, so seats would show chips the hand no longer gave", gs.Winners)
	}
}

// A rebuy made for a hand that is then voided is flagged on the next hand that is saved.
func TestRebuyInAVoidedHandIsFlaggedOnTheNextHand(t *testing.T) {
	defer func(old func(client.DecisionRequest) (*client.LLMDecisionResponse, error)) { askLLM = old }(askLLM)
	status := "api_error"
	askLLM = func(client.DecisionRequest) (*client.LLMDecisionResponse, error) {
		r := reply("FOLD", 0)
		r.Status = status
		return &r, nil
	}
	tbl := testTable(t)
	tbl.pace, tbl.saver, tbl.dailyCallCap = 1e-6, &fakeSaver{}, 100
	var saved []history.HandRecord
	tbl.onSaved = func(h history.HandRecord) { saved = append(saved, h) }
	tbl.gs.Players[1].Stack = 0

	tbl.playHand() // every call fails: voided
	if len(saved) != 0 || tbl.gs.Players[1].Stack != tableStartingStack {
		t.Fatalf("voided hand: %d saved, B has %d", len(saved), tbl.gs.Players[1].Stack)
	}
	var last string
	for _, f := range tbl.hub.since(0, false).frames {
		for _, m := range parseFrames(t, f) {
			if m.Type == MsgGameState {
				last = string(m.Payload)
			}
		}
	}
	if strings.Contains(last, `"winners"`) {
		t.Errorf("the voided hand's last game_state still names winners: %s", last)
	}
	status = "ok"
	tbl.playHand()
	if len(saved) != 1 || !saved[0].Seats[1].Rebought {
		t.Errorf("next hand: %d saved, seats %+v", len(saved), saved)
	}
}

// fakeClock runs a table's waits without sleeping: each pause moves the clock on by its duration.
func fakeClock(tbl *Table, at time.Time) *time.Time {
	now := at
	tbl.now = func() time.Time { return now }
	tbl.pause = func(d time.Duration) { now = now.Add(d) }
	return &now
}

// Outside its hours the table says it is closed and when it reopens, waits until then, and clears the notice.
func TestClosedTableWaitsForOpenHours(t *testing.T) {
	ny, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Skip("no tzdata")
	}
	tbl := testTable(t)
	tbl.openHour, tbl.closeHour, tbl.hoursZone = 9, 21, ny
	now := fakeClock(tbl, time.Date(2026, 11, 13, 22, 30, 0, 0, ny))
	var seen TableNoticePayload
	var open bool
	pause := tbl.pause
	tbl.pause = func(d time.Duration) {
		if seen.Kind == "" {
			seen, open = tbl.notice, tbl.Usage().Open
		}
		pause(d)
	}

	tbl.waitForOpenHours()
	if want := "2026-11-14T09:00:00-05:00"; seen.Kind != "closed" || seen.ReopensAt != want || open {
		t.Errorf("while closed: notice %+v, usage open %v; want closed, reopening %s", seen, open, want)
	}
	if opened := time.Date(2026, 11, 14, 9, 0, 0, 0, ny); now.Before(opened) || now.Sub(opened) >= 10*time.Second {
		t.Errorf("waited until %v, want within 10 s after %v", *now, opened)
	}
	if got := noticeKinds(tbl.hub); !reflect.DeepEqual(got, []string{"closed", ""}) || tbl.notice.Kind != "" {
		t.Errorf("notices %q, left %+v; want closed then cleared", got, tbl.notice)
	}
}

// At the day's call cap the table says so and when it resumes, waits for the next UTC day, then plays on.
func TestCapWaitsForTheNextUTCDay(t *testing.T) {
	tbl := testTable(t)
	now := fakeClock(tbl, time.Date(2026, 11, 13, 18, 30, 0, 0, time.UTC))
	tbl.dailyCallCap, tbl.calls, tbl.callsDay = 2, 2, "2026-11-13"
	var seen TableNoticePayload
	pause := tbl.pause
	tbl.pause = func(d time.Duration) {
		if seen.Kind == "" {
			seen = tbl.notice
		}
		pause(d)
	}

	tbl.waitForBudget()
	if want := "2026-11-14T00:00:00Z"; seen.Kind != "cap" || seen.ReopensAt != want {
		t.Errorf("at the cap: notice %+v, want cap reopening %s", seen, want)
	}
	if midnight := time.Date(2026, 11, 14, 0, 0, 0, 0, time.UTC); now.Before(midnight) || now.Sub(midnight) >= 10*time.Second {
		t.Errorf("waited until %v, want within 10 s after %v", *now, midnight)
	}
	if got := noticeKinds(tbl.hub); !reflect.DeepEqual(got, []string{"cap", ""}) || tbl.calls != 0 || tbl.callsDay != "2026-11-14" {
		t.Errorf("notices %q, calls %d on %s; want cap then cleared, 0 calls on 2026-11-14", got, tbl.calls, tbl.callsDay)
	}
}
