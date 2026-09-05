# Starts the web demo: serves docs/ + provides the GROQ_API_KEY from env or .env,
# then opens the browser. Run from the project root:  .\run.ps1
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

if (-not (Test-Path ".venv\Scripts\python.exe")) {
    Write-Host "Setting up venv + dependencies (first run only)..."
    python -m venv .venv
    .\.venv\Scripts\python.exe -m pip install -r requirements.txt
}

if (-not (Test-Path ".env") -and -not $env:GROQ_API_KEY) {
    Write-Host "Note: no GROQ_API_KEY found. Copy .env.example to .env and fill it in,"
    Write-Host "or run:  `$env:GROQ_API_KEY = 'gsk_...'"
}

$proc = Start-Process -FilePath ".\.venv\Scripts\python.exe" -ArgumentList "serve.py" -PassThru -NoNewWindow
Start-Sleep -Seconds 1
Start-Process "http://localhost:8080"
$proc.WaitForExit()