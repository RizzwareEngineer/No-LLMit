"""
Seat names and the OpenRouter model behind each one.

These are the cheapest sensible model from each family, chosen to get the table running
at low cost. The names must match tablePlayers in engine/api/table.go.
"""

# Seat name -> OpenRouter model ID
MODELS = {
    "GPT-OSS 20B": "openai/gpt-oss-20b",
    "Claude Haiku 5.5": "anthropic/claude-haiku-5.5",
    "Gemma 3 12B": "google/gemma-3-12b-it",
    "Llama 3.1 8B": "meta-llama/llama-3.1-8b-instruct",
    "Mistral Nemo": "mistralai/mistral-nemo",
    "DeepSeek V4 Flash": "deepseek/deepseek-v4-flash",
    "Phi-4": "microsoft/phi-4",
    "Qwen 3.7 Flash": "qwen/qwen3.7-flash",
    "Cohere Command R7B": "cohere/command-r7b-12-2024",
}


def get_model_id(display_name: str) -> str:
    """Get the OpenRouter model ID for a seat. Raises KeyError for an unknown seat."""
    return MODELS[display_name]


def list_models() -> list[str]:
    """List seat names."""
    return list(MODELS.keys())
