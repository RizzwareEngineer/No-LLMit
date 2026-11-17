// The stream's gzip: /stream goes out gzipped to a client that accepts it, so the opening
// (the snapshot and the whole all-time stats body) costs a phone about a tenth of its bytes.
// No stream holds a compressor: each frame is deflated once, when the hub frames it, into a
// segment that ends on a byte boundary (a sync flush, never a final block), and a stream
// sends the segments one after another, which is one valid deflate stream. The seq prefix,
// known only under the hub's lock, goes in front as a stored (uncompressed) block, so the
// body is deflated before the lock. Each stream keeps only the gzip trailer's CRC and length.
package api

import (
	"bytes"
	"compress/flate"
	"encoding/binary"
	"hash/crc32"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

var gzipHeader = []byte{0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 0xff} // deflate, no name, no time, unknown OS

// gzFinal ends the deflate stream: an empty final stored block.
var gzFinal = []byte{1, 0, 0, 0xff, 0xff}

var deflaters = sync.Pool{New: func() any {
	w, _ := flate.NewWriter(nil, flate.DefaultCompression)
	return w
}}

// deflateSeg deflates b into a segment that can be followed by any other segment.
func deflateSeg(b []byte) []byte {
	var buf bytes.Buffer
	w := deflaters.Get().(*flate.Writer)
	w.Reset(&buf)
	w.Write(b)
	w.Flush() // a sync flush: byte-aligned, not final
	deflaters.Put(w)
	return buf.Bytes()
}

// storedSeg is b as one stored block (b is under 64 KB).
func storedSeg(b []byte) []byte {
	n := uint16(len(b))
	return append([]byte{0, byte(n), byte(n >> 8), byte(^n), byte(^n >> 8)}, b...)
}

// packedBody is an envelope's body from its second byte (what follows `data: {"seq":N,`),
// plus the frame's end, deflated before the hub's lock.
type packedBody struct {
	rest []byte // body[1:] + "\n\n" deflated
	bare bool   // the body was "{}": the prefix takes no comma
}

func packBody(body []byte) packedBody {
	return packedBody{deflateSeg(append(append([]byte{}, body[1:]...), "\n\n"...)), len(body) <= 2}
}

// packedFrame is the frame sseFrame(seq, body) makes, as segments.
func (p packedBody) frame(seq uint64) []byte {
	pre := strconv.AppendUint([]byte(`data: {"seq":`), seq, 10)
	if !p.bare {
		pre = append(pre, ',')
	}
	return append(storedSeg(pre), p.rest...)
}

var packedHeartbeat = storedSeg(heartbeat)

// acceptsGzip: the request's Accept-Encoding lists gzip without q=0.
func acceptsGzip(r *http.Request) bool {
	for _, part := range strings.Split(r.Header.Get("Accept-Encoding"), ",") {
		name, params, _ := strings.Cut(strings.TrimSpace(part), ";")
		if strings.EqualFold(strings.TrimSpace(name), "gzip") {
			q := strings.ReplaceAll(params, " ", "")
			return q != "q=0" && q != "q=0.0" && q != "q=0.00" && q != "q=0.000"
		}
	}
	return false
}

// out writes one stream's frames, gzipped or as they are.
type out struct {
	w   http.ResponseWriter
	rc  *http.ResponseController
	gz  bool
	crc uint32 // of every plain byte sent, for the gzip trailer
	n   uint32 // plain bytes sent, mod 2^32
}

// send writes a frame: plain as it is, or its packed segment (deflated now when packed is nil).
func (o *out) send(plain, packed []byte, wait time.Duration) error {
	b := plain
	if o.gz {
		if packed == nil {
			packed = deflateSeg(plain)
		}
		b = packed
		o.crc = crc32.Update(o.crc, crc32.IEEETable, plain)
		o.n += uint32(len(plain))
	}
	return send(o.w, o.rc, b, wait)
}

// end closes the gzip stream properly when the stream ends on its own (its lifetime).
func (o *out) end() {
	if o.gz && send(o.w, o.rc, o.trailer(), eventWriteWait) == nil {
		o.rc.Flush()
	}
}

// trailer is the final block and the gzip trailer for what was sent so far.
func (o *out) trailer() []byte {
	return binary.LittleEndian.AppendUint32(binary.LittleEndian.AppendUint32(append([]byte{}, gzFinal...), o.crc), o.n)
}
