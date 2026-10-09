FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

# Railway provides PORT env var, default to 5001 locally
ENV PORT=5001
EXPOSE $PORT
# An empty host listens on both IPv4 (Railway healthcheck) and IPv6 (private networking)
CMD uvicorn app:app --host "" --port $PORT

