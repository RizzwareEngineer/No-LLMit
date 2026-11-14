package api

import (
	"bufio"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/rizzwareengineer/no-LLMit/engine/client"
	"github.com/rizzwareengineer/no-LLMit/engine/game"
	"github.com/rizzwareengineer/no-LLMit/engine/history"
)

func handStartMsg(n int) ServerMessage {
	return ServerMessage{Type: MsgHandStart, Payload: map[string]int{"handNumber": n}}
}

// A publish that lands between a writer's read and its wait still wakes it.
func TestPublishBetweenReadAndWaitWakes(t *testing.T) {
	h := newHub()
	v := h.since(0, true)
	h.publish("tbl_a", &tableSnap{}, nil, handStartMsg(1))
	select {
	case <-v.wake:
	case <-time.After(time.Second):
		t.Fatal("writer not woken")
	}
	if next := h.since(v.seq, false); next.snap || len(next.frames) != 1 {
		t.Errorf("after the wake: snapshot %v, %d frames", next.snap, len(next.frames))
	}
}

// A writer 50 behind is still served from the ring; 51 behind gets a snapshot.
func TestWriterBehindGetsEventsThenSnapshot(t *testing.T) {
	h := newHub()
	for i := range 60 {
		h.publish("tbl_a", &tableSnap{}, nil, handStartMsg(i))
	}
	for _, c := range []struct {
		behind uint64
		snap   bool
	}{{49, false}, {50, false}, {51, true}} {
		v := h.since(60-c.behind, false)
		if v.snap != c.snap || (!c.snap && len(v.frames) != int(c.behind)) || v.seq != 60 {
			t.Errorf("%d behind: snapshot %v, %d frames, seq %d", c.behind, v.snap, len(v.frames), v.seq)
		}
		if !c.snap && !strings.HasPrefix(string(v.frames[0]), `data: {"seq":`+itoa(61-c.behind)+`,`) {
			t.Errorf("%d behind: first frame %s", c.behind, v.frames[0])
		}
	}
}

func itoa(n uint64) string { b, _ := json.Marshal(n); return string(b) }

type wireMsg struct {
	Seq     uint64          `json:"seq"`
	Table   string          `json:"table"`
	Type    MessageType     `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

func parseFrames(t *testing.T, b []byte) []wireMsg {
	t.Helper()
	var out []wireMsg
	for _, f := range strings.Split(strings.TrimSuffix(string(b), "\n\n"), "\n\n") {
		var m wireMsg
		if !strings.HasPrefix(f, "data: ") || json.Unmarshal([]byte(f[len("data: "):]), &m) != nil {
			t.Fatalf("bad frame %q", f)
		}
		out = append(out, m)
	}
	return out
}

// Events from two tables keep one order, and the snapshot holds both tables.
func TestTwoTablesShareOneOrder(t *testing.T) {
	h := newHub()
	h.publish("tbl_a", &tableSnap{State: GameStatePayload{HandNumber: 1}}, nil, handStartMsg(1))
	h.publish("tbl_b", &tableSnap{State: GameStatePayload{HandNumber: 7}}, nil, handStartMsg(7), handStartMsg(8))
	h.publish("tbl_a", &tableSnap{State: GameStatePayload{HandNumber: 2}}, nil, handStartMsg(2))

	var got []string
	for _, f := range h.since(0, false).frames {
		m := parseFrames(t, f)[0]
		got = append(got, itoa(m.Seq)+m.Table)
	}
	if strings.Join(got, ",") != "1tbl_a,2tbl_b,3tbl_b,4tbl_a" {
		t.Errorf("frames %v", got)
	}

	b, err := h.since(0, true).snapshotFrame()
	if err != nil {
		t.Fatal(err)
	}
	var snap struct{ Tables map[string]tableSnap }
	json.Unmarshal(parseFrames(t, b)[0].Payload, &snap)
	if len(snap.Tables) != 2 || snap.Tables["tbl_a"].State.HandNumber != 2 || snap.Tables["tbl_b"].State.HandNumber != 7 {
		t.Errorf("snapshot tables %+v", snap.Tables)
	}
}

// A snapshot taken after the notice is cleared and the turn has ended carries both as null.
func TestSnapshotCarriesClearedNoticeAndTurnAsNull(t *testing.T) {
	tbl := testTable(t)
	thinking := ServerMessage{Type: MsgLLMThinking, Payload: LLMThinkingPayload{PlayerIdx: 1, PlayerName: "B"}}
	tbl.turn = &thinking
	tbl.setNotice(TableNoticePayload{Kind: "saving", Message: "paused"})
	tbl.publish(thinking)
	b, _ := tbl.hub.since(0, true).snapshotFrame()
	if s := string(b); !strings.Contains(s, `"notice":{"kind":"saving"`) || !strings.Contains(s, `"turn":{"type":"llm_thinking"`) {
		t.Fatalf("live snapshot %s", s)
	}

	tbl.setNotice(TableNoticePayload{})
	tbl.turn = nil // as after hand_start (TestSnapshotKeepsTheAppliedActionUntilTheNextHand)
	tbl.publish(tbl.stateMessage())
	b, _ = tbl.hub.since(0, true).snapshotFrame()
	s := string(b)
	for _, want := range []string{`"notice":null`, `"turn":null`, `"buttonCards":[]`, `"buttonWinner":null`} {
		if !strings.Contains(s, want) {
			t.Errorf("snapshot lacks %s: %s", want, s)
		}
	}
}

// The stream answers with the SSE headers, a snapshot and the full stats, then live events;
// at the cap it answers 503.
func TestStreamServesSnapshotStatsAndEvents(t *testing.T) {
	h := newHub()
	h.publish("", nil, []byte(`{"models":[]}`), ServerMessage{Type: MsgStats, Payload: map[string]any{}})
	srv := httptest.NewServer(http.HandlerFunc(h.handleStream))
	defer srv.Close()

	resp, err := http.Get(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 || resp.Header.Get("Content-Type") != "text/event-stream" || resp.Header.Get("Cache-Control") != "no-store" || resp.ContentLength != -1 {
		t.Fatalf("%d %v", resp.StatusCode, resp.Header)
	}
	r := bufio.NewReader(resp.Body)
	next := func() wireMsg {
		line, err := r.ReadString('\n')
		if err != nil {
			t.Fatal(err)
		}
		r.ReadString('\n')
		return parseFrames(t, []byte(line+"\n"))[0]
	}
	if m := next(); m.Type != MsgSnapshot || string(m.Payload) != `{"tables":{}}` || m.Seq != 1 {
		t.Errorf("first %+v", m)
	}
	if m := next(); m.Type != MsgStats || string(m.Payload) != `{"models":[]}` || m.Seq != 1 {
		t.Errorf("second %+v", m)
	}
	h.publish("tbl_a", &tableSnap{}, nil, handStartMsg(3))
	if m := next(); m.Type != MsgHandStart || m.Table != "tbl_a" || m.Seq != 2 {
		t.Errorf("live %+v", m)
	}
	if n := h.open.Load(); n != 1 {
		t.Errorf("open streams %d", n)
	}

	h.open.Store(maxStreams)
	full, err := http.Get(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	full.Body.Close()
	if full.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("at the cap: %d", full.StatusCode)
	}
}

// Stats go out once per recompute that added a hand: the full body the first time, so a
// stream that opened before any stats has rows to change, then only the rows that changed.
func TestStatsEventCarriesChangedRows(t *testing.T) {
	hands := statsHands(t)
	c := newTestCache(nil)
	c.hub = newHub()
	for _, h := range hands[:4] {
		c.add(h)
	}
	c.recompute(true)
	c.recompute(false) // nothing added: nothing published
	c.add(hands[4])
	c.recompute(false)

	frames := c.hub.since(0, false).frames
	if len(frames) != 2 {
		t.Fatalf("%d stats events, want 2", len(frames))
	}
	var first struct{ Models []json.RawMessage }
	var second statsChange
	firstRaw := parseFrames(t, frames[0])[0].Payload
	json.Unmarshal(firstRaw, &first)
	json.Unmarshal(parseFrames(t, frames[1])[0].Payload, &second)
	if strings.Contains(string(firstRaw), `"changed"`) || len(first.Models) == 0 {
		t.Errorf("first event is not the full body: %.200s", firstRaw)
	}
	played := map[string]bool{}
	for _, a := range hands[4].Actions {
		played[a.Player] = true
	}
	for _, row := range second.Changed {
		var m struct{ Name string }
		json.Unmarshal(row, &m)
		if !played[m.Name] && !seatedIn(hands[4], m.Name) {
			t.Errorf("%s changed but was not in the new hand", m.Name)
		}
	}
	if len(second.Changed) == 0 {
		t.Error("the new hand changed no row")
	}
	c.hub.mu.RLock()
	full := parseFrames(t, c.hub.stats)[0]
	c.hub.mu.RUnlock()
	c.mu.Lock()
	want := string(c.all.json)
	c.mu.Unlock()
	if full.Type != MsgStats || string(full.Payload) != want {
		t.Error("the stream's full stats differ from GET /api/stats")
	}
}

func seatedIn(h history.HandRecord, name string) bool {
	for _, p := range h.Seats {
		if p.Name == name {
			return true
		}
	}
	return false
}

// After an action is applied the snapshot still carries it, marked applied, so a viewer who
// reconnects then keeps the revealed reasoning; the next hand_start ends it.
func TestSnapshotKeepsTheAppliedActionUntilTheNextHand(t *testing.T) {
	defer func(old func(client.DecisionRequest) (*client.LLMDecisionResponse, error)) { askLLM = old }(askLLM)
	askLLM = func(client.DecisionRequest) (*client.LLMDecisionResponse, error) {
		r := reply("FOLD", 0)
		r.Retried = true
		return &r, nil
	}
	tbl := testTable(t)
	tbl.recorder = newHandRecorder(tbl.gs, tbl.id, nil)
	snap := func() *tableSnap { return tbl.hub.since(0, true).tables[tbl.id] }

	seat := tbl.gs.CurrentPlayerIdx
	tbl.playTurn()
	s := snap()
	if s.Turn == nil || s.Turn.Type != MsgLLMAction || !s.TurnApplied {
		t.Fatalf("after the action: turn %+v, applied %v", s.Turn, s.TurnApplied)
	}
	if p := s.Turn.Payload.(LLMActionPayload); p.Turn != 1 || p.PlayerIdx != seat || p.Action != "FOLD" || p.Reason != "because" {
		t.Errorf("turn payload %+v", p)
	}
	if tbl.calls != 2 {
		t.Errorf("a retried turn counted %d calls, want 2", tbl.calls)
	}
	tbl.recorder = newHandRecorder(tbl.gs, tbl.id, nil)
	tbl.playTurn()
	if p := snap().Turn.Payload.(LLMActionPayload); p.Turn != 2 {
		t.Errorf("second turn numbered %d", p.Turn)
	}
	if s.State.Players[seat].Status != "folded" {
		t.Errorf("the state does not show the fold: %+v", s.State.Players[seat])
	}

	if _, err := tbl.dealHand(); err != nil {
		t.Fatal(err)
	}
	if s := snap(); s.Turn != nil || s.TurnApplied || tbl.turns != 0 {
		t.Errorf("after hand_start: turn %+v, applied %v, %d turns", s.Turn, s.TurnApplied, tbl.turns)
	}
}

// The live llm_thinking carries the model's budget and 0 elapsed; a snapshot built 20 s into
// the turn carries 20 s elapsed, so a late joiner's shot clock shows what is left.
func TestThinkingCarriesBudgetAndElapsed(t *testing.T) {
	defer func(old func(client.DecisionRequest) (*client.LLMDecisionResponse, error)) { askLLM = old }(askLLM)
	askLLM = func(client.DecisionRequest) (*client.LLMDecisionResponse, error) { r := reply("FOLD", 0); return &r, nil }
	tbl := testTable(t)
	tbl.pace = 1e-6
	tbl.recorder = newHandRecorder(tbl.gs, tbl.id, nil)
	tbl.playTurn()
	var live LLMThinkingPayload
	for _, f := range tbl.hub.since(0, false).frames {
		if m := parseFrames(t, f)[0]; m.Type == MsgLLMThinking {
			json.Unmarshal(m.Payload, &live)
			if !strings.Contains(string(m.Payload), `"elapsedMs":0`) {
				t.Errorf("live llm_thinking %s", m.Payload)
			}
		}
	}
	if want := int(client.TurnBudget.Milliseconds()); live.BudgetMs != want || want == 0 {
		t.Errorf("live budgetMs %d, want %d", live.BudgetMs, want)
	}

	thinking := ServerMessage{Type: MsgLLMThinking, Payload: LLMThinkingPayload{Turn: 2, BudgetMs: 45000, startedAt: time.Now().Add(-20 * time.Second)}}
	tbl.turn = &thinking
	tbl.publish(thinking)
	b, _ := tbl.hub.since(0, true).snapshotFrame()
	var snap struct {
		Tables map[string]struct {
			Turn struct{ Payload LLMThinkingPayload }
		}
	}
	json.Unmarshal(parseFrames(t, b)[0].Payload, &snap)
	if p := snap.Tables[tbl.id].Turn.Payload; p.BudgetMs != 45000 || p.ElapsedMs < 20000 || p.ElapsedMs > 21000 {
		t.Errorf("snapshot turn %+v, want budget 45000 and about 20000 elapsed", p)
	}
}

// The hand after a voided one is dealt live: dealing it clears the outage notice, so a viewer
// who joins during it sees the same table as one who was watching.
func TestDealingTheProbeHandClearsTheOutageNotice(t *testing.T) {
	tbl := testTable(t)
	tbl.notice = TableNoticePayload{Kind: "outage", Message: "down"}
	if _, err := tbl.dealHand(); err != nil {
		t.Fatal(err)
	}
	if n := tbl.hub.since(0, true).tables[tbl.id].Notice; n != nil {
		t.Errorf("snapshot notice after hand_start: %+v", n)
	}
	if got := strings.Join(noticeKinds(tbl.hub), ","); got != "" || len(tbl.hub.since(0, false).frames) != 3 {
		t.Errorf("want a cleared table_notice before hand_start, got kinds %q", got)
	}
}

// A hand that settleStreets finishes (nobody left to act) ends with a game_state, so live
// viewers see the final board.
func TestSettledHandEndsWithTheFinalState(t *testing.T) {
	tbl := testTable(t)
	for range 3 {
		if err := tbl.gs.ProcessAction(game.Action{Type: game.ActionAllIn, PlayerIdx: tbl.gs.CurrentPlayerIdx}); err != nil {
			t.Fatal(err)
		}
	}
	tbl.settleStreets()
	frames := tbl.hub.since(0, false).frames
	last := parseFrames(t, frames[len(frames)-1])[0]
	var state GameStatePayload
	json.Unmarshal(last.Payload, &state)
	if last.Type != MsgGameState || state.Street != "complete" || len(state.CommunityCards) != 5 {
		t.Errorf("last frame %s %+v", last.Type, state)
	}
}

// One address gets maxStreamsPerAddr streams; other addresses are not affected.
func TestStreamCapPerAddress(t *testing.T) {
	h := newHub()
	h.addrs["1.2.3.4"] = maxStreamsPerAddr
	srv := httptest.NewServer(http.HandlerFunc(h.handleStream))
	defer srv.Close()
	for _, c := range []struct {
		addr string
		want int
	}{{"1.2.3.4", http.StatusTooManyRequests}, {"5.6.7.8", http.StatusOK}} {
		req, _ := http.NewRequest("GET", srv.URL, nil)
		req.Header.Set("X-Real-IP", c.addr)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != c.want {
			t.Errorf("%s: %d, want %d", c.addr, resp.StatusCode, c.want)
		}
	}
	waitFor(t, "the closed stream to leave the count", func() bool {
		h.addrMu.Lock()
		defer h.addrMu.Unlock()
		_, held := h.addrs["5.6.7.8"]
		return !held && h.addrs["1.2.3.4"] == maxStreamsPerAddr
	})
}
