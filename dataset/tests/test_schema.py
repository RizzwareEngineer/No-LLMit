"""The Supabase schema with several tables: every migration applied in order to an empty
Postgres database, then save_hand called the way the engine calls it. Runs only with
PG_TEST_URL set to a scratch database (its public schema is dropped) and psql installed."""

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

MIGRATIONS = sorted((Path(__file__).parents[2] / "supabase" / "migrations").glob("*.sql"))
URL = os.environ.get("PG_TEST_URL")

pytestmark = pytest.mark.skipif(not URL or not shutil.which("psql"), reason="needs PG_TEST_URL and psql")

# What Supabase provides before the migrations run.
BOOTSTRAP = """
drop schema if exists public cascade;
create schema public;
do $$ begin
  create role anon; exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role; exception when duplicate_object then null; end $$;
"""


def psql(sql=None, file=None):
    args = ["psql", URL, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"]
    args += ["-f", str(file)] if file else ["-c", sql]
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout.strip()


def hand(table_id, key, n=1):
    h = {"schema": 1, "hand_id": f"{table_id}-{n:06d}", "table_id": table_id, "hand_number": n,
         "started_at": "2026-11-27T12:00:00Z", "ended_at": "2026-11-27T12:01:00Z",
         "config": {"small_blind": 1, "big_blind": 2, "prompt_version": "v1"}}
    if key:
        h["table_key"] = key
    return h


def save(h):
    prompts = [{"prompt_id": h["hand_id"] + "-01", "n": 1, "prompt": "P", "raw_reply": "R"}]
    lit = lambda v: "'" + json.dumps(v).replace("'", "''") + "'::jsonb"
    psql(f"select public.save_hand({lit(h)}, {lit(prompts)}, 'S')")


def test_save_hand_records_each_tables_key():
    psql(BOOTSTRAP)
    for m in MIGRATIONS:
        psql(file=m)
    # Two tables deal hand 1 at the same moment; a hand from before several tables has no key.
    for h in (hand("tbl_aaaaaaaaaaaaaaaa", "1-2-100bb"), hand("tbl_bbbbbbbbbbbbbbbb", "5-10-200bb"), hand("tbl_cccccc", None)):
        save(h)
        save(h)  # the engine's retry: a no-op
    rows = psql("select hand_id, coalesce(table_key, '-') from public.hands order by hand_id").splitlines()
    assert rows == ["tbl_aaaaaaaaaaaaaaaa-000001|1-2-100bb", "tbl_bbbbbbbbbbbbbbbb-000001|5-10-200bb", "tbl_cccccc-000001|-"]
    assert psql("select count(*) from public.decision_prompts") == "3"
    assert psql("select count(*) from public.hands where table_key = '5-10-200bb'") == "1"
    cols = psql("select column_name from information_schema.columns where table_name = 'hands_voided'").split()
    assert "table_key" in cols
