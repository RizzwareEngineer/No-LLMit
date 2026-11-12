"""
The roster: every model that can take a seat, and the OpenRouter model behind each one.

MODELS is the full roster. Nine of them are seated at the table: DEFAULT_LINEUP unless the
LINEUP env var (comma-separated display names) says otherwise. The engine reads the seated
names from GET /models at startup, so changing LINEUP needs no engine change. Slugs were
checked against https://openrouter.ai/api/v1/models on 2026-11-05.
"""

import os

SEATS = 9

# Display name -> OpenRouter model ID
MODELS = {
    # Seated by default: the cheapest sensible model from each family.
    "GPT-OSS 20B": "openai/gpt-oss-20b",
    "Claude Haiku 5.5": "anthropic/claude-haiku-5.5",
    "Gemma 3 12B": "google/gemma-3-12b-it",
    "Llama 3.1 8B": "meta-llama/llama-3.1-8b-instruct",
    "Mistral Nemo": "mistralai/mistral-nemo",
    "DeepSeek V4 Flash": "deepseek/deepseek-v4-flash",
    "Phi-4": "microsoft/phi-4",
    "Qwen 3.7 Flash": "qwen/qwen3.7-flash",
    "Cohere Command R7B": "cohere/command-r7b-12-2024",
    # Open-weight candidates for future sessions.
    "Qwen3 235B A22B": "qwen/qwen3-235b-a22b-2507",
    "Qwen3 32B": "qwen/qwen3-32b",
    "DeepSeek V3.2": "deepseek/deepseek-v3.2",
    "Llama 4 Maverick": "meta-llama/llama-4-maverick",
    "Mistral Large 3": "mistralai/mistral-large-2512",
    "Gemma 3 27B": "google/gemma-3-27b-it",
    "GLM-4.6": "z-ai/glm-4.6",
    "Kimi K2": "moonshotai/kimi-k2-0905",
    "GPT-OSS 120B": "openai/gpt-oss-120b",
    "Nemotron 3.5 Super": "nvidia/nemotron-3.5-super-vl",
}

DEFAULT_LINEUP = list(MODELS)[:SEATS]


def parse_lineup(value: str | None) -> list[str]:
    """Seated names from a LINEUP value. Empty means DEFAULT_LINEUP; unknown or repeated
    names, or a count other than SEATS, raise ValueError so a typo fails at startup."""
    if not value or not value.strip():
        return list(DEFAULT_LINEUP)
    names = [n.strip() for n in value.split(",") if n.strip()]
    for i, name in enumerate(names, 1):
        if name not in MODELS:
            raise ValueError(f"LINEUP entry {i} {name!r} is not in the roster (llm/registry.py MODELS)")
        if name in names[:i - 1]:
            raise ValueError(f"LINEUP entry {i} {name!r} is listed twice")
    if len(names) != SEATS:
        raise ValueError(f"LINEUP has {len(names)} names; it needs exactly {SEATS}")
    return names


def rotated_lineup(session: int) -> list[str]:
    """The mock-mode lineup for a session: SEATS consecutive roster names starting at
    session * SEATS, wrapping, so every roster model is seated within a few sessions."""
    roster = list(MODELS)
    start = session * SEATS
    return [roster[(start + k) % len(roster)] for k in range(SEATS)]


LINEUP = parse_lineup(os.getenv("LINEUP"))
