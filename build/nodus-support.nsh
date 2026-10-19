; Separate executable/runtime: this shortcut also works when the main app cannot start.
!macro customInstall
  CreateShortCut "$SMPROGRAMS\Nodus Support.lnk" "$INSTDIR\resources\nodus-support\app\nodus-support.exe" "--nodus-executable=$\"$INSTDIR\Nodus.exe$\"" "$INSTDIR\resources\nodus-support\app\nodus-support.exe" 0
!macroend

!macro customUnInstall
  ; Only remove the installer-owned shortcut; support sessions and all user data remain.
  Delete "$SMPROGRAMS\Nodus Support.lnk"
!macroend
