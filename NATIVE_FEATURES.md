# Нативные функции (Android): уведомления, фоновый звонок, оптимизация UI

Код уже подключён в приложении и **не ломает web/Electron-сборку**, даже если плагины
ещё не установлены (используются браузерные API как запасной вариант). Чтобы всё
заработало в полную силу на Android, установите плагины Capacitor и пересоберите APK.

## 1. Установка плагинов

```bash
npm install @capacitor/local-notifications @capacitor/status-bar @capacitor/keep-awake @capacitor/app
npm install @capawesome-team/capacitor-android-foreground-service
```

> Версии плагинов должны соответствовать мажорной версии `@capacitor/core` (сейчас `^8`).
> Если npm сообщит о несовместимости peer-зависимостей — установите подходящую
> версию плагина под Capacitor 8.

## 2. Синхронизация и сборка

```bash
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

## 3. Что добавлено

### Уведомления (`src/lib/native.js`)
- Запрос разрешения и создание канала уведомлений при запуске (`src/App.jsx`).
- Уведомление о **новом входящем сообщении** в открытом чате, когда приложение свёрнуто (`src/components/ChatWindow.jsx`).
- Уведомление о **входящем звонке**, когда приложение неактивно (`src/components/MainLayout.jsx`).
- Уведомление о **новой заявке в друзья** (`src/components/Sidebar.jsx`).

> Ограничение: пуш при **полностью закрытом** приложении требует серверного
> push (FCM) и отдельного бэкенда — это вне текущей правки. Реализованные
> уведомления работают, пока процесс приложения жив (открыто или свёрнуто).

### Звонок в фоне / при выключенном экране
- При активном/входящем/исходящем звонке запускается foreground-service
  (`@capawesome-team/capacitor-android-foreground-service`) + блокировка засыпания
  экрана (`@capacitor/keep-awake`), чтобы Android не убивал процесс и звук не прерывался
  при сворачивании и выключенном экране (`src/components/MainLayout.jsx`).
- В `AndroidManifest.xml` добавлены разрешения: `WAKE_LOCK`, `FOREGROUND_SERVICE`,
  `FOREGROUND_SERVICE_MICROPHONE`, `POST_NOTIFICATIONS`.

### Оптимизация под Android-интерфейс
- `viewport-fit=cover` в `index.html` + безопасные зоны (`env(safe-area-inset-*)`) в `src/index.css`.
- Статус-бар тёмной темы со светлыми иконками (`@capacitor/status-bar`).
- Аппаратная кнопка «Назад»: закрывает настройки / выходит из чата, а на главном
  экране сворачивает приложение вместо выхода (`@capacitor/app`).
- Отключены pull-to-refresh и «резинка», выделение текста только в полях ввода,
  размер шрифта полей 16px (без автозума), увеличены тач-цели.

## 4. Примечания по звонкам
- WebRTC требует HTTPS или localhost; в APK работает в WebView нормально.
- Настроены только STUN-серверы — для строгого NAT добавьте TURN (см. `CALLS_IMPLEMENTATION.md`).
