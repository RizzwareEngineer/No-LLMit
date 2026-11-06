package api

import (
	"errors"
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
