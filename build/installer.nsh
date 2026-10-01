; HOC Terminal installer (Windows): the last page gets two ticked boxes, like other programs –
; "Run HOC Terminal now" and "Open HOC Terminal when my computer starts".
; The startup choice is left in startup-choice next to the app; the app reads it on its first start,
; turns "Open when your computer starts" on or off in its own settings and deletes the file.

!macro customInstall
  FileOpen $9 "$INSTDIR\startup-choice" w
  FileWrite $9 "0"
  FileClose $9
!macroend

!macro customFinishPage
  Function HocRunApp
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" ""
  FunctionEnd
  Function HocStartup
    FileOpen $9 "$INSTDIR\startup-choice" w
    FileWrite $9 "1"
    FileClose $9
    ; also register it right away (same entry the app's own setting uses), so it works even before the first run
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "net.hocapital.terminal" '"$INSTDIR\${PRODUCT_FILENAME}.exe"'
  FunctionEnd
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_TEXT "Run HOC Terminal now"
  !define MUI_FINISHPAGE_RUN_FUNCTION "HocRunApp"
  !define MUI_FINISHPAGE_SHOWREADME ""
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Open HOC Terminal when my computer starts"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION "HocStartup"
  !insertmacro MUI_PAGE_FINISH
!macroend

; uninstalling (not updating) removes the startup entry
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "net.hocapital.terminal"
  ${endIf}
!macroend
