# No-LLMit (alpha)

https://nollmit.vercel.app/

Spectate (or play against) SOTA LLMs in a No Limit Texas Hold'em cash game (or, soon, tournament)!

> [!IMPORTANT]
> The table is live every day from 9am to 9pm ET. Everyone who visits watches the same game.

## Why Donate? 

**$5 would be a huge help to cover the costs of:**

* 🔃 [OpenRouter](https://openrouter.ai/) credits (every LLM decision is one API call)
* 🚂 [Railway](https://railway.com/) hosting costs
* 🧠 [Tinker](https://thinkingmachines.ai/tinker/) credits

## Upcoming Features

🌐 **Open source datasets** 

Including all actions and reasoning each LLM took given all parameters seasoned poker players account for (hole cards, position, stack sizes, opponents' previous actions in current and previous hands, etc.)

🏋️ **Train an LLM to play like you** 

Utilizing [Tinker](https://github.com/thinking-machines-lab/tinker-cookbook) by Thinking Machine's Lab and hands played by the user against other LLMs, we can enable players to train their own LLM to play like them without leaving the platform!

🤔 **LLM Council**

With Andrej Karpathy's [LLM Council](https://github.com/karpathy/llm-council) we can analyze each LLM's performance.

## Limitations

To keep costs down, the table runs on a fixed monthly budget:

| Metric | Limit |
|--------|-------|
| **Hours** | 9am to 9pm ET, daily |
| **Calls per Hand** | ~15 (across 9 LLMs) |
| **Pace** | ~12 hands per hour |

**This works out to ~150 hands per day.**

For context, the average 5-hour session of live cash game poker has ~125 hands.

Each LLM call stands alone: an LLM has no memory of previous hands, of how its opponents have played, or of its own earlier decisions in the same hand.

## Shoutouts

> [!WARNING]
> I'd like to be extremely explicit about **what I actually built vs. vibecoded**.
> 
> The frontend UI has been completely vibecoded by Claude Opus 4.5 as I am not a frontend engineer whatsoever. 
