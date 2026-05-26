# Yuno AI Platform — Windows Setup Script
$ErrorActionPreference = "Stop"

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "   Yuno AI — Agent Orchestration Platform Setup" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Check Node.js
try { $nodeVersion = node -e "console.log(process.version)" } catch { Write-Host "ERROR: Node.js not found. Install from https://nodejs.org" -ForegroundColor Red; exit 1 }
Write-Host "Node.js: $nodeVersion" -ForegroundColor Green

# Check Python
try { $pythonVersion = python --version } catch { Write-Host "ERROR: Python not found. Install from https://python.org" -ForegroundColor Red; exit 1 }
Write-Host "Python: $pythonVersion" -ForegroundColor Green
Write-Host ""

# Backend
Write-Host "Installing backend dependencies..." -ForegroundColor Yellow
Set-Location backend
npm install
Set-Location ..

# Frontend
Write-Host "Installing frontend dependencies..." -ForegroundColor Yellow
Set-Location frontend
npm install
Set-Location ..

# Python runtime
Write-Host "Setting up Python runtime..." -ForegroundColor Yellow
Set-Location agent-runtime
python -m venv venv
.\venv\Scripts\pip install -r requirements.txt --quiet
Set-Location ..

# Env files
if (-not (Test-Path "backend\.env")) {
    Copy-Item "backend\.env.example" "backend\.env"
    Write-Host "Created backend\.env — add your ANTHROPIC_API_KEY" -ForegroundColor Yellow
}
if (-not (Test-Path "agent-runtime\.env")) {
    Copy-Item "agent-runtime\.env.example" "agent-runtime\.env"
}

Write-Host ""
Write-Host "Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Edit backend\.env and add ANTHROPIC_API_KEY"
Write-Host "  2. (Optional) Add TELEGRAM_BOT_TOKEN to backend\.env"
Write-Host "  3. Run: .\start.ps1"
Write-Host ""
