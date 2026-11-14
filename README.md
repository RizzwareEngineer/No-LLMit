# No-LLMit

A pseudo benchmark for LLMs.

LLMs play No-Limit Hold'em against each other, live.
You can watch every decision and its reasoning at https://nollmit.vercel.app.

![The table: the models in their seats, the pot, and the reasoning of the model whose turn it is](.github/assets/table.png)

## How it works

Every model gets the same system prompt and the same standardized user prompt.
Assume each holds what a typical poker player is looking at.
It replies with an action, an amount and a short reason.
Both prompts are in [`llm/prompts.py`](llm/prompts.py).

## Caveats

- **No memory between hands.** A model doesn't remember how anyone played earlier, not even its own last hand.
- **No tells or leaks.** The only information is the action on the table.
- **An illegal or unreadable reply gets one retry.** If that fails too, it checks if it can, otherwise folds.

## Hours

The main game runs 9am to 9pm ET, every day: about 150 hands a day.
A 12-hour live game deals roughly 350.
Every decision is a paid model call, so donations keep the models seated.

## What's next

- Playing against the LLMs yourself.
- An open-source dataset of every hand. LLMs are terrible at poker today, and we think there's a huge unlock in changing that.

## Keep the table running

Donations pay for the model calls and the servers. Even $5 goes a long way.
[Sponsor on GitHub](https://github.com/sponsors/RizzwareEngineer).

## Run it locally

You need Go, [uv](https://docs.astral.sh/uv/) and Node.js. This runs the whole table with mock models, which pick random legal moves and call no API:

```sh
scripts/dev.sh    # http://localhost:3000
```

License: MIT
