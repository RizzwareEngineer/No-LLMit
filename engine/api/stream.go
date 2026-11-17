// GET /stream: one-way Server-Sent Events to every viewer. Tables publish
// to the hub; the net/http goroutine of each stream is that viewer's only writer. It sends
// a snapshot on connect, then the hub's recent frames after the last one it wrote, or a
// fresh snapshot when it has fallen more than ringSize behind.
package api

import (
	"encoding/json"
	"log"
	"maps"
	"math/rand/v2"
	"net/http"
	"os"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
)

const (
	ringSize          = 50
	maxStreams        = 6000
	maxStreamsPerAddr = 50 // high: a mobile or office network puts many viewers behind one address
	heartbeatEvery    = 20 * time.Second
	eventWriteWait    = 10 * time.Second
	snapshotWriteWait = 60 * time.Second
	streamLifetime    = 10 * time.Minute // plus a random 0 to 4 minutes (streamLife)
)

type frame struct {
	seq    uint64
	data   []byte // the whole SSE frame: "data: {...}\n\n"
	packed []byte // the same frame deflated, for a gzipped stream (streamgz.go)
}

// tableSnap is one table as a joiner needs it. It is never changed once published.
type tableSnap struct {
	State        GameStatePayload     `json:"state"`
	Turn         *ServerMessage       `json:"turn"`
	TurnApplied  bool                 `json:"turnApplied"` // Turn is an llm_action the state already shows
	Notice       *TableNoticePayload  `json:"notice"`
	ButtonCards  []ButtonCardPayload  `json:"buttonCards"`
	ButtonWinner *ButtonWinnerPayload `json:"buttonWinner"`
	nextHandAt   time.Time            // set while the hand is complete; nextHandInMs is worked out per stream
}

type hub struct {
	mu     sync.RWMutex
	seq    uint64
	ring   [ringSize]frame
	tables map[string]*tableSnap
	stats  []byte        // the all-time GET /api/stats body as one stats frame, sent after every snapshot; nil until loaded
	statsZ []byte        // stats deflated, for a gzipped stream
	wake   chan struct{} // closed and replaced on every publish
	open   atomic.Int64  // streams open now

	addrMu sync.Mutex // its own lock, so a connect never waits on a publish
	addrs  map[string]int
}

func newHub() *hub {
	return &hub{tables: map[string]*tableSnap{}, wake: make(chan struct{}), addrs: map[string]int{}}
}

type envelope struct {
	Table   string      `json:"table,omitempty"`
	Type    MessageType `json:"type"`
	Payload any         `json:"payload"`
}

// publish appends msgs as one step: table's snapshot (if snap is set) and the stats body
// (if statsFull is set) change in the same locked step, then every writer is woken.
func (h *hub) publish(table string, snap *tableSnap, statsFull []byte, msgs ...ServerMessage) {
	bodies := make([][]byte, len(msgs))
	packs := make([]packedBody, len(msgs))
	for i, m := range msgs {
		b, err := json.Marshal(envelope{table, m.Type, m.Payload})
		if err != nil {
			log.Printf("!!! Encoding %s: %v", m.Type, err)
			return
		}
		bodies[i], packs[i] = b, packBody(b)
	}
	var stats []byte
	var statsPack packedBody
	if statsFull != nil {
		stats = append(append([]byte(`{"type":"stats","payload":`), statsFull...), '}')
		statsPack = packBody(stats) // deflated once, before the lock
	}
	h.mu.Lock()
	for i, b := range bodies {
		h.seq++
		h.ring[h.seq%ringSize] = frame{h.seq, sseFrame(h.seq, b), packs[i].frame(h.seq)}
	}
	if snap != nil {
		h.tables[table] = snap
	}
	if stats != nil {
		h.stats = sseFrame(h.seq, stats) // framed once here; every stream shares the bytes
		h.statsZ = statsPack.frame(h.seq)
	}
	old := h.wake
	h.wake = make(chan struct{})
	h.mu.Unlock()
	close(old)
}

// sseFrame puts seq first in an encoded envelope, so frames are marshalled before the lock.
func sseFrame(seq uint64, body []byte) []byte {
	f := make([]byte, 0, len(body)+32)
	f = append(f, `data: {"seq":`...)
	f = strconv.AppendUint(f, seq, 10)
	if len(body) > 2 {
		f = append(f, ',')
	}
	f = append(f, body[1:]...)
	return append(f, "\n\n"...)
}

// view is what a writer sends next: the frames after its last one, or a snapshot.
type view struct {
	seq    uint64
	frames [][]byte
	packed [][]byte // frames deflated, in step
	snap   bool
	tables map[string]*tableSnap
	stats  []byte
	statsZ []byte
	wake   <-chan struct{}
}

func (h *hub) since(last uint64, first bool) view {
	h.mu.RLock()
	defer h.mu.RUnlock()
	v := view{seq: h.seq, wake: h.wake}
	if !first && v.seq-last <= ringSize {
		for s := last + 1; s <= v.seq; s++ {
			f := h.ring[s%ringSize]
			if f.seq != s {
				v.frames, v.packed = nil, nil
				break
			}
			v.frames, v.packed = append(v.frames, f.data), append(v.packed, f.packed)
		}
		if len(v.frames) == int(v.seq-last) {
			return v
		}
	}
	v.snap, v.tables, v.stats, v.statsZ = true, maps.Clone(h.tables), h.stats, h.statsZ
	return v
}

func (v view) snapshotFrame() ([]byte, error) {
	tables := make(map[string]tableSnap, len(v.tables))
	for id, s := range v.tables {
		c := *s
		c.State.NextHandInMs = nextHandMs(c.nextHandAt)
		if c.Turn != nil {
			if p, ok := c.Turn.Payload.(LLMThinkingPayload); ok { // the shot clock resumes where it is
				p.ElapsedMs = int(time.Since(p.startedAt).Milliseconds())
				c.Turn = &ServerMessage{Type: c.Turn.Type, Payload: p}
			}
		}
		if c.ButtonCards == nil {
			c.ButtonCards = []ButtonCardPayload{}
		}
		tables[id] = c
	}
	b, err := json.Marshal(envelope{Type: MsgSnapshot, Payload: map[string]any{"tables": tables}})
	if err != nil {
		return nil, err
	}
	return sseFrame(v.seq, b), nil
}

var heartbeat = []byte(": hb\n\n")

// streamLife is how long one stream stays open: a random 10 to 14 minutes, under Railway's
// 15-minute cut, so a burst's reconnects spread out.
// FIXTURE_STREAM_LIFE_S (test fixtures only; production never sets it) closes every stream after exactly that many
// seconds instead, so a fixture can make the page reconnect at a known time.
func streamLife() time.Duration {
	if s, err := strconv.ParseFloat(os.Getenv("FIXTURE_STREAM_LIFE_S"), 64); err == nil && s > 0 {
		return time.Duration(s * float64(time.Second))
	}
	return streamLifetime + rand.N(4*time.Minute)
}

func (h *hub) handleStream(w http.ResponseWriter, r *http.Request) {
	if addr := clientAddr(r); addr != "" {
		h.addrMu.Lock()
		n := h.addrs[addr]
		if n < maxStreamsPerAddr {
			h.addrs[addr] = n + 1
		}
		h.addrMu.Unlock()
		if n >= maxStreamsPerAddr {
			http.Error(w, "Too many streams from your address.", http.StatusTooManyRequests)
			return
		}
		defer func() {
			h.addrMu.Lock()
			if h.addrs[addr]--; h.addrs[addr] <= 0 {
				delete(h.addrs, addr) // so the map does not grow with every address ever seen
			}
			h.addrMu.Unlock()
		}()
	}
	if h.open.Add(1) > maxStreams {
		h.open.Add(-1)
		http.Error(w, "Too many viewers right now.", http.StatusServiceUnavailable)
		return
	}
	defer h.open.Add(-1)

	o := &out{w: w, rc: http.NewResponseController(w), gz: acceptsGzip(r)}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Vary", "Accept-Encoding")
	if o.gz {
		w.Header().Set("Content-Encoding", "gzip")
	}
	w.WriteHeader(http.StatusOK)
	rc := o.rc
	if o.gz && send(w, rc, gzipHeader, eventWriteWait) != nil {
		return
	}
	if rc.Flush() != nil {
		return
	}

	beat := time.NewTicker(heartbeatEvery)
	defer beat.Stop()
	life := time.NewTimer(streamLife())
	defer life.Stop()
	var last uint64
	for first := true; ; first = false {
		v := h.since(last, first)
		if v.snap || len(v.frames) > 0 {
			if err := v.write(o); err != nil {
				return
			}
		}
		last = v.seq
		select {
		case <-v.wake:
		case <-beat.C:
			if o.send(heartbeat, packedHeartbeat, eventWriteWait) != nil || rc.Flush() != nil {
				return
			}
		case <-life.C:
			o.end()
			return
		case <-r.Context().Done():
			return
		}
	}
}

func (v view) write(o *out) error {
	if v.snap {
		b, err := v.snapshotFrame()
		if err != nil {
			return err
		}
		if err := o.send(b, nil, snapshotWriteWait); err != nil { // per stream (its clocks), so deflated here
			return err
		}
		if v.stats != nil {
			if err := o.send(v.stats, v.statsZ, snapshotWriteWait); err != nil {
				return err
			}
		}
	}
	for i, f := range v.frames {
		if err := o.send(f, v.packed[i], eventWriteWait); err != nil {
			return err
		}
	}
	return o.rc.Flush()
}

func send(w http.ResponseWriter, rc *http.ResponseController, b []byte, wait time.Duration) error {
	if err := rc.SetWriteDeadline(time.Now().Add(wait)); err != nil {
		return err
	}
	_, err := w.Write(b)
	return err
}
