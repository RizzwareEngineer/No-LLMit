"""Round trip: export fixtures, reload the Parquet, and parse the PokerStars text back."""

import glob
import json
import os
import re
from collections import Counter
from pathlib import Path

import pyarrow.parquet as pq
import pytest

import export

HERE = Path(__file__).parent
ROOT = HERE.parent.parent
GENERATED = HERE / "fixtures" / "generated"  # 40 hands played through the engine's recorder
# Two engine hands where its payout differs from poker rules (from a 2400-hand fuzz run).
REPRO = HERE / "fixtures" / "repro_hands.jsonl"


def example_source(tmp_path):
    doc = json.loads((ROOT / "docs" / "hand-record-example.json").read_text())
    hands, prompts = tmp_path / "ex_hands.jsonl", tmp_path / "ex_prompts.jsonl"
    hands.write_text(json.dumps(doc["hand"]) + "\n")
    prompts.write_text("".join(json.dumps(p) + "\n" for p in doc["prompts"]))
    return hands, prompts


def repro_source(tmp_path):
    """The repro hands carry no prompts, so give each decision a stand-in."""
    hands = [json.loads(line) for line in REPRO.read_text().splitlines()]
    prompts = [{"prompt_id": a["prompt_id"], "n": a["n"], "prompt": "P", "raw_reply": "R"}
               for h in hands for a in h["actions"]]
    p = tmp_path / "repro_prompts.jsonl"
    p.write_text("".join(json.dumps(x) + "\n" for x in prompts))
    return REPRO, p


def sources(tmp_path):
    yield example_source(tmp_path)
    yield GENERATED / "hands.jsonl", GENERATED / "prompts.jsonl"
    yield repro_source(tmp_path)


@pytest.fixture
def exported(tmp_path):
    out = tmp_path / "out"
    hands, prompts = [], []
    for h, p in sources(tmp_path):
        hs, ps, _ = export.load_jsonl(h, p)
        hands += hs
        prompts += ps
    export.main(["--out", str(out), "--from-jsonl", *map(str, _write(tmp_path, hands, prompts))])
    return out, hands, prompts


def _write(tmp_path, hands, prompts):
    h, p = tmp_path / "all_hands.jsonl", tmp_path / "all_prompts.jsonl"
    h.write_text("".join(json.dumps(x) + "\n" for x in hands))
    p.write_text("".join(json.dumps(x) + "\n" for x in prompts))
    return h, p


def read_day(out, day, name):
    return pq.read_table(out / f"day={day}" / f"{name}.parquet").to_pylist()


def read(out, name):
    files = sorted(glob.glob(str(out / "day=*" / f"{name}.parquet")))
    assert files
    rows = []
    for f in files:
        rows += pq.read_table(f).to_pylist()
    return rows


def test_files_and_row_counts(exported):
    out, hands, prompts = exported
    days = sorted(p.name for p in out.glob("day=*"))
    assert set(days) == {"day=2026-10-09", "day=2026-11-02", "day=2026-11-03"}
    assert (out / ".exported-days").read_text().split() == [d[4:] for d in days]
    # The generated hands run past midnight UTC but not ET, so they stay in one day.
    gen_days = {json.loads(line)["started_at"][:10] for line in (GENERATED / "hands.jsonl").read_text().splitlines()}
    assert gen_days == {"2026-11-02", "2026-11-03"}
    assert len(read_day(out, "2026-11-03", "hands")) == 2  # only the repro hands
    for d in days:
        for f in ("hands.jsonl", "hands.parquet", "seats.parquet", "decisions.parquet", "pokerstars.txt"):
            assert (out / d / f).stat().st_size > 0, f"{d}/{f}"
    assert (out / "README.md").exists()

    assert len(read(out, "hands")) == len(hands)
    assert len(read(out, "seats")) == sum(len(h["seats"]) for h in hands)
    assert len(read(out, "decisions")) == sum(len(h["actions"]) for h in hands)
    raw = [json.loads(line) for f in out.glob("day=*/hands.jsonl") for line in f.read_text().splitlines()]
    assert sorted(raw, key=lambda h: h["hand_id"]) == sorted(hands, key=lambda h: h["hand_id"])


def test_net_sums_to_zero(exported):
    out, hands, _ = exported
    net = Counter()
    for s in read(out, "seats"):
        net[s["hand_id"]] += s["net"]
    assert len(net) == len(hands)
    assert all(v == 0 for v in net.values()), {k: v for k, v in net.items() if v}


def test_every_prompt_id_resolves(exported):
    out, _, prompts = exported
    by_id = {p["prompt_id"]: p for p in prompts}
    decisions = read(out, "decisions")
    for d in decisions:
        p = by_id[d["prompt_id"]]
        assert d["prompt"] == p["prompt"] and d["raw_reply"] == p["raw_reply"]
        assert d["prompt_id"].startswith(d["hand_id"] + "-")
    statuses = Counter(d["status"] for d in decisions)
    assert statuses["ok"] and len(statuses) > 1  # the fixtures cover fallbacks


def test_missing_prompt_fails_loudly():
    doc = json.loads((ROOT / "docs" / "hand-record-example.json").read_text())
    with pytest.raises(ValueError, match="no prompt"):
        export.flatten([doc["hand"]], doc["prompts"][1:])


def test_card(exported):
    out, _, _ = exported
    card = (out / "README.md").read_text()
    assert "license: cc-by-4.0" in card and 'status != "ok"' in card
    assert "d7fd8ae" in card and "vendor/Phi-4" in card
    assert "| `raw_reply` |" in card


# A tiny PokerStars parser: enough to read back who did what, in order.
ACTION = re.compile(r"^(?P<who>.+?): (?P<verb>folds|checks|calls|bets|raises|posts (?:small|big) blind)"
                    r"(?: (?P<a>\d+))?(?: to (?P<to>\d+))?(?P<allin> and is all-in)?$")
STREET = re.compile(r"^\*\*\* (FLOP|TURN|RIVER) \*\*\*")


def parse_stars(text):
    """{hand number: [(street, player, verb, chips added, street total after, all-in)]}"""
    hands = {}
    for block in text.strip().split("\n\n\n"):
        lines = block.splitlines()
        number = int(re.match(r"PokerStars Hand #(\d+):", lines[0]).group(1))
        street, total, actions = "preflop", Counter(), []
        for line in lines:
            if line.startswith("*** SUMMARY"):
                break
            if m := STREET.match(line):
                street, total = m.group(1).lower(), Counter()
                continue
            if m := re.match(r"^Uncalled bet \((\d+)\) returned to (.+)$", line):
                total[m.group(2)] -= int(m.group(1))
                continue
            m = ACTION.match(line)
            if not m:
                continue
            who, verb = m["who"], m["verb"].split()[0]
            before = total[who]
            if verb in ("calls", "posts"):
                total[who] += int(m["a"])
            elif verb == "bets":
                total[who] = int(m["a"])
            elif verb == "raises":
                total[who] = int(m["to"])
            if verb != "posts":
                actions.append((street, who, verb, total[who] - before, total[who], bool(m["allin"])))
        hands[number] = actions
    return hands


VERB = {"FOLD": "folds", "CHECK": "checks", "CALL": "calls", "BET": "bets", "RAISE": "raises"}


def test_pokerstars_round_trip(exported):
    out, hands, _ = exported
    parsed = {}
    for f in out.glob("day=*/pokerstars.txt"):
        parsed.update(parse_stars(f.read_text()))
    assert len(parsed) == len(hands)
    from hh import stars_hand_number
    allins = 0
    for h in hands:
        got = parsed[stars_hand_number(h)]
        assert len(got) == len(h["actions"]), h["hand_id"]
        for a, (street, who, verb, added, street_total, allin) in zip(h["actions"], got):
            assert (street, who) == (a["street"], a["player"]), a["prompt_id"]
            kind, amount = a["applied"]["type"], a["applied"].get("amount", 0)
            if kind == "ALL_IN":
                allins += 1
                assert allin and verb in ("calls", "bets", "raises"), a["prompt_id"]
                assert street_total == amount, a["prompt_id"]
            else:
                assert verb == VERB[kind], a["prompt_id"]
                if kind == "CALL":
                    assert added == amount, a["prompt_id"]
                elif kind in ("BET", "RAISE"):
                    assert street_total == amount, a["prompt_id"]
    assert allins  # the fixtures cover all-ins and side pots


def test_pokerstars_summary_matches_net(exported):
    out, hands, _ = exported
    text = "".join(f.read_text() for f in out.glob("day=*/pokerstars.txt"))
    pots = [int(x) for x in re.findall(r"^Total pot (\d+) \| Rake 0$", text, re.M)]
    assert len(pots) == len(hands)
    winners = sum(1 for h in hands for v in h["result"]["net"].values() if v > 0)
    assert len(re.findall(r" collected \d+ from pot$", text, re.M)) >= winners


def test_supabase_pagination(monkeypatch):
    """load_supabase pages through every table and asks only for the day's hands."""
    hs, ps, _ = export.load_jsonl(GENERATED / "hands.jsonl", GENERATED / "prompts.jsonl")
    tables = {"hands": [{"doc": h} for h in hs], "decision_prompts": ps,
              "system_prompts": [{"prompt_version": "d7fd8ae", "system_prompt": "S", "created_at": "x"}]}
    calls = []

    def fake_get(base, key, path, params):
        calls.append((path, params))
        rows = tables[path]
        if path == "decision_prompts":
            wanted = set(params["hand_id"][4:-1].replace('"', "").split(","))
            rows = [p for p in rows if p["prompt_id"].rsplit("-", 1)[0] in wanted]
        return rows[params["offset"]:params["offset"] + params["limit"]]

    monkeypatch.setattr(export, "_get", fake_get)
    monkeypatch.setattr(export, "PAGE", 7)
    from datetime import date
    hands, prompts, systems = export.load_supabase("https://x.supabase.co", "k", date(2026, 11, 1))  # DST ends: a 25-hour day
    assert len(hands) == len(hs) and len(prompts) == len(ps) and systems[0]["system_prompt"] == "S"
    first = calls[0][1]
    assert first["and"] == "(started_at.gte.2026-11-01T04:00:00+00:00,started_at.lt.2026-11-02T05:00:00+00:00)"
    calls.clear()
    export.load_supabase("https://x.supabase.co", "k", date(2026, 11, 4), back=3)
    assert calls[0][1]["and"] == "(started_at.gte.2026-11-01T04:00:00+00:00,started_at.lt.2026-11-05T05:00:00+00:00)"


def test_upload_dry_run_needs_no_token(exported, monkeypatch, capsys):
    import upload
    out, _, _ = exported
    monkeypatch.delenv("HF_TOKEN", raising=False)
    upload.main(["--out", str(out), "--dry-run"])
    printed = capsys.readouterr().out
    assert "README.md" in printed and "decisions.parquet" in printed
    with pytest.raises(SystemExit):
        upload.main(["--out", str(out)])


def test_engine_payout_hands_are_written_with_a_note(exported, capsys):
    import hh
    out, _, _ = exported
    text = (out / "day=2026-11-03" / "pokerstars.txt").read_text()
    assert text.count("PokerStars Hand #") == 2
    assert "#note tbl_a00000-000004: engine payout" in text
    assert "P0 collected 23 from pot" in text and "returned to P2" not in text.split("000004")[1].split("PokerStars")[0]
    hh.hands_to_text([json.loads(line) for line in REPRO.read_text().splitlines()])
    assert "1 hand(s) carry a #note" in capsys.readouterr().err


def test_bad_hand_is_left_out_not_raised(capsys):
    import hh
    hands = [json.loads(line) for line in REPRO.read_text().splitlines()]
    hands[1]["actions"][0]["applied"]["type"] = "SHOVE"
    text = hh.hands_to_text(hands)
    assert text.count("PokerStars Hand #") == 1
    assert "left out tbl_a00000-000020" in capsys.readouterr().err


def test_pot_counts_every_chip(exported):
    out, hands, _ = exported
    pots = {h["hand_id"]: h["pot"] for h in read(out, "hands")}
    # The engine's result.pots omits a single-eligible side pot holding a folded limper's 10 chips.
    assert pots["tbl_a00000-000020"] == 23 and pots["tbl_a00000-000004"] == 23
    assert pots["tbl_684679-000002"] == 387
    for h in hands:  # every chip lost is in the pot, and the winners put something in too
        assert pots[h["hand_id"]] > -sum(v for v in h["result"]["net"].values() if v < 0), h["hand_id"]


def test_decision_value_normalisation(exported):
    out, _, _ = exported
    decisions = read(out, "decisions")
    assert all(la["type"] != "ALL-IN" for d in decisions for la in d["legal_actions"])
    assert any(la["type"] == "ALL_IN" for d in decisions for la in d["legal_actions"])
    for d in decisions:
        assert d["parsed_action"] != "ALL-IN"
        if d["parsed_action"] not in ("RAISE", "BET"):
            assert d["parsed_amount"] is None
    assert any(d["parsed_amount"] for d in decisions)
