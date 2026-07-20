$ErrorActionPreference = "Stop"

# Set deterministic timestamp
$env:SOURCE_DATE_EPOCH = "1672531200"

$BackendDir = Join-Path $PSScriptRoot "..\backend"
$FrontendDir = Join-Path $PSScriptRoot "..\frontend"
$DistDir = Join-Path $FrontendDir "dist"

Write-Host "Running npm ci in backend..."
Set-Location $BackendDir
if (Test-Path "package.json") { npm ci } else { Write-Host "No package.json in backend, skipping npm ci." }

Write-Host "Running npm ci in frontend..."
Set-Location $FrontendDir
if (Test-Path "package.json") { npm ci } else { Write-Host "No package.json in frontend, skipping npm ci." }

Write-Host "Building frontend..."
if (Test-Path "package.json") { npm run build } else { Write-Host "No package.json in frontend, skipping build." }

Write-Host "Computing hashes..."
$ManifestPath = Join-Path $DistDir "BUILD_MANIFEST.sha256"

if (Test-Path $DistDir) {
    $Files = Get-ChildItem -Path $DistDir -Recurse -File
    $Hashes = @()
    foreach ($File in $Files) {
        $Hash = (Get-FileHash -Path $File.FullName -Algorithm SHA256).Hash
        $RelativePath = $File.FullName.Substring($DistDir.Length + 1).Replace('\', '/')
        $Hashes += "$Hash  $RelativePath"
    }
    
    $Hashes | Out-File -FilePath $ManifestPath -Encoding utf8
    Write-Host "Deterministic build complete. Hashes saved to BUILD_MANIFEST.sha256"
} else {
    Write-Warning "Dist directory not found!"
}
