package api

import (
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
