' SetMaster 3 (test instance) - double-click launcher (Windows)
'
' Double-click this file to start a second, EMPTY copy of SetMaster 3 for
' trying things out. It keeps its own sets, notes and settings in
' %APPDATA%\SetMaster3-test and runs on port 8140, so your real SetMaster 3
' (port 8137) is not touched. Both can run at the same time.
'
' The two browser tabs look identical - check the address bar before doing
' anything that changes or deletes data: 8137 is real, 8140 is the test copy.
'
' This is "SetMaster 3.vbs" with two environment variables set; all the real
' work still lives in _start.ps1.

Option Explicit
Dim fso, shell, here, ps1, cmd
Set fso   = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

' Point this copy at its own data folder and port, for THIS PROCESS ONLY.
' "PROCESS" is load-bearing: "USER" or "SYSTEM" would make the values stick
' and silently redirect the real SetMaster 3 launcher too.
shell.Environment("PROCESS")("SM3_DATA_DIR") = shell.ExpandEnvironmentStrings("%APPDATA%\SetMaster3-test")
shell.Environment("PROCESS")("SM3_PORT")     = "8140"

here = fso.GetParentFolderName(WScript.ScriptFullName)
ps1  = fso.BuildPath(here, "_start.ps1")

If Not fso.FileExists(ps1) Then
    MsgBox "SetMaster 3 is missing a required file:" & vbCrLf & vbCrLf & _
           ps1 & vbCrLf & vbCrLf & "Please reinstall SetMaster 3.", _
           vbCritical, "SetMaster 3 (test instance)"
    WScript.Quit 1
End If

' -WindowStyle Hidden on PowerShell plus Run window-style 0 = no flash at all.
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden " & _
      "-File """ & ps1 & """"

' Run(command, windowStyle=0 hidden, waitOnReturn=False)
shell.Run cmd, 0, False
