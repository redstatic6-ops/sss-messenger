# Авто-обновление SSS Messenger

Две независимые механики: **ПК (Electron)** обновляется сам через GitHub Releases,
**Android (APK)** проверяет версию через `update.json` и предлагает скачать новую сборку.

Репозиторий релизов: `https://github.com/redstatic6-ops/sss-messenger`

---

## 🖥️ ПК (Electron) — electron-updater

Уже встроено в код:
- `electron-updater` добавлен в зависимости (`package.json`).
- В `package.json` → `build.publish` указан GitHub-репозиторий.
- В `electron/main.js` при старте вызывается `setupAutoUpdater()` (только в собранном приложении).
- Добавлен скрипт `npm run electron:publish`.

### Разовая подготовка
1. Установить зависимость локально:
   ```
   npm install
   ```
2. Создать на GitHub **Personal Access Token** (Settings → Developer settings → Tokens):
   - Classic token со scope `repo` (для публичного репо достаточно `public_repo`).
   - Токен НИКОМУ не показывать.

### Как выпустить новую версию (ПК)
1. Поднять версию в `package.json` (поле `version`), например `1.0.0` → `1.0.1`.
2. В PowerShell задать токен и опубликовать:
   ```powershell
   $env:GH_TOKEN="ghp_ВАШ_ТОКЕН"
   npm run electron:publish
   ```
   Это соберёт инсталлятор и зальёт на GitHub Releases вместе с `latest.yml` и `.blockmap`
   (их читает electron-updater).
3. На GitHub убедиться, что релиз **опубликован** (не draft).

### Что увидит пользователь
При запуске приложение тихо проверит обновления, скачает новую версию в фоне
и покажет окно «Обновление готово» с кнопкой «Перезапустить».

> Приложение не подписано цифровой подписью — при первой установке Windows может
> показать SmartScreen-предупреждение. Сам авто-апдейт при этом работает
> (`verifyUpdateCodeSignature: false`).

---

## 📱 Android — проверка обновлений (вариант A, реализовано)

Уже встроено в код:
- `src/lib/updater.js` — фетчит `update.json`, сравнивает версию, предлагает скачать APK.
- Вызов при старте в `src/App.jsx` (через 4 сек после запуска, только на Android).
- Шаблон `update.json` лежит в корне репозитория.

### Как выпустить новую версию (Android)
1. Поднять версию в `android/app/build.gradle`:
   - `versionCode` — целое число, **+1** к предыдущему (по нему идёт сравнение).
   - `versionName` — человекочитаемая строка, например `"1.1"`.
2. Собрать APK (Android Studio или `npm run android:build`).
3. Залить APK в GitHub Release (имя ассета должно совпадать со ссылкой в `update.json`,
   по умолчанию `app-debug.apk`).
4. Обновить `update.json` в репозитории (ветка `main`):
   ```json
   {
     "versionCode": 2,
     "versionName": "1.1",
     "apkUrl": "https://github.com/redstatic6-ops/sss-messenger/releases/latest/download/app-debug.apk",
     "notes": "Что нового в этой версии"
   }
   ```
5. Готово: у пользователей при следующем запуске появится запрос на скачивание.

> Вариант A открывает ссылку на APK во внешнем браузере — пользователь скачивает
> и ставит вручную (нужно разрешить «Установка из неизвестных источников»).

---

## 📱 Android — вариант B (бесшовно, на будущее)

Чтобы скачивать и ставить APK прямо из приложения, дополнительно нужно:
1. Добавить в `android/app/src/main/AndroidManifest.xml`:
   ```xml
   <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES"/>
   ```
   (`FileProvider` в манифесте уже есть.)
2. Скачивать APK через `@capacitor/filesystem` и запускать установку через intent
   `ACTION_VIEW` (`application/vnd.android.package-archive`) с FileProvider-URI
   (community-плагин установки APK или маленький свой плагин на Kotlin).
3. **Release keystore** — генерируется один раз, хранить в секрете, НЕ терять:
   ```
   keytool -genkey -v -keystore sss-release.keystore -alias sss -keyalg RSA -keysize 2048 -validity 10000
   ```
   Подписывать ВСЕ версии одним ключом, иначе обновление не встанет поверх
   (ошибка несовпадения подписи). Собирать `assembleRelease` вместо `assembleDebug`.

---

## ⚠️ Важное правило версий

Каждый релиз поднимать версию в трёх местах синхронно:
- `package.json` → `version` (ПК)
- `android/app/build.gradle` → `versionCode` (+1) и `versionName` (Android)
- `update.json` → `versionCode` / `versionName` (Android-проверка)

Запасная константа версии для Android (если плагин App недоступен) — в `src/lib/updater.js`
(`APP_VERSION`, `APP_VERSION_CODE`).
