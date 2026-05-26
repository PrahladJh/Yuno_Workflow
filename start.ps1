# Yuno AI Platform — Windows Start Script
Write-Host "Starting Yuno AI Platform..." -ForegroundColor Cyan
Write-Host ""

# Start Python runtime
Write-Host "Starting agent runtime (Python/LangGraph) on port 8000..." -ForegroundColor Yellow
$runtime = Start-Process -FilePath ".\agent-runtime\venv\Scripts\python.exe" `
    -ArgumentList ".\agent-runtime\main.py" `
    -WorkingDirectory (Get-Location) `
    -PassThru -NoNewWindow

Start-Sleep -Seconds 3

# Start backend
Write-Host "Starting backend (Node.js/Express) on port 3001..." -ForegroundColor Yellow
$backend = Start-Process -FilePath "node" `
    -ArgumentList "--experimental-sqlite src\index.js" `
    -WorkingDirectory "$(Get-Location)\backend" `
    -PassThru -NoNewWindow

Start-Sleep -Seconds 1

# Start frontend
Write-Host "Starting frontend (React/Vite) on port 5173..." -ForegroundColor Yellow
$frontend = Start-Process -FilePath "npm" `
    -ArgumentList "run dev" `
    -WorkingDirectory "$(Get-Location)\frontend" `
    -PassThru -NoNewWindow

Start-Sleep -Seconds 2

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "   Yuno AI is running!" -ForegroundColor Green
Write-Host "   Frontend:       http://localhost:5173" -ForegroundColor Cyan
Write-Host "   Backend API:    http://localhost:3001/api" -ForegroundColor Cyan
Write-Host "   Agent Runtime:  http://localhost:8000" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Press Enter to stop all services..."
Read-Host

$runtime.Kill()
$backend.Kill()
$frontend.Kill()
Write-Host "All services stopped." -ForegroundColor Yellow
