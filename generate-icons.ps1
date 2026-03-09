Add-Type -AssemblyName System.Drawing

function New-Icon($size, $path) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    # Background rounded rect (approximate with filled ellipse-cornered rect)
    $bgBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(29, 155, 240))
    $radius = [int]($size * 0.22)
    $path2 = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path2.AddArc(0, 0, $radius*2, $radius*2, 180, 90)
    $path2.AddArc($size - $radius*2, 0, $radius*2, $radius*2, 270, 90)
    $path2.AddArc($size - $radius*2, $size - $radius*2, $radius*2, $radius*2, 0, 90)
    $path2.AddArc(0, $size - $radius*2, $radius*2, $radius*2, 90, 90)
    $path2.CloseFigure()
    $g.FillPath($bgBrush, $path2)

    # Circle
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), ([float]($size * 0.04))
    $circleMargin = [int]($size * 0.19)
    $circleSize = $size - ($circleMargin * 2)
    $g.DrawEllipse($pen, $circleMargin, $circleMargin, $circleSize, $circleSize)

    # Text "G?"
    $fontSize = [float]($size * 0.35)
    $font = New-Object System.Drawing.Font("Arial", $fontSize, [System.Drawing.FontStyle]::Bold)
    $textBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rect = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
    $g.DrawString("G?", $font, $textBrush, $rect, $sf)

    $g.Dispose()
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "Created $path ($size x $size)"
}

$iconDir = Join-Path $PSScriptRoot "icons"
if (!(Test-Path $iconDir)) { New-Item -ItemType Directory -Path $iconDir | Out-Null }

New-Icon 16 (Join-Path $iconDir "icon16.png")
New-Icon 48 (Join-Path $iconDir "icon48.png")
New-Icon 128 (Join-Path $iconDir "icon128.png")

Write-Host "All icons generated!"
