param([string]$ArchivePath = "$PSScriptRoot/../verification/FundosMidiaIndoor.zip", [string]$GeneratedSources = "$PSScriptRoot/../verification/generated-sources.json")
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$assetDirectory = Join-Path $projectRoot 'public/template-assets'
New-Item -ItemType Directory -Path $assetDirectory -Force | Out-Null
$jpegCodec = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg'
$qualityParameters = [Drawing.Imaging.EncoderParameters]::new(1)
$qualityParameters.Param[0] = [Drawing.Imaging.EncoderParameter]::new([Drawing.Imaging.Encoder]::Quality, [long]88)
function Save-OptimizedPhoto($sourceImage, [string]$destination, [int]$maxWidth = 1920, [int]$maxHeight = 1080) {
    [double]$scale = $maxWidth / [double]$sourceImage.Width
    if ($scale -gt ($maxHeight / [double]$sourceImage.Height)) { $scale = $maxHeight / [double]$sourceImage.Height }
    if ($scale -gt 1) { $scale = 1 }
    $bitmap = [Drawing.Bitmap]::new([Math]::Max(1,[int]($sourceImage.Width*$scale)), [Math]::Max(1,[int]($sourceImage.Height*$scale)))
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.Clear([Drawing.Color]::White)
        $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.DrawImage($sourceImage, 0, 0, $bitmap.Width, $bitmap.Height)
        $bitmap.Save($destination, $jpegCodec, $qualityParameters)
        return @{width=$bitmap.Width;height=$bitmap.Height}
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
}
if (Test-Path -LiteralPath $GeneratedSources) {
    foreach ($source in (Get-Content -LiteralPath $GeneratedSources -Raw | ConvertFrom-Json)) {
        $photo = [Drawing.Image]::FromFile($source.path)
        try { $null = Save-OptimizedPhoto $photo (Join-Path $assetDirectory ($source.id+'-v1.jpg')) 1440 1440 } finally { $photo.Dispose() }
    }
}
$manifest = [Collections.Generic.List[object]]::new()
$seen = @{}
$archive = [IO.Compression.ZipFile]::OpenRead([IO.Path]::GetFullPath($ArchivePath))
try {
    foreach ($entry in $archive.Entries) {
        if ($entry.FullName -notmatch '^fundo_[A-Za-z0-9_-]+\.png$') { continue }
        $buffer = [IO.MemoryStream]::new()
        $stream = $entry.Open()
        try { $stream.CopyTo($buffer) } finally { $stream.Dispose() }
        try {
            $digest = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($buffer.ToArray())).ToLowerInvariant()
            if ($seen.ContainsKey($digest)) { continue }
            $seen[$digest] = $true
            $buffer.Position = 0
            $photo = [Drawing.Image]::FromStream($buffer)
            try {
                $assetId = 'background-' + $digest.Substring(0,12)
                $dimensions = Save-OptimizedPhoto $photo (Join-Path $assetDirectory ($assetId+'-v1.jpg'))
                $manifest.Add(@{id=$assetId;name=('Fundo {0:d2}' -f ($manifest.Count+1));url=('/template-assets/'+$assetId+'-v1.jpg');width=$dimensions.width;height=$dimensions.height;original=$entry.FullName})
            } finally { $photo.Dispose() }
        } finally { $buffer.Dispose() }
    }
} finally { $archive.Dispose(); $qualityParameters.Dispose() }
$manifestJson = ConvertTo-Json -InputObject @($manifest.ToArray()) -Depth 4
[IO.File]::WriteAllText((Join-Path $projectRoot 'public/template-backgrounds.js'), ('// Imported from the user-provided FundosMidiaIndoor.zip; duplicates removed.'+"`n"+'export const templateBackgrounds = '+$manifestJson+";`n"), [Text.UTF8Encoding]::new($false))
$font = [Drawing.Font]::new('Segoe UI',11)
for ($page = 0; $page -lt [Math]::Ceiling($manifest.Count/24); $page++) {
    $sheet = [Drawing.Bitmap]::new(1200,880)
    $graphics = [Drawing.Graphics]::FromImage($sheet)
    try {
        $graphics.Clear([Drawing.Color]::White)
        for ($offset=0; $offset -lt 24; $offset++) {
            $index=$page*24+$offset
            if ($index -ge $manifest.Count) { break }
            $item=$manifest[$index]; $x=($offset%4)*300; $y=[Math]::Floor($offset/4)*146
            $image=[Drawing.Image]::FromFile((Join-Path $assetDirectory ($item.id+'-v1.jpg')))
            try { $graphics.DrawImage($image,[int]$x,[int]$y,288,118) } finally { $image.Dispose() }
            $graphics.DrawString(($item.name+' '+$item.id.Substring(11,6)), $font, [Drawing.Brushes]::Black, [single]$x, [single]($y+120))
        }
        $sheet.Save((Join-Path $projectRoot ('verification/backgrounds-'+$page+'.jpg')), [Drawing.Imaging.ImageFormat]::Jpeg)
    } finally { $graphics.Dispose(); $sheet.Dispose() }
}
$font.Dispose()
Write-Output ('Imported '+$manifest.Count+' unique backgrounds; asset bytes: '+((Get-ChildItem -LiteralPath $assetDirectory | Measure-Object Length -Sum).Sum))
