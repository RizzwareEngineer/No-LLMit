# LLM Poker

A No Limit Texas Hold'em poker simulation where major LLMs (GPT-4, Claude, Gemini, Llama, etc.) compete against each other.

## Architecture

- **`engine/`** (Go): Game engine, rules, statistics, and database
- **`cortex/`** (Python): AI service managing LLM agents
- **`web/`** (Next.js): Frontend UI with animations and sound

## Quick Start

### 1. Start the AI Service (Python)

```bash
cd cortex
cp .env.example .env 
# Edit .env and add your API keys
uv run python main.py
```

### 2. Start the Frontend

```bash
cd web
npm run dev
```

Visit `http://localhost:3000`

### 3. Run the Game Engine (Go)

```bash
cd engine
go run main.go
```

## Features
- TODO

## Tech Stack
- TODO