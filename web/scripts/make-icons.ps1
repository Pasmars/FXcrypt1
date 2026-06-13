# Generates Android/PWA app icons from the FXcrypt logo (cover-crop, dark bg).
Add-Type -AssemblyName System.Drawing

$src    = "C:\Users\Pasmars Tech\Desktop\PNL CALCULATOR\web\public\logo.png"
$outDir = "C:\Users\Pasmars Tech\Desktop\PNL CALCULATOR\web\public\icons"
New-Item -ItemType Directory -Force $outDir | Out-Null

$img = [System.Drawing.Image]::FromFile($src)

function Make-Icon([int]$size, [string]$path, [double]$focusY) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = 'AntiAlias'
  $bg = [System.Drawing.ColorTranslator]::FromHtml('#0B0E11')
  $g.Clear($bg)
  $scale = [Math]::Max($size / $img.Width, $size / $img.Height)
  $dw = [int][Math]::Ceiling($img.Width * $scale)
  $dh = [int][Math]::Ceiling($img.Height * $scale)
  $dx = [int](($size - $dw) / 2)
  $dy = [int](-($dh - $size) * $focusY)
  $g.DrawImage($img, $dx, $dy, $dw, $dh)
  $g.Dispose()
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

Make-Icon 512 "$outDir\icon-512.png" 0.22
Make-Icon 192 "$outDir\icon-192.png" 0.22
Make-Icon 180 "$outDir\apple-touch-icon.png" 0.22
$img.Dispose()
Write-Output "icons generated"
