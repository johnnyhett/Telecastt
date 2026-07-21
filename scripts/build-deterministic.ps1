$ErrorActionPreference = "Stop"

$env:SOURCE_DATE_EPOCH = "1672531200"

$BackendDir = Join-Path $PSScriptRoot "..\backend"
$FrontendDir = Join-Path $PSScriptRoot "..\frontend"
$DistDir = Join-Path $FrontendDir "dist"

Write-Host "Building frontend dist..."
Set-Location $FrontendDir

$ViteBin = Join-Path $FrontendDir "node_modules\.bin\vite.cmd"
if (Test-Path $ViteBin) {
    & $ViteBin build
} else {
    npm run build
}

Write-Host "Computing SHA-256 manifest..."
$ManifestPath = Join-Path $DistDir "BUILD_MANIFEST.sha256"

if (Test-Path $DistDir) {
    $AbsDist = (Resolve-Path $DistDir).Path
    $Files = Get-ChildItem -Path $AbsDist -Recurse -File | Where-Object { $_.Name -ne "BUILD_MANIFEST.sha256" }
    $Hashes = @()

    foreach ($File in $Files) {
        $Hash = (Get-FileHash -Path $File.FullName -Algorithm SHA256).Hash
        $RelPath = $File.FullName.Substring($AbsDist.Length).TrimStart('\').Replace('\', '/')
        $Hashes += "$Hash  $RelPath"
    }
    
    $Hashes | Out-File -FilePath $ManifestPath -Encoding utf8
    Write-Host "Deterministic build complete. Hashes written to BUILD_MANIFEST.sha256"
} else {
    Write-Warning "Dist directory not found!"
}
