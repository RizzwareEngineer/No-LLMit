package api

import (
	"errors"
	"reflect"
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
	if got := seatedPlayers(down); !reflect.DeepEqual(got, defaultPlayers) {
		t.Errorf("down: got %v", got)
	}
	empty := func() ([]string, error) { return nil, nil }
	if got := seatedPlayers(empty); !reflect.DeepEqual(got, defaultPlayers) {
		t.Errorf("empty: got %v", got)
	}
	want := []string{"A", "B", "C"}
	if got := seatedPlayers(func() ([]string, error) { return want, nil }); !reflect.DeepEqual(got, want) {
		t.Errorf("up: got %v", got)
	}
}
