; ============================================================
;  Кастомный установщик SSS Messenger
;  Тёмная тема под стиль приложения + переделанные страницы
; ============================================================

; Безопасное переопределение символа с значением
; (electron-builder часть MUI-параметров уже задаёт — сначала снимаем)
!macro RedefVal _name _value
  !ifdef ${_name}
    !undef ${_name}
  !endif
  !define ${_name} "${_value}"
!macroend

; Безопасное определение флага (без значения)
!macro DefFlag _name
  !ifndef ${_name}
    !define ${_name}
  !endif
!macroend

!macro customHeader
  ; Надпись внизу окна установщика
  BrandingText "SSS Messenger — безопасный мессенджер"

  ; --- Тёмная тема под стиль приложения ---
  !insertmacro RedefVal MUI_BGCOLOR "0F172A"
  !insertmacro RedefVal MUI_TEXTCOLOR "E2E8F0"
  !insertmacro RedefVal MUI_INSTFILESPAGE_COLORS "E2E8F0 0F172A"
  !insertmacro RedefVal MUI_INSTFILESPAGE_PROGRESSBAR "smooth"

  ; --- Тексты страниц (русский) ---
  !insertmacro DefFlag MUI_WELCOMEPAGE_TITLE_3LINES
  !insertmacro RedefVal MUI_WELCOMEPAGE_TITLE "Добро пожаловать в SSS Messenger"
  !insertmacro RedefVal MUI_WELCOMEPAGE_TEXT "Сейчас будет установлен SSS Messenger — быстрый и безопасный мессенджер с end-to-end шифрованием.$\r$\n$\r$\nЗакройте остальные приложения перед продолжением и нажмите «Далее»."

  !insertmacro RedefVal MUI_LICENSEPAGE_TEXT_TOP "Пожалуйста, ознакомьтесь с условиями использования SSS Messenger."
  !insertmacro RedefVal MUI_LICENSEPAGE_TEXT_BOTTOM "Нажимая «Принимаю», вы соглашаетесь с условиями."
  !insertmacro RedefVal MUI_LICENSEPAGE_BUTTON "Принимаю"

  !insertmacro RedefVal MUI_DIRECTORYPAGE_TEXT_TOP "Выберите папку, в которую будет установлен SSS Messenger."

  !insertmacro DefFlag MUI_FINISHPAGE_TITLE_3LINES
  !insertmacro RedefVal MUI_FINISHPAGE_TITLE "Установка завершена"
  !insertmacro RedefVal MUI_FINISHPAGE_TEXT "SSS Messenger успешно установлен и готов к работе.$\r$\n$\r$\nСпасибо, что выбрали нас!"
  !insertmacro RedefVal MUI_FINISHPAGE_RUN_TEXT "Запустить SSS Messenger"
!macroend

!macro customInstallMode
  ; Принудительно ставим только для текущего пользователя
  ; (убирает страницу выбора «для кого устанавливать»)
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customInit
  ; Закрываем приложение, если оно запущено
  nsExec::Exec 'taskkill /F /IM "SSS Messenger.exe"'
!macroend

!macro customInstall
  ; Дополнительный ярлык в меню Пуск
  CreateShortCut "$SMPROGRAMS\SSS Messenger\Запустить SSS Messenger.lnk" "$INSTDIR\SSS Messenger.exe"

  ; Регистрация протокола sss:// для глубоких ссылок
  WriteRegStr HKCR "sss" "" "URL:SSS Messenger Protocol"
  WriteRegStr HKCR "sss" "URL Protocol" ""
  WriteRegStr HKCR "sss\DefaultIcon" "" "$INSTDIR\SSS Messenger.exe,0"
  WriteRegStr HKCR "sss\shell\open\command" "" '"$INSTDIR\SSS Messenger.exe" "%1"'
!macroend

!macro customUnInstall
  ; Удаление протокола
  DeleteRegKey HKCR "sss"
  ; Удаление из автозагрузки
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "SSS Messenger"
  ; Закрытие приложения перед удалением
  nsExec::Exec 'taskkill /F /IM "SSS Messenger.exe"'
!macroend
