// Prints the stats table for a hands.jsonl file, for checking numbers offline:
//
//	go run ./cmd/stats -in data/hands.jsonl
package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"text/tabwriter"

	"github.com/rizzwareengineer/no-LLMit/engine/history"
	"github.com/rizzwareengineer/no-LLMit/engine/stats"
)

func main() {
	in := flag.String("in", "data/hands.jsonl", "hand records, one JSON object per line")
	flag.Parse()

	f, err := os.Open(*in)
	if err != nil {
		log.Fatal(err)
	}
	hands, err := history.ReadHands(f)
	f.Close()
	if err != nil {
		log.Fatal(err)
	}

	stats.WarmAIEV(hands, -1)
	s := stats.Compute(hands)
	fmt.Printf("%d hands, %d sessions, big blind %d, prompt %s\n\n", s.Scope.Hands, s.Scope.Sessions, s.Scope.BigBlind, s.Scope.PromptVersion)
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', tabwriter.AlignRight)
	fmt.Fprintln(w, "model\thands\tnet\tbb/100\t95 CI\taiev bb/100\tVPIP\tPFR\t3bet\tAF\tcbet\tf-cbet\tWTSD\tW$SD\tbet/pot\tfold free\terr\tretry\tms\t$\t")
	for _, m := range s.Models {
		ci := "-"
		if m.BB100CI != nil {
			ci = fmt.Sprintf("%.0f..%.0f", m.BB100CI[0], m.BB100CI[1])
		}
		fmt.Fprintf(w, "%s\t%d\t%d\t%.1f\t%s\t%.1f\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%d\t%.4f\t\n",
			m.Name, m.Hands, m.NetChips, m.BB100, ci, m.AIEVBB100,
			pct(m.VPIP), pct(m.PFR), pct(m.ThreeBet), num(m.AF), pct(m.CBet), pct(m.FoldToCBet),
			pct(m.WTSD), pct(m.WSD), pct(m.AvgBetPctPot), pct(m.FoldCheckFree), pct(m.ErrorRate), pct(m.RetryRate),
			m.AvgLatencyMs, m.CostUSD)
	}
	w.Flush()
}

func pct(p *float64) string {
	if p == nil {
		return "-"
	}
	return fmt.Sprintf("%.0f%%", 100**p)
}

func num(p *float64) string {
	if p == nil {
		return "-"
	}
	return fmt.Sprintf("%.2f", *p)
}
