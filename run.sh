#!/usr/bin/env bash
# Starts the web demo: serves docs/ + provides GROQ_API_KEY from env or .env,
# then opens the browser. Run from the project root:  ./run.sh
set -e
cd "$(dirname "$0")"

if [ ! -f .venv/bin/python ]; then
  echo "Setting up venv + dependencies (first run only)..."
  python3 -m venv .venv
  .venv/bin/python -m pip install -r requirements.txt
fi

if [ ! -f .env ] && [ -z "$GROQ_API_KEY" ]; then
  echo "Note: no GROQ_API_KEY found. Copy .env.example to .env and fill it in,"
  echo "or run:  export GROQ_API_KEY='gsk_...'"
fi

.venv/bin/python serve.py &
SERVER_PID=$!
sleep 1
xdg-open http://localhost:8080 2>/dev/null || open http://localhost:8080 2>/dev/null || true
wait $SERVER_PID