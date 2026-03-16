Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ScriptDir = Split-Path $MyInvocation.MyCommand.Path
$WorkDir  = Split-Path $ScriptDir -Parent
$LogFile  = Join-Path $WorkDir "server.log"
$ErrFile  = Join-Path $WorkDir "server_err.log"
$CfOut    = Join-Path $env:TEMP "cf_out.log"
$CfErr    = Join-Path $env:TEMP "cf_err.log"
$env:PATH = "$env:PATH;C:\Program Files (x86)\cloudflared"

$script:nodeProcess = $null
$script:cfProcess   = $null
$script:tunnelUrl   = $null

function Stop-All {
    if ($script:nodeProcess -and -not $script:nodeProcess.HasExited) { $script:nodeProcess.Kill() }
    if ($script:cfProcess   -and -not $script:cfProcess.HasExited)   { $script:cfProcess.Kill()   }
}

function Clean-Environment {
    Get-Process -Name "node","chrome" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    $pids = netstat -aon 2>$null | Select-String ":3000 " | Where-Object { $_ -match "LISTENING" } |
            ForEach-Object { ($_ -split '\s+')[-1] }
    foreach ($p in $pids) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
    Remove-Item "$WorkDir\.wwebjs_auth\session\SingletonLock"   -Force -ErrorAction SilentlyContinue
    Remove-Item "$WorkDir\.wwebjs_auth\session\SingletonSocket" -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800
}

function Start-All {
    "" | Out-File $LogFile -Encoding UTF8
    "" | Out-File $ErrFile -Encoding UTF8
    if (Test-Path $CfOut) { Remove-Item $CfOut -Force }
    if (Test-Path $CfErr) { Remove-Item $CfErr -Force }

    $script:nodeProcess = Start-Process -FilePath "node" -ArgumentList "backend/server.js" `
        -WorkingDirectory $WorkDir `
        -RedirectStandardOutput $LogFile `
        -RedirectStandardError  $ErrFile `
        -NoNewWindow -PassThru

    $script:cfProcess = Start-Process -FilePath "cloudflared" `
        -ArgumentList "tunnel","--url","http://localhost:3000" `
        -RedirectStandardOutput $CfOut `
        -RedirectStandardError  $CfErr `
        -NoNewWindow -PassThru
}

$tray         = New-Object System.Windows.Forms.NotifyIcon

# --- Build a custom 32x32 icon (WhatsApp-style green bubble with white W) ---
$bmp = New-Object System.Drawing.Bitmap(32, 32)
$g   = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode    = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

# Green circle background
$bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 37, 211, 102))
$g.FillEllipse($bgBrush, 1, 1, 30, 30)

# Subtle dark border
$borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(120, 0, 0, 0), 1)
$g.DrawEllipse($borderPen, 1, 1, 29, 29)

# White "W" centred in the circle
$font    = New-Object System.Drawing.Font("Segoe UI", 13, [System.Drawing.FontStyle]::Bold)
$sfmt    = New-Object System.Drawing.StringFormat
$sfmt.Alignment     = [System.Drawing.StringAlignment]::Center
$sfmt.LineAlignment = [System.Drawing.StringAlignment]::Center
$whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$g.DrawString("W", $font, $whiteBrush, [System.Drawing.RectangleF]::new(0, 1, 32, 32), $sfmt)

$g.Dispose()
$iconHandle = $bmp.GetHicon()
$customIcon = [System.Drawing.Icon]::FromHandle($iconHandle)
$bmp.Dispose()
# -------------------------------------------------------------------------

$tray.Icon    = $customIcon
$tray.Text    = "WA Summariser"
$tray.Visible = $true

function Show-Balloon($title, $text, $icon = "Info", $ms = 4000) {
    $tray.BalloonTipTitle = $title
    $tray.BalloonTipText  = $text
    $tray.BalloonTipIcon  = $icon
    $tray.ShowBalloonTip($ms)
}

$pollTimer          = New-Object System.Windows.Forms.Timer
$pollTimer.Interval = 1000
$pollCount          = 0

$pollTimer.Add_Tick({
    $script:pollCount++
    $raw = ""
    if (Test-Path $CfOut) { $raw += (Get-Content $CfOut -Raw -ErrorAction SilentlyContinue) }
    if (Test-Path $CfErr) { $raw += (Get-Content $CfErr -Raw -ErrorAction SilentlyContinue) }
    if ($raw -match "(https://[a-z0-9\-]+\.trycloudflare\.com)") {
        $script:tunnelUrl = $matches[1]
        Show-Balloon "WA Summariser - Ready" $script:tunnelUrl
        $pollTimer.Stop()
    }
    if ($script:pollCount -ge 30) { $pollTimer.Stop() }
})

$menu = New-Object System.Windows.Forms.ContextMenuStrip

$miTerminal = New-Object System.Windows.Forms.ToolStripMenuItem "Open Terminal"
$miTerminal.Add_Click({
    $cmd = "Write-Host 'WA Summariser server log' -ForegroundColor Green; " +
           "Get-Content '$LogFile','$ErrFile' -Wait -Tail 80 -ErrorAction SilentlyContinue"
    Start-Process "powershell.exe" -ArgumentList "-NoExit","-Command",$cmd
})

$miUrl = New-Object System.Windows.Forms.ToolStripMenuItem "Show / Copy URL"
$miUrl.Add_Click({
    if ($script:tunnelUrl) {
        [System.Windows.Forms.Clipboard]::SetText($script:tunnelUrl)
        Show-Balloon "URL copied to clipboard" $script:tunnelUrl
    } else {
        Show-Balloon "WA Summariser" "Tunnel URL not available yet." "Warning"
    }
})

$miRestart = New-Object System.Windows.Forms.ToolStripMenuItem "Restart"
$miRestart.Add_Click({
    Stop-All
    Clean-Environment
    $script:tunnelUrl = $null
    $script:pollCount = 0
    Start-All
    $pollTimer.Start()
    Show-Balloon "WA Summariser" "Restarting..."
})

$miExit = New-Object System.Windows.Forms.ToolStripMenuItem "Exit"
$miExit.Add_Click({
    Stop-All
    $tray.Visible = $false
    $tray.Dispose()
    [System.Windows.Forms.Application]::Exit()
    Stop-Process -Id $PID -Force
})

[void]$menu.Items.Add($miTerminal)
[void]$menu.Items.Add($miUrl)
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
[void]$menu.Items.Add($miRestart)
[void]$menu.Items.Add($miExit)
$tray.ContextMenuStrip = $menu

$tray.Add_DoubleClick({ $miTerminal.PerformClick() })

Clean-Environment
Start-All
$pollTimer.Start()
Show-Balloon "WA Summariser" "Starting up..."

[System.Windows.Forms.Application]::Run()