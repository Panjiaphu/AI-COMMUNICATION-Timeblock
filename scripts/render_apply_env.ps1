param(
    [string]$ServiceId = "srv-d93hlhtaeets73dohu0g",
    [string]$EnvFile = ".env.render",
    [switch]$RemoveDeprecated,
    [switch]$TriggerDeploy
)

$ErrorActionPreference = "Stop"

$apiKey = $env:RENDER_API_KEY
if (-not $apiKey) {
    $apiKey = $env:RENDER_API_TOKEN
}
if (-not $apiKey) {
    throw "Set RENDER_API_KEY or RENDER_API_TOKEN in this shell before running this script."
}

if (-not (Test-Path -LiteralPath $EnvFile)) {
    throw "Env file not found: $EnvFile"
}

$headers = @{
    "Authorization" = "Bearer $apiKey"
    "Accept" = "application/json"
    "Content-Type" = "application/json"
}

function Read-EnvFile {
    param([string]$Path)

    $items = [ordered]@{}
    Get-Content -LiteralPath $Path | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#")) {
            return
        }
        $index = $line.IndexOf("=")
        if ($index -lt 1) {
            return
        }
        $key = $line.Substring(0, $index).Trim()
        $value = $line.Substring($index + 1)
        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        if ($key) {
            $items[$key] = $value
        }
    }
    return $items
}

$envItems = Read-EnvFile -Path $EnvFile
if ($envItems.Count -eq 0) {
    throw "No KEY=VALUE entries found in $EnvFile"
}

foreach ($key in $envItems.Keys) {
    $encodedKey = [System.Uri]::EscapeDataString($key)
    $body = @{ value = [string]$envItems[$key] } | ConvertTo-Json -Compress
    $uri = "https://api.render.com/v1/services/$ServiceId/env-vars/$encodedKey"
    Invoke-RestMethod -Method Put -Uri $uri -Headers $headers -Body $body | Out-Null
    Write-Host "updated $key"
}

if ($RemoveDeprecated) {
    $deprecatedKeys = @(
        "ADMIN_PHONE",
        "ADMIN_SEED_EMAIL",
        "ADMIN_SEED_PASSWORD",
        "GOOGLE_ADSENSE_CLIENT",
        "GOOGLE_ADSENSE_SLOT",
        "GOOGLE_ADSENSE_PUBLISHER_ID",
        "GOOGLE_SITE_VERIFICATION"
    )

    foreach ($key in $deprecatedKeys) {
        $encodedKey = [System.Uri]::EscapeDataString($key)
        $uri = "https://api.render.com/v1/services/$ServiceId/env-vars/$encodedKey"
        try {
            Invoke-RestMethod -Method Delete -Uri $uri -Headers $headers | Out-Null
            Write-Host "removed deprecated $key"
        } catch {
            $statusCode = $null
            if ($_.Exception.Response) {
                $statusCode = [int]$_.Exception.Response.StatusCode
            }
            if ($statusCode -eq 404) {
                Write-Host "deprecated $key not present"
            } else {
                throw
            }
        }
    }
}

if ($TriggerDeploy) {
    $deployBody = @{ clearCache = "do_not_clear" } | ConvertTo-Json -Compress
    Invoke-RestMethod -Method Post -Uri "https://api.render.com/v1/services/$ServiceId/deploys" -Headers $headers -Body $deployBody | Out-Null
    Write-Host "deploy triggered for $ServiceId"
}
