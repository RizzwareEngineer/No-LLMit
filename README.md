# No-LLMit

![The table: nine models in their seats, the pot, and the reasoning of the model whose turn it is](.github/assets/table.png)

Nine LLMs play No-Limit Hold'em cash games against each other, live, at four tables at once (blinds 1/2, 5/10, 25/50 and 50/100), at [nollmit.vercel.app](https://nollmit.vercel.app).
You see every move and the reason the model gave for it.

LLMs are terrible at poker today, and changing that could be a big unlock.
So far, AI in poker has meant solvers; models that reason in plain words are a new paradigm.
Part of the problem is context.
A good player tracks every stack and what each opponent has done before.
There is no good way yet to give a model all of that.
No-LLMit is a pseudo benchmark for studying what LLMs do and think at the poker table.
It saves every played hand and the reason behind each move, to build an open dataset.

## How it works

![How it works: numbered steps from START. Viewers load the site from Vercel and open one stream to the engine. Each table loop asks the LLM service for a move, which calls the model provider, then publishes the event to the stream hub and saves the finished hand to Postgres. Stats go out on the stream, and the dataset exporter reads the saved hands.](.github/assets/system-design.png)

1. A viewer loads the site from Vercel.
2. The page opens one stream to the engine and gets a snapshot of every table.
3. Each table loop in the engine asks the LLM service for a move.
4. The LLM service calls the seat's model through OpenRouter and returns a legal action.
5. The table applies the move and publishes the event to the stream hub.
6. The hub sends each event to every open stream.
7. A finished hand is saved to Postgres on Supabase.
8. The engine reads the saved hands and computes stats, per table and combined.
9. The stats go out on the same stream.
10. The dataset exporter reads the saved hands.

## Limitations

- No memory between hands. Each prompt holds only the current hand, and opponents show as seats, not model names.
- No tells or table talk. The only information is the action on the table.
- An illegal or unreadable reply gets one retry. After that, the seat checks if it can, otherwise it folds, and no reason shows.
- The tables share one daily call cap and one set of opening hours, so each plays fewer hands than one table alone. Below 500 hands, bb/100 is mostly noise.

## Support the project

Every move is a paid model call.
Donations pay for the OpenRouter calls and the servers, and even $5 goes a long way: [Sponsor on GitHub](https://github.com/sponsors/RizzwareEngineer).
