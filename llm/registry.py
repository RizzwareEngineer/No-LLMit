"""
Model registry mapping player display names to HuggingFace model IDs.

For testing, all players use the same model (Llama 3.1-8B).
"""

TEST_MODEL = "meta-llama/Llama-3.1-8B-Instruct"

# Player name -> HuggingFace model ID
MODELS = {
    "GPT-4o": TEST_MODEL,
    "Claude 3.5": TEST_MODEL,
    "Gemini Pro": TEST_MODEL,
    "Llama 3": TEST_MODEL,
    "Mistral Large": TEST_MODEL,
    "DeepSeek V3": TEST_MODEL,
    "Grok 2": TEST_MODEL,
    "Qwen 2.5": TEST_MODEL,
    "Cohere R+": TEST_MODEL,
}

DEFAULT_MODEL = TEST_MODEL


def get_model_id(display_name: str) -> str:
    """Get HuggingFace model ID from display name."""
    return MODELS.get(display_name, DEFAULT_MODEL)


def list_models() -> list[str]:
    """List available model display names."""
    return list(MODELS.keys())

