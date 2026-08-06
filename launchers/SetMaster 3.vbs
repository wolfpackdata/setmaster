' SetMaster 3 - double-click launcher (Windows)
'
' Double-click this file to start SetMaster 3. It runs completely in the
' background (no black terminal window appears) and opens the app in your
' default web browser. If SetMaster 3 is already running it just re-opens
' the browser instead of starting a second copy.
'
' This wrapper does nothing but launch the PowerShell start script hidden;
' all the real work lives in _start.ps1.

Option Explicit
Dim fso, shell, here, ps1, cmd
Set fso   = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

here = fso.GetParentFolderName(WScript.ScriptFullName)
ps1  = fso.BuildPath(here, "_start.ps1")

If Not fso.FileExists(ps1) Then
    MsgBox "SetMaster 3 is missing a required file:" & vbCrLf & vbCrLf & _
           ps1 & vbCrLf & vbCrLf & "Please reinstall SetMaster 3.", _
           vbCritical, "SetMaster 3"
    WScript.Quit 1
End If

' -WindowStyle Hidden on PowerShell plus Run window-style 0 = no flash at all.
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden " & _
      "-File """ & ps1 & """"

' Run(command, windowStyle=0 hidden, waitOnReturn=False)
shell.Run cmd, 0, False
