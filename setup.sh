#!/usr/bin/env bash
set -e

echo "================================================"
echo "   Yuno AI — Agent Orchestration Platform Setup"
echo "================================================"

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo "ERROR: Node.js not found. Install from https://nodejs.org"; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "ERROR: Python 3 not found. Install from https://python.org"; exit 1; }

NODE_MAJOR=$(node -e "console.log(process.version.match(/^v(\d+)/)[1])")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "ERROR: Node.js 18+ required (found v$NODE_MAJOR)"
  exit 1
fi

echo ""
echo "📦 Installing backend dependencies..."
cd backend
npm install
cd ..

echo ""
echo "📦 Installing frontend dependencies..."
cd frontend
npm install
cd ..

echo ""
echo "🐍 Setting up Python runtime..."
cd agent-runtime
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt --quiet
deactivate
cd ..

echo ""
echo "⚙️  Creating environment files..."

if [ ! -f backend/.env ]; then
  cp backend/.env.example backend/.env
  echo "   Created backend/.env — please add your ANTHROPIC_API_KEY"
fi

if [ ! -f agent-runtime/.env ]; then
  cp agent-runtime/.env.example agent-runtime/.env
  echo "   Created agent-runtime/.env"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Add your ANTHROPIC_API_KEY to backend/.env"
echo "  2. (Optional) Add TELEGRAM_BOT_TOKEN to backend/.env"
echo "  3. Run: ./start.sh"
echo ""
