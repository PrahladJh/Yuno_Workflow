#!/usr/bin/env bash
set -e

echo "🚀 Starting Yuno AI Platform..."
echo ""

# Start Python runtime
echo "Starting agent runtime (Python/LangGraph) on port 8000..."
cd agent-runtime
source venv/bin/activate
python main.py &
RUNTIME_PID=$!
cd ..

sleep 2

# Start backend
echo "Starting backend (Node.js/Express) on port 3001..."
cd backend
node --experimental-sqlite src/index.js &
BACKEND_PID=$!
cd ..

sleep 1

# Start frontend
echo "Starting frontend (React/Vite) on port 5173..."
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "================================================"
echo "   Yuno AI is running!"
echo "   Frontend:       http://localhost:5173"
echo "   Backend API:    http://localhost:3001/api"
echo "   Agent Runtime:  http://localhost:8000"
echo "================================================"
echo ""
echo "Press Ctrl+C to stop all services"

cleanup() {
  echo ""
  echo "Stopping services..."
  kill $FRONTEND_PID $BACKEND_PID $RUNTIME_PID 2>/dev/null || true
  exit 0
}

trap cleanup INT TERM
wait
