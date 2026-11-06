import os
import re
from pathlib import Path

os.environ["LLM_PROVIDER"] = "mock"

import pytest
import requests
from fastapi.testclient import TestClient

import app
import registry


@pytest.mark.network
def test_every_roster_slug_is_on_openrouter():
    try:
        resp = requests.get("https://openrouter.ai/api/v1/models", timeout=15)
        resp.raise_for_status()
    except requests.RequestException as e:
        pytest.skip(f"OpenRouter unreachable: {e}")
    live = {m["id"] for m in resp.json()["data"]}
    missing = {name: slug for name, slug in registry.MODELS.items() if slug not in live}
    assert not missing


def test_every_roster_model_has_a_price():
    assert set(registry.PRICES) == set(registry.MODELS)


def test_web_roster_matches():
    # web/src/lib/constants.ts lists the roster for the stats table's "Not seated yet" group.
    ts = (Path(__file__).parents[2] / "web/src/lib/constants.ts").read_text()
    block = ts.split("ALL_LLMS = [", 1)[1].split("]", 1)[0]
    assert re.findall(r'"([^"]+)"', block) == registry.list_models()


def test_parse_lineup_default():
    assert registry.parse_lineup(None) == registry.DEFAULT_LINEUP
    assert registry.parse_lineup("  ") == registry.DEFAULT_LINEUP
    assert len(registry.DEFAULT_LINEUP) == registry.SEATS


def test_parse_lineup_custom():
    names = list(registry.MODELS)[-registry.SEATS:]
    assert registry.parse_lineup(" , ".join(names)) == names


@pytest.mark.parametrize("value, message", [
    ("Not A Model," + ",".join(list(registry.MODELS)[:8]), "entry 1 'Not A Model' is not in the roster"),
    (",".join(list(registry.MODELS)[:8]), "has 8 names"),
    (",".join(list(registry.MODELS)[:8] + ["Phi-4"]), "entry 9 'Phi-4' is listed twice"),
])
def test_parse_lineup_rejects_naming_the_entry(value, message):
    with pytest.raises(ValueError, match=re.escape(message)):
        registry.parse_lineup(value)


def test_rotation_seats_nine_distinct_and_covers_roster():
    roster = registry.list_models()
    sessions = -(-len(roster) // registry.SEATS)
    seen = set()
    for s in range(sessions):
        lineup = registry.rotated_lineup(s)
        assert len(lineup) == len(set(lineup)) == registry.SEATS
        assert set(lineup) <= set(roster)
        seen |= set(lineup)
    assert seen == set(roster)
    assert registry.rotated_lineup(0) == registry.DEFAULT_LINEUP
    assert registry.rotated_lineup(5) == registry.rotated_lineup(5)
    assert registry.rotated_lineup(0) != registry.rotated_lineup(1)


def test_models_endpoint_rotates_in_mock(tmp_path, monkeypatch):
    client = TestClient(app.app)
    body = client.get("/models?session=1").json()
    assert body["provider"] == "mock"
    assert body["seated"] == registry.rotated_lineup(1)
    assert [m["name"] for m in body["models"]] == registry.list_models()
    assert sum(m["seated"] for m in body["models"]) == registry.SEATS
