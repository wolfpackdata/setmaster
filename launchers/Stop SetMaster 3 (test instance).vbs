' Stop SetMaster 3 (test instance) - double-click to shut the test copy down
'
' Double-click this file to stop the test copy of SetMaster 3 (the one on port
' 8140). Your real SetMaster 3 on port 8137 keeps running and is not touched.
' A small message confirms when the test copy has stopped; you can then close
' its browser tabs. (Nothing is deleted - the test copy's data is still there
' the next time you start it. To empty it, use "Reset test instance.vbs".)

Option Explicit
Dim fso, shell, here, ps1, cmd
Set fso   = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

' Aim the stopper at the test copy's port, for THIS PROCESS ONLY. "PROCESS" is
' load-bearing: "USER" or "SYSTEM" would make the value stick and point the
' real "Stop SetMaster 3.vbs" at the wrong instance too.
'
' Only the port is needed. _stop.ps1 takes the data dir from the answer the
' server itself gives on /api/status and matches it against that folder's
' instance.json, so each copy proves its own identity - do not add
' SM3_DATA_DIR here, it would have no effect.
shell.Environment("PROCESS")("SM3_PORT") = "8140"

here = fso.GetParentFolderName(WScript.ScriptFullName)
ps1  = fso.BuildPath(here, "_stop.ps1")

If Not fso.FileExists(ps1) Then
    MsgBox "SetMaster 3 is missing a required file:" & vbCrLf & vbCrLf & _
           ps1 & vbCrLf & vbCrLf & "Please reinstall SetMaster 3.", _
           vbCritical, "SetMaster 3 (test instance)"
    WScript.Quit 1
End If

cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden " & _
      "-File """ & ps1 & """"

shell.Run cmd, 0, False
