package history

import (
	"strings"
	"testing"
)

func TestReadHandsSkipsAnUnreadableLine(t *testing.T) {
	in := `{"hand_id":"a"}` + "\n\n" + `{"hand_id":"b"}` + "\n" + `{"schema":1,"hand_id":"x`
	hands, err := ReadHands(strings.NewReader(in))
	if err != nil || len(hands) != 2 || hands[0].HandID != "a" || hands[1].HandID != "b" {
		t.Errorf("%+v %v", hands, err)
	}
}
