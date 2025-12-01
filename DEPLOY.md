# Deploying No-LLMit

This guide covers deploying all 3 services: **web** (Next.js), **engine** (Go), and **llm** (Python).

## Architecture

```
[Frontend Next.js] ──WebSocket──▶ [Engine Go :8080] ──HTTP──▶ [LLM Python :5001]
                                                                     │
                                                                     ▼
                                                              HuggingFace API
```

## Option 1: Vercel + Railway (Recommended)

### Step 1: Deploy LLM service to Railway

1. Go to [railway.app](https://railway.app) and create a new project
2. Click "New Service" → "GitHub Repo" → select this repo
3. Set the **Root Directory** to `llm`
4. Add environment variable:
   - `HF_TOKEN` = your HuggingFace API token
5. Railway will auto-detect the Dockerfile and deploy
6. Go to Settings → Networking → Generate Domain
7. Copy the URL (e.g., `https://llm-production-xxxx.up.railway.app`)

### Step 2: Deploy Engine to Railway

1. In the same Railway project, click "New Service" → "GitHub Repo" → same repo
2. Set the **Root Directory** to `engine`
3. Add environment variable:
   - `LLM_SERVICE_URL` = the URL from Step 1 (e.g., `https://llm-production-xxxx.up.railway.app`)
4. Go to Settings → Networking → Generate Domain
5. Copy the URL (e.g., `https://engine-production-xxxx.up.railway.app`)

### Step 3: Deploy Frontend to Vercel

1. Go to [vercel.com](https://vercel.com) and import the repo
2. Set the **Root Directory** to `web`
3. Add environment variable:
   - `NEXT_PUBLIC_WS_URL` = `wss://engine-production-xxxx.up.railway.app/ws` (use `wss://` not `https://`)
4. Deploy!

---

## Option 2: Fly.io (All-in-one)

### Install Fly CLI
```bash
curl -L https://fly.io/install.sh | sh
fly auth login
```

### Deploy LLM service
```bash
cd llm
fly launch --name no-llmit-llm
fly secrets set HF_TOKEN=hf_your_token_here
fly deploy
```

### Deploy Engine
```bash
cd engine
fly launch --name no-llmit-engine
fly secrets set LLM_SERVICE_URL=https://no-llmit-llm.fly.dev
fly deploy
```

### Deploy Frontend
```bash
cd web
fly launch --name no-llmit-web
# Set env in fly.toml: NEXT_PUBLIC_WS_URL=wss://no-llmit-engine.fly.dev/ws
fly deploy
```

---

## Option 3: Render

1. Go to [render.com](https://render.com)
2. Create 3 "Web Services" from the same repo:
   - **llm**: Root Directory = `llm`, Start Command = `uvicorn app:app --host 0.0.0.0 --port $PORT`
   - **engine**: Root Directory = `engine`, Start Command = `./server`
   - **web**: Root Directory = `web`, Build = `npm run build`, Start = `npm start`
3. Set environment variables for each service as described above

---

## Environment Variables Reference

| Service | Variable | Description |
|---------|----------|-------------|
| web | `NEXT_PUBLIC_WS_URL` | WebSocket URL to engine (use `wss://` for HTTPS) |
| engine | `LLM_SERVICE_URL` | HTTP URL to LLM service |
| llm | `HF_TOKEN` | HuggingFace API token |

---

## Notes

- **WebSocket URL**: Must use `wss://` (not `https://`) when connecting to the engine
- **CORS**: The engine allows all origins by default for development
- **HuggingFace Pro**: If you have HF Pro, you get 10x the monthly token credits
- **Usage Tracking**: The `/llm/usage.json` file tracks API usage locally. This resets on redeployment unless you add persistent storage.

## Persistent Usage Storage (Optional)

To persist usage data across deployments on Railway:

1. Add a Railway Volume to the LLM service
2. Mount it at `/data`
3. Update `llm/usage.py` to use `/data/usage.json` instead of `./usage.json`

