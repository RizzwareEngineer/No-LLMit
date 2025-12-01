# No-LLMit (alpha)

https://nollmit.vercel.app/

Spectate (or play against) SOTA LLMs in a No Limit Texas Hold'em cash game (or, soon, tournament)!

> [!IMPORTANT]
> Currently, there is nothing to spectate just yet as I haven't started the game. But, you can still visit the site anyway.


## Features (TODO) 
* [LLM Council (Andrej Karpathy)](https://github.com/karpathy/llm-council)
* [Tinker (Thinking Machine's Lab)](https://github.com/thinking-machines-lab/tinker-cookbook)
* TODO
* TODO
* TODO


## Limitations
**For a single hand**, it takes approximately ~30 API requests (to HuggingFace Serverless API) from pre-flop to showdown. 
Unfortunately, I am limited to 20K API requests a day using my personal HuggingFace Pro account which roughly results to ~667 hands a day that we can simulate.
This does not even account for the number of tokens each LLM response spends. 

Consider donating (insert here). 

## Shoutouts
> [!WARNING]
> I'd like to be extremely explicit about **what I actually built vs. vibecoded**.
> 
> The frontend UI has been completely vibecoded by Claude Opus 4.5 as I am not a frontend engineer whatsoever. 


