@echo off
rem SetMaster 3 - troubleshooting launcher (Windows)
rem
rem Use this ONLY if the normal "SetMaster 3.vbs" launcher did not work.
rem Unlike the normal launcher, this one keeps a black window open so you can
rem read the progress and any error messages. It can also build the app's UI
rem the first time if it is missing. Close this window (or press a key at the
rem end) when you are done reading. Closing it does NOT stop SetMaster 3 - use
rem "Stop SetMaster 3.vbs" for that.

title SetMaster 3 (troubleshoot)
echo Starting SetMaster 3 in troubleshooting mode...
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0_start.ps1" -Console -Build

echo.
echo ------------------------------------------------------------------
echo If the app opened in your browser, you can close this window now.
echo (Closing this window does not stop SetMaster 3.)
echo To stop the app, double-click "Stop SetMaster 3.vbs".
echo ------------------------------------------------------------------
pause
