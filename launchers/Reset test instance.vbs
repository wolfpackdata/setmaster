' Reset test instance - double-click to empty the test copy (Windows)
'
' Double-click this file to throw away everything in the TEST copy of
' SetMaster 3 and start over with a fresh, empty one. It asks you to confirm
' first, then stops the test copy and deletes its data folder
' (%APPDATA%\SetMaster3-test).
'
' Your real SetMaster 3 - its sets, notes and settings - is NOT touched. This
' only ever affects the test copy on port 8140.
'
' The folder it deletes is fixed inside _reset-test.ps1 and cannot be changed
' or passed in, so this can never be pointed at your real data.

Option Explicit
Dim fso, shell, here, ps1, cmd, answer
Set fso   = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

here = fso.GetParentFolderName(WScript.ScriptFullName)
ps1  = fso.BuildPath(here, "_reset-test.ps1")

If Not fso.FileExists(ps1) Then
    MsgBox "SetMaster 3 is missing a required file:" & vbCrLf & vbCrLf & _
           ps1 & vbCrLf & vbCrLf & "Please reinstall SetMaster 3.", _
           vbCritical, "SetMaster 3 (test instance)"
    WScript.Quit 1
End If

' The confirmation lives here rather than in the PowerShell script. MsgBox is
' shown by the script host itself, so when this file is double-clicked there is
' always a real desktop behind it - and if the user says No, nothing runs at
' all. (PowerShell's Popup cannot be trusted for this: with no interactive
' desktop it returns "Yes" without ever drawing a dialog.)
' vbYesNo + vbExclamation + vbDefaultButton2 = No is preselected.
answer = MsgBox("This empties the TEST copy of SetMaster 3." & vbCrLf & vbCrLf & _
                "Everything in the test copy - its sets, notes and settings - will be " & _
                "permanently deleted, and the next start will be a fresh, empty " & _
                "SetMaster 3:" & vbCrLf & vbCrLf & _
                shell.ExpandEnvironmentStrings("%APPDATA%\SetMaster3-test") & vbCrLf & vbCrLf & _
                "Your real SetMaster 3 data is NOT affected." & vbCrLf & vbCrLf & _
                "Reset the test copy now?", _
                vbYesNo + vbExclamation + vbDefaultButton2, "SetMaster 3 (test instance)")

If answer <> vbYes Then
    WScript.Quit 0
End If

' Tells _reset-test.ps1 the user really did confirm. PROCESS scope only, so it
' cannot leak anywhere else.
shell.Environment("PROCESS")("SM3_RESET_CONFIRMED") = "1"

cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden " & _
      "-File """ & ps1 & """"

shell.Run cmd, 0, False
