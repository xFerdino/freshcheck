#!/bin/sh
set -e

echo "Starting Bifrost gateway on port 8080..."
bifrost -app-dir /app/bifrost -port 8080 &

export BIFROST_BASE_URL="http://127.0.0.1:8080"

# Allow Bifrost a moment to initialize
sleep 2

PORT="${PORT:-8001}"
echo "Starting FreshCheck FastAPI backend on port ${PORT}..."
cd /app/backend && exec uvicorn server:app --host 0.0.0.0 --port "${PORT}"
