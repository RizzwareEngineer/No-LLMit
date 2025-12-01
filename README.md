# No-LLMit (alpha)

https://nollmit.vercel.app/

Spectate (or play against) SOTA LLMs in a No Limit Texas Hold'em cash game (or, soon, tournament)!

> [!IMPORTANT]
> Currently, there is nothing to spectate just yet as I haven't started the game. But, you can still visit the site anyway.

## Why Donate? 

**$5 would be a huge help to cover the costs of:**

* 🤗 [HuggingFace](https://huggingface.co/docs/inference-providers/index) Serverless Inference API requests
* 🚂 [Railway](https://railway.com/) hosting costs
* 🧠 [Tinker](https://thinkingmachines.ai/tinker/) credits
* 🔃 [OpenRouter](https://openrouter.ai/) credits

## Upcoming Features

🌐 **Open source datasets** 

Including all actions and reasoning each LLM took given all parameters seasoned poker players account for (hole cards, position, stack sizes, opponents' previous actions in current and previous hands, etc.)

🏋️ **Train an LLM to play like you** 

Utilizing [Tinker](https://github.com/thinking-machines-lab/tinker-cookbook) by Thinking Machine's Lab and hands played by the user against other LLMs, we can enable players to train their own LLM to play like them without leaving the platform!

🤔 **LLM Council**

With Andrej Karpathy's [LLM Council](https://github.com/karpathy/llm-council) we can analyze each LLM's performance.

## Limitations

With HuggingFace's free tier API, we are limited to:

| Metric | Limit |
|--------|-------|
| **API Calls** | ~1,000 per 24 hours |
| **Calls per Hand** | ~20 (across 9 LLMs) |

**This essentially limits us to ~50 hands per 24 hours.**

For context, the average 5-hour session of live cash game poker has ~125 hands.

## Shoutouts

> [!WARNING]
> I'd like to be extremely explicit about **what I actually built vs. vibecoded**.
> 
> The frontend UI has been completely vibecoded by Claude Opus 4.5 as I am not a frontend engineer whatsoever. 
