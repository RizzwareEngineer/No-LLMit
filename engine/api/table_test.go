package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/rizzwareengineer/no-LLMit/engine/client"
	"github.com/rizzwareengineer/no-LLMit/engine/game"
	"github.com/rizzwareengineer/no-LLMit/engine/history"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestNextOpen(t *testing.T) {
	ny, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Skip("no tzdata")
	}
	tbl := &floor{openHour: 9, closeHour: 21, hoursZone: ny}
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

// The table waits for the LLM service however long it takes to start, so the lineup and the
// shot clock's budget are always the service's own.
func TestSeatedPlayersWaitsForAStartingService(t *testing.T) {
	want, calls := []string{"A", "B", "C"}, 0
	late := func() ([]string, error) {
		switch calls++; {
		case calls <= 10:
			return nil, errors.New("LLM service not reachable")
		case calls <= 20:
			return nil, nil
		}
		return want, nil
	}
	if got := seatedPlayers(late, 0); !reflect.DeepEqual(got, want) || calls != 21 {
		t.Errorf("got %v after %d calls", got, calls)
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
	// Viewers see the table as if the hand was never dealt: no pot, cards, bets or moves.
	shown := ConvertGameState(gs)
	if shown.Pot != 0 || len(shown.CommunityCards) != 0 || shown.Street != "complete" {
		t.Errorf("pot %d, board %v, street %s after the void", shown.Pot, shown.CommunityCards, shown.Street)
	}
	for _, p := range shown.Players {
		if len(p.HoleCards) != 0 || p.CurrentBet != 0 || p.LastAction != "" || p.Status != "active" {
			t.Errorf("%s shows %v, bet %d, %q, %s after the void", p.Name, p.HoleCards, p.CurrentBet, p.LastAction, p.Status)
		}
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
	tbl.saver, tbl.dailyCallCap = &fakeSaver{}, 100
	tbl.setPace(1e-6)
	var saved []history.HandRecord
	tbl.onSaved = func(h history.HandRecord) { saved = append(saved, h) }
	tbl.gs.Players[1].Stack = 0

	tbl.playHand() // every call fails: voided
	if len(saved) != 0 || tbl.gs.Players[1].Stack != tbl.cfg.startingStack() {
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
	if got := noticeKinds(tbl.hub); !reflect.DeepEqual(got, []string{"cap", ""}) || tbl.calls != 1 || tbl.callsDay != "2026-11-14" {
		t.Errorf("notices %q, calls %d on %s; want cap then cleared, the turn's 1 call on 2026-11-14", got, tbl.calls, tbl.callsDay)
	}
}

// Every model call counts toward the day's cap, a retry as a second call, and the usage card
// shows yesterday's calls as none once the UTC day has turned.
func TestEveryModelCallCountsTowardTheCap(t *testing.T) {
	defer func(old func(client.DecisionRequest) (*client.LLMDecisionResponse, error)) { askLLM = old }(askLLM)
	for _, c := range []struct {
		reply client.LLMDecisionResponse
		calls int
	}{
		{reply("FOLD", 0), 1},
		{missed("illegal", "RAISE", 12), 2},
	} {
		askLLM = func(client.DecisionRequest) (*client.LLMDecisionResponse, error) { r := c.reply; return &r, nil }
		tbl := testTable(t)
		tbl.recorder = newHandRecorder(tbl.gs, "tbl_test", "", nil)
		tbl.setPace(1e-6)
		tbl.waitForBudget()
		tbl.playTurn()
		if tbl.calls != c.calls {
			t.Errorf("%s: %d calls counted, want %d", c.reply.Status, tbl.calls, c.calls)
		}
	}
	tbl := testTable(t)
	now := fakeClock(tbl, time.Date(2026, 11, 13, 23, 59, 0, 0, time.UTC))
	tbl.dailyCallCap, tbl.calls, tbl.callsDay = 100, 40, "2026-11-13"
	if u := tbl.Usage(); u.CallsToday != 40 {
		t.Errorf("before midnight: %d calls today, want 40", u.CallsToday)
	}
	*now = now.Add(2 * time.Minute)
	if u := tbl.Usage(); u.CallsToday != 0 {
		t.Errorf("after midnight UTC: %d calls today, want 0", u.CallsToday)
	}
}

// An all-in preflop deals the flop, the turn and the river as three game_states, each after
// the pause a street change has, then the showdown: not the whole board at once.
func TestAllInRunOutDealsAStreetPerPause(t *testing.T) {
	defer func(old func(client.DecisionRequest) (*client.LLMDecisionResponse, error)) { askLLM = old }(askLLM)
	askLLM = func(client.DecisionRequest) (*client.LLMDecisionResponse, error) {
		r := reply("ALL_IN", 0)
		return &r, nil
	}
	tbl := testTable(t)
	tbl.saver, tbl.dailyCallCap = &fakeSaver{}, 100
	tbl.setPace(1e-6)                 // the wait for the next hand is a real sleep
	paused := map[int]time.Duration{} // the pauses while the board had this many cards, before the hand ended
	tbl.pause = func(d time.Duration) {
		if !tbl.gs.IsHandComplete() {
			paused[len(tbl.gs.CommunityCards)] += d
		}
	}

	tbl.playHand()
	var streets []string
	for _, f := range tbl.hub.since(0, false).frames {
		for _, m := range parseFrames(t, f) {
			var s struct {
				Street         string
				CommunityCards []string
			}
			if m.Type != MsgGameState || json.Unmarshal(m.Payload, &s) != nil {
				continue
			}
			if street := fmt.Sprintf("%s %d", s.Street, len(s.CommunityCards)); len(streets) == 0 || streets[len(streets)-1] != street {
				streets = append(streets, street)
			}
		}
	}
	if want := []string{"preflop 0", "flop 3", "turn 4", "river 5", "complete 5"}; !reflect.DeepEqual(streets, want) {
		t.Errorf("game_states went %q, want %q", streets, want)
	}
	for _, board := range []int{3, 4, 5} {
		if paused[board] < tbl.paced(postActionDelay) {
			t.Errorf("%v paused with %d board cards out, want at least %v before the next street", paused[board], board, tbl.paced(postActionDelay))
		}
	}
}

func TestParseTables(t *testing.T) {
	got, err := parseTables("50/100:100, 1/2:100,5/10:200")
	if want := []tableConfig{{50, 100, 100}, {1, 2, 100}, {5, 10, 200}}; err != nil || !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, %v; want %v", got, err, want)
	}
	if k, s := got[0].key(), got[0].startingStack(); k != "50-100-100bb" || s != 10000 {
		t.Errorf("key %q, starting stack %d", k, s)
	}
	for _, bad := range []string{"", "5/10", "5/10:200,", "10/5:100", "0/0:100", "5/10:0", "5/10:200bb", "5-10:200", "5/10:200,5/10:200"} {
		if _, err := parseTables(bad); err == nil {
			t.Errorf("%q parsed", bad)
		}
	}
	t.Setenv("TABLES", "")
	if got := tablesFromEnv(); !reflect.DeepEqual(got, defaultTables) {
		t.Errorf("unset: %v", got)
	}
	t.Setenv("TABLES", "5/10:abc")
	if got := tablesFromEnv(); !reflect.DeepEqual(got, defaultTables) {
		t.Errorf("bad TABLES: %v, want the default", got)
	}
	t.Setenv("TABLES", "25/50:500,1/2:100")
	if got := tablesFromEnv(); len(got) != 2 || got[0].key() != "25-50-500bb" {
		t.Errorf("TABLES: %v", got)
	}
	if want := []string{"1-2-100bb", "5-10-200bb", "25-50-500bb", "50-100-100bb"}; !reflect.DeepEqual(keys(defaultTables), want) {
		t.Errorf("default tables %v", keys(defaultTables))
	}
}

func keys(cs []tableConfig) []string {
	var out []string
	for _, c := range cs {
		out = append(out, c.key())
	}
	return out
}

// testTables is one table per cfg, in order, sharing one hub and one floor, each on its own
// fake clock and seated in turn from A, B and C.
func testTables(cfgs ...tableConfig) ([]*Table, *hub) {
	h, f := newHub(), &floor{dailyCallCap: 1000}
	f.setPace(1e-6)
	var out []*Table
	for i, cfg := range cfgs {
		tbl := NewTable(h, f, cfg, i, &fakeSaver{}, nil)
		tbl.seated = rotated([]string{"A", "B", "C"}, i)
		fakeClock(tbl, time.Date(2026, 11, 13, 12, 0, 0, 0, time.UTC))
		out = append(out, tbl)
	}
	return out, h
}

// Two tables at different stakes deal at once, each in its own goroutine, and a model call
// that hangs at one does not hold up the other.
func TestTablesDealAtOnceAndNeverWaitOnEachOther(t *testing.T) {
	defer func(old func(client.DecisionRequest) (*client.LLMDecisionResponse, error)) { askLLM = old }(askLLM)
	release := make(chan struct{})
	askLLM = func(req client.DecisionRequest) (*client.LLMDecisionResponse, error) {
		if req.BigBlind == 100 {
			<-release // the slow table: its first call hangs until the other has played two hands
		}
		r := reply("FOLD", 0)
		return &r, nil
	}
	tables, h := testTables(tableConfig{1, 2, 100}, tableConfig{50, 100, 100})
	saved := make([]chan history.HandRecord, 2)
	done := make(chan struct{})
	for i, tbl := range tables {
		saved[i] = make(chan history.HandRecord, 10)
		tbl.onSaved = func(r history.HandRecord) { saved[i] <- r }
		go func() {
			tbl.startGame()
			for {
				select {
				case <-done:
					return
				default:
					tbl.playHand()
				}
			}
		}()
	}
	defer close(done)
	for n := 1; n <= 2; n++ {
		select {
		case r := <-saved[0]:
			if r.TableKey != "1-2-100bb" || r.Config.BigBlind != 2 || r.HandNumber != n || n == 1 && r.Seats[0].StackStart != 200 {
				t.Errorf("1/2 hand %d: key %q, blinds %d/%d, hand #%d", n, r.TableKey, r.Config.SmallBlind, r.Config.BigBlind, r.HandNumber)
			}
		case <-time.After(5 * time.Second):
			t.Fatal("the 1/2 table waited on the other table's model call")
		}
	}
	close(release)
	r := <-saved[1]
	if r.TableKey != "50-100-100bb" || r.Config.BigBlind != 100 || r.TableID == tables[0].id {
		t.Errorf("50/100 hand: key %q, big blind %d, session %s", r.TableKey, r.Config.BigBlind, r.TableID)
	}
	snap := h.since(0, true)
	for _, tbl := range tables {
		s := snap.tables[tbl.cfg.key()]
		if s == nil || s.State.Stakes.BigBlind != tbl.cfg.BigBlind || s.State.HandNumber < 1 {
			t.Errorf("%s: snapshot %+v", tbl.cfg.key(), s)
		}
	}
}

// The daily cap is one budget for every table: two tables spend it together, and the table
// that finds it spent says so and waits for the next day.
func TestTablesShareOneCallCap(t *testing.T) {
	tables, _ := testTables(tableConfig{1, 2, 100}, tableConfig{5, 10, 200})
	a, b := tables[0], tables[1]
	b.now, b.pause = a.now, a.pause // one clock
	a.dailyCallCap = 3              // the shared floor's: b sees it too
	a.startGame()
	b.startGame()

	var wg sync.WaitGroup
	for range 10 { // racing for the last calls: exactly the cap is spent
		wg.Add(1)
		go func() { defer wg.Done(); a.spend("2026-11-13", false); b.spend("2026-11-13", false) }()
	}
	wg.Wait()
	if b.calls != 3 {
		t.Fatalf("%d calls spent, want the cap of 3", b.calls)
	}
	var seen []string
	pause := b.pause
	b.pause = func(d time.Duration) {
		if len(seen) == 0 {
			seen = append(seen, b.notice.Kind)
		}
		pause(d)
	}
	b.waitForBudget()
	a.waitForBudget()
	if !reflect.DeepEqual(seen, []string{"cap"}) || a.calls != 2 || a.callsDay != "2026-11-14" {
		t.Errorf("b saw %v; %d calls on %s, want the cap notice then 2 calls on 2026-11-14", seen, a.calls, a.callsDay)
	}
}

// The snapshot lists every table in the configured order, each with its key, stakes,
// starting stack and its last table_stats.
func TestSnapshotHasEveryTable(t *testing.T) {
	tables, h := testTables(defaultTables...)
	for _, tbl := range tables {
		tbl.startGame()
	}
	h.publish("5-10-200bb", nil, []byte(`{"hands":3,"models":[]}`), ServerMessage{Type: MsgTableStats, Payload: json.RawMessage(`{"hands":3,"models":[]}`)})
	b, err := h.since(0, true).snapshotFrame()
	if err != nil {
		t.Fatal(err)
	}
	raw := string(b)
	at := -1
	for _, c := range defaultTables { // in order, though a map would sort 25-50 before 5-10
		i := strings.Index(raw, `"`+c.key()+`":{"key":"`+c.key()+`"`)
		if i < at {
			t.Errorf("%s out of order in %s", c.key(), raw)
		}
		at = i
	}
	var snap struct{ Tables map[string]tableSnap }
	json.Unmarshal(parseFrames(t, b)[0].Payload, &snap)
	for i, c := range defaultTables {
		s := snap.Tables[c.key()]
		if s.Key != c.key() || s.Index != i || s.StartingStack != c.startingStack() || s.State.Stakes != (StakesPayload{c.SmallBlind, c.BigBlind}) || s.State.Players[0].Stack != c.startingStack() {
			t.Errorf("%s: %+v", c.key(), s)
		}
	}
	if got := string(snap.Tables["5-10-200bb"].Stats); got != `{"hands":3,"models":[]}` {
		t.Errorf("5/10 table_stats in the snapshot: %s", got)
	}
	if s := snap.Tables["1-2-100bb"]; s.Stats != nil || s.State.Players[0].Name != "A" || snap.Tables["5-10-200bb"].State.Players[0].Name != "B" {
		t.Errorf("1/2: stats %s, seats rotated per table: %s then %s", s.Stats, s.State.Players[0].Name, snap.Tables["5-10-200bb"].State.Players[0].Name)
	}
}
