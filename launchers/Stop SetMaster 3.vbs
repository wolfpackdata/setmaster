' Stop SetMaster 3 - double-click to shut the app down (Windows)
'
' Double-click this file to stop the SetMaster 3 background server. A small
' message confirms when it has stopped. You can then close any SetMaster 3
' browser tabs. (Your sets, notes and settings are saved automatically and
' are not affected by stopping the app.)

Option Explicit
Dim fso, shell, here, ps1, cmd
Set fso   = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

here = fso.GetParentFolderName(WScript.ScriptFullName)
ps1  = fso.BuildPath(here, "_stop.ps1")

If Not fso.FileExists(ps1) Then
    MsgBox "SetMaster 3 is missing a required file:" & vbCrLf & vbCrLf & _
           ps1 & vbCrLf & vbCrLf & "Please reinstall SetMaster 3.", _
           vbCritical, "SetMaster 3"
    WScript.Quit 1
End If

cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden " & _
      "-File """ & ps1 & """"

shell.Run cmd, 0, False
