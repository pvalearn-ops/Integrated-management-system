@echo off
rem IMS: remove "open local folder" protocol
reg delete "HKCU\Software\Classes\imsfolder" /f >nul 2>&1
rmdir /s /q "%LOCALAPPDATA%\IMS-OpenFolder" >nul 2>&1
echo Removed.
pause
