$ErrorActionPreference = "Stop"

Write-Host "LOCAL_QA=ON"
Write-Host "HEAD=$((git rev-parse HEAD))"
Write-Host "Python=$((python --version) -join ' ')"

python -m compileall app
python scripts/check_legacy_runtime_absence.py
python scripts/verify_assistant_source_lock.py

$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  $nodePath = $node.Source
} else {
  $bundled = "C:\Users\inett\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  if (-not (Test-Path -LiteralPath $bundled)) { throw "Node.js is required for JavaScript syntax QA." }
  $nodePath = $bundled
}

$jsFiles = Get-ChildItem -LiteralPath "app/static" -Recurse -File -Filter "*.js" | Sort-Object FullName
foreach ($jsFile in $jsFiles) {
  & $nodePath --check $jsFile.FullName
}

$env:PYTHONPATH = "."
python -m pytest -q
python -m pytest -q tests/browser
python scripts/check_browser_artifacts.py $env:BROWSER_QA_ARTIFACT_DIR
