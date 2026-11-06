"""
The roster: every model that can take a seat, and the OpenRouter model behind each one.

MODELS is the full roster. Nine of them are seated at the table: DEFAULT_LINEUP unless the
LINEUP env var (comma-separated display names) says otherwise. The engine reads the seated
names from GET /models at startup, so changing LINEUP needs no engine change. Slugs and
prices were checked against https://openrouter.ai/api/v1/models on 2026-11-05.
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

# OpenRouter list price, USD per million tokens: (prompt, completion). 2026-11-05.
PRICES = {
    "GPT-OSS 20B": (0.03, 0.13),
    "Claude Haiku 5.5": (0.10, 0.50),
    "Gemma 3 12B": (0.05, 0.15),
    "Llama 3.1 8B": (0.05, 0.08),
    "Mistral Nemo": (0.029, 0.03),
    "DeepSeek V4 Flash": (0.091, 0.182),
    "Phi-4": (0.07, 0.14),
    "Qwen 3.7 Flash": (0.03, 0.13),
    "Cohere Command R7B": (0.0375, 0.15),
    "Qwen3 235B A22B": (0.14, 0.80),
    "Qwen3 32B": (0.08, 0.28),
    "DeepSeek V3.2": (0.26, 0.38),
    "Llama 4 Maverick": (0.35, 1.00),
    "Mistral Large 3": (0.50, 1.50),
    "Gemma 3 27B": (0.08, 0.35),
    "GLM-4.6": (0.50, 2.00),
    "Kimi K2": (0.60, 2.50),
    "GPT-OSS 120B": (0.022, 0.083),
    "Nemotron 3.5 Super": (0.15, 0.50),
}

DEFAULT_LINEUP = list(MODELS)[:SEATS]


def get_model_id(display_name: str) -> str:
    """Get the OpenRouter model ID for a seat. Raises KeyError for an unknown seat."""
    return MODELS[display_name]


def list_models() -> list[str]:
    """List every roster name."""
    return list(MODELS.keys())


def parse_lineup(value: str | None) -> list[str]:
    """Seated names from a LINEUP value. Empty means DEFAULT_LINEUP; unknown or repeated
    names, or a count other than SEATS, raise ValueError so a typo fails at startup."""
    if not value or not value.strip():
        return list(DEFAULT_LINEUP)
    names = [n.strip() for n in value.split(",") if n.strip()]
    unknown = [n for n in names if n not in MODELS]
    if unknown:
        raise ValueError(f"LINEUP has names not in the roster: {unknown}")
    if len(set(names)) != len(names) or len(names) != SEATS:
        raise ValueError(f"LINEUP needs {SEATS} distinct names, got {names}")
    return names


def rotated_lineup(session: int) -> list[str]:
    """The mock-mode lineup for a session: SEATS consecutive roster names starting at
    session * SEATS, wrapping, so every roster model is seated within a few sessions."""
    roster = list(MODELS)
    start = session * SEATS
    return [roster[(start + k) % len(roster)] for k in range(SEATS)]


LINEUP = parse_lineup(os.getenv("LINEUP"))
