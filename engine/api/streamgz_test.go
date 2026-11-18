package api

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"hash/crc32"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// A gzipped stream is the plain stream's bytes exactly: the shared deflated segments, the
// stored seq prefixes and the trailer make one gzip member whose CRC and length check out.
func TestGzipSegmentsDecodeToThePlainFrames(t *testing.T) {
	h := newHub()
	big := []byte(`{"models":[` + strings.Repeat(`{"name":"m","hands":1250,"pnl":-1234567},`, 3000) + `{}]}`)
	h.publish("", nil, big, ServerMessage{Type: MsgStats, Payload: map[string]any{}})
	h.publish("tbl_a", &tableSnap{State: GameStatePayload{HandNumber: 9, Players: []PlayerStatePayload{{Name: "A", Stack: 12345}}}}, nil, handStartMsg(9), ServerMessage{Type: MsgGameState})
	v := h.since(0, true)
	snap, err := v.snapshotFrame()
	if err != nil {
		t.Fatal(err)
	}
	o := &out{gz: true}
	var plain, wire bytes.Buffer
	wire.Write(gzipHeader)
	add := func(p, z []byte) {
		if z == nil {
			z = deflateSeg(p)
		}
		plain.Write(p)
		wire.Write(z)
		o.crc, o.n = crc32.Update(o.crc, crc32.IEEETable, p), o.n+uint32(len(p))
	}
	add(snap, nil)
	add(v.stats, v.statsZ)
	live := h.since(0, false)
	for i, f := range live.frames {
		add(f, live.packed[i])
	}
	add(heartbeat, packedHeartbeat)
	add(sseFrame(5, []byte(`{}`)), packBody([]byte(`{}`)).frame(5))
	wire.Write(o.trailer())

	zr, err := gzip.NewReader(&wire)
	if err != nil {
		t.Fatal(err)
	}
	got, err := io.ReadAll(zr) // checks the CRC and the length
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, plain.Bytes()) {
		t.Errorf("decoded %d bytes, want the plain %d", len(got), plain.Len())
	}
	if len(v.statsZ)*5 > len(v.stats) {
		t.Errorf("stats frame deflated to %d of %d bytes", len(v.statsZ), len(v.stats))
	}
}

// A client that accepts gzip gets the stream gzipped, each frame readable as it lands (the
// stream never ends while it watches); one that does not gets it plain. Both read the same frames.
func TestStreamIsGzippedWhenAccepted(t *testing.T) {
	h := newHub()
	h.publish("", nil, []byte(`{"models":[{"name":"m","pnl":-1250}]}`), ServerMessage{Type: MsgStats, Payload: map[string]any{}})
	h.publish("tbl_a", &tableSnap{State: GameStatePayload{HandNumber: 4}}, nil, handStartMsg(4))
	srv := httptest.NewServer(http.HandlerFunc(h.handleStream))
	defer srv.Close()

	var bodies []io.Closer
	defer func() { // before the server's Close, which waits for open streams
		for _, b := range bodies {
			b.Close()
		}
	}()
	type stream struct {
		enc string
		r   *bufio.Reader
	}
	open := func(accept string) stream {
		req, _ := http.NewRequest("GET", srv.URL, nil)
		req.Header.Set("Accept-Encoding", accept) // set by hand, so the transport leaves the body as sent
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		bodies = append(bodies, resp.Body)
		var body io.Reader = resp.Body
		if resp.Header.Get("Content-Encoding") == "gzip" {
			if body, err = gzip.NewReader(resp.Body); err != nil {
				t.Fatal(err)
			}
		}
		return stream{resp.Header.Get("Content-Encoding"), bufio.NewReader(body)}
	}
	next := func(s stream) string {
		line, err := s.r.ReadString('\n')
		if err != nil {
			t.Fatalf("%q: %v", s.enc, err)
		}
		s.r.ReadString('\n')
		return line
	}
	zs, ps := open("gzip, deflate, br, zstd"), open("identity")
	if zs.enc != "gzip" || ps.enc != "" {
		t.Fatalf("Content-Encoding %q with gzip accepted, %q without", zs.enc, ps.enc)
	}
	z := []string{next(zs), next(zs)} // the snapshot and the stats
	p := []string{next(ps), next(ps)}
	h.publish("tbl_a", &tableSnap{}, nil, handStartMsg(5))
	z, p = append(z, next(zs)), append(p, next(ps))
	if !strings.Contains(z[0], `"type":"snapshot"`) || !strings.Contains(z[1], `"pnl":-1250`) || !strings.Contains(z[2], `"type":"hand_start"`) {
		t.Errorf("gzipped frames %q", z)
	}
	for i := range z {
		if z[i] != p[i] {
			t.Errorf("gzipped frame %d %q differs from the plain %q", i, z[i], p[i])
		}
	}
}

// acceptsGzip parses the q value: the name is case-insensitive, and q=0 in any spelling, or a
// q that does not parse, refuses gzip.
func TestAcceptsGzipParsesQ(t *testing.T) {
	for _, c := range []struct {
		accept string
		want   bool
	}{
		{"gzip", true}, {"GZIP", true}, {"gzip;q=0.5", true}, {"br, GZIP;q=0.5", true}, {"gzip; q=1", true},
		{"gzip;q=0", false}, {"gzip;Q=0", false}, {"gzip;q=0.", false}, {"gzip;q=0.000", false},
		{"gzip; q = 0", false}, {"gzip;q=abc", false}, {"br, gzip;q=0", false},
		{"identity", false}, {"", false}, {"deflate", false},
	} {
		r, _ := http.NewRequest("GET", "/", nil)
		r.Header.Set("Accept-Encoding", c.accept)
		if acceptsGzip(r) != c.want {
			t.Errorf("Accept-Encoding %q: gzip %v", c.accept, !c.want)
		}
	}
}

// The real handler, gzip accepted, to the end of a short stream life: every frame goes through
// out.send (snapshot, stats, a live frame) and out.end writes the trailer, so reading the body to
// EOF through gzip.NewReader checks the handler's own CRC and ISIZE.
func TestGzipStreamEndsWithAValidTrailer(t *testing.T) {
	t.Setenv("FIXTURE_STREAM_LIFE_S", "0.6")
	h := newHub()
	h.publish("", nil, []byte(`{"models":[{"name":"m","pnl":-1250}]}`), ServerMessage{Type: MsgStats, Payload: map[string]any{}})
	h.publish("tbl_a", &tableSnap{State: GameStatePayload{HandNumber: 4}}, nil, handStartMsg(4))
	srv := httptest.NewServer(http.HandlerFunc(h.handleStream))
	defer srv.Close()
	req, _ := http.NewRequest("GET", srv.URL, nil)
	req.Header.Set("Accept-Encoding", "gzip")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.Header.Get("Content-Encoding") != "gzip" {
		t.Fatalf("Content-Encoding %q", resp.Header.Get("Content-Encoding"))
	}
	zr, err := gzip.NewReader(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	br := bufio.NewReader(zr)
	br.ReadString('\n') // the snapshot is out: publish a live frame mid-stream
	h.publish("tbl_a", &tableSnap{}, nil, handStartMsg(5))
	rest, err := io.ReadAll(br) // to EOF: the trailer's CRC and length are checked here
	if err != nil {
		t.Fatalf("gzip body to EOF: %v", err)
	}
	if !strings.Contains(string(rest), `"pnl":-1250`) || !strings.Contains(string(rest), `"type":"hand_start"`) {
		t.Errorf("stream body %q", rest)
	}
}
