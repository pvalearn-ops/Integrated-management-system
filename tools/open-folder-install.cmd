@echo off
rem IMS: install "open local folder" protocol (current user only, no admin needed)
rem The second half of this file is PowerShell, read and run by the next line.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$t=[IO.File]::ReadAllText('%~f0',[Text.Encoding]::UTF8); $m='#PS_'+'START#'; iex $t.Substring($t.IndexOf($m)+$m.Length)"
pause
exit /b
#PS_START#
$ErrorActionPreference = 'Stop'
$scheme = 'imsfolder'
$dir    = Join-Path $env:LOCALAPPDATA 'IMS-OpenFolder'
$script = Join-Path $dir 'open-folder.ps1'

# 協定處理程式：網址只當資料解碼成路徑，且只開啟「確實存在的資料夾」，不執行其他任何東西
$handler = @'
param([string]$Url)
$path = $null
try {
  $code = ($Url -replace '^imsfolder:(//)?', '') -replace '/+$', ''
  $b64 = $code.Replace('-', '+').Replace('_', '/')
  switch ($b64.Length % 4) { 2 { $b64 += '==' } 3 { $b64 += '=' } }
  $path = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))
} catch {}
if ($path -and (Test-Path -LiteralPath $path -PathType Container)) {
  Invoke-Item -LiteralPath $path
} else {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show("找不到資料夾：`n$path`n`n請到上傳掃描檔頁面，按該本機位置的「路徑」重新設定。", '開啟本機資料夾') | Out-Null
}
'@

New-Item -ItemType Directory -Force -Path $dir | Out-Null
# Windows PowerShell 5.1 需要 UTF-8 BOM 才能正確讀出中文
[IO.File]::WriteAllText($script, $handler, (New-Object System.Text.UTF8Encoding($true)))

$ps  = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
# -File 之後的 "%1" 只會當成參數字串傳給程式，不會被當指令執行
$cmd = '"' + $ps + '" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $script + '" "%1"'

$key = "HKCU:\Software\Classes\$scheme"
New-Item -Path $key -Force | Out-Null
Set-ItemProperty -Path $key -Name '(Default)' -Value 'URL:IMS Open Folder'
New-ItemProperty -Path $key -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
New-Item -Path "$key\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path "$key\shell\open\command" -Name '(Default)' -Value $cmd

Write-Host ''
Write-Host '安裝完成！回到「上傳掃描檔」頁面，按本機位置旁的「開啟」即可叫出檔案總管。' -ForegroundColor Green
Write-Host '第一次使用時 Chrome / Edge 會詢問是否開啟，勾選「一律允許」即可。'
Write-Host ''
