<#
  start-dev.ps1 - one command, both dev servers.

  Backend (FastAPI/uvicorn)  -> http://localhost:8000   API + /uploads + the built console
  Frontend (Vite dev server) -> http://localhost:5173   hot-reloading React console

  Vite's dev server proxies /api and /uploads to the backend (see FE/vite.config.js),
  so the console at :5173 works like the one FastAPI serves at :8000 in production,
  except edits under FE/src show up immediately.

  Each server opens in its own PowerShell window - close a window (or Ctrl+C inside
  it) to stop that one server. Closing this launcher window does not stop them.

  One-time setup this script assumes is already done:
    cd Backend; python -m venv venv; .\venv\Scripts\python.exe -m pip install -r requirements.txt
    cd FE; npm install
#>

$root     = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend  = Join-Path $root "Backend"
$frontend = Join-Path $root "FE"
$venvPy   = Join-Path $backend "venv\Scripts\python.exe"

if (-not (Test-Path $venvPy)) {
    Write-Host "Backend venv not found at $venvPy" -ForegroundColor Red
    Write-Host "Run this first:  cd Backend; python -m venv venv; .\venv\Scripts\python.exe -m pip install -r requirements.txt"
    exit 1
}
if (-not (Test-Path (Join-Path $frontend "node_modules"))) {
    Write-Host "Frontend dependencies not installed." -ForegroundColor Red
    Write-Host "Run this first:  cd FE; npm install"
    exit 1
}

Write-Host "Starting backend  -> http://localhost:8000" -ForegroundColor Cyan
Start-Process powershell -WorkingDirectory $backend -ArgumentList @(
    "-NoExit", "-Command",
    "& `"$venvPy`" -m uvicorn main:app --reload --host 0.0.0.0 --port 8000"
)

Write-Host "Starting frontend -> http://localhost:5173" -ForegroundColor Cyan
Start-Process powershell -WorkingDirectory $frontend -ArgumentList @(
    "-NoExit", "-Command",
    "node node_modules/vite/bin/vite.js"
)

Write-Host ""
Write-Host "Backend  (API, /uploads, built console): http://localhost:8000"
Write-Host "Frontend (hot-reloading console, dev):    http://localhost:5173"
Write-Host ""
Write-Host "Use :5173 while editing FE/src - it proxies API calls to :8000 automatically."
Write-Host "Close each server's own window to stop it."
