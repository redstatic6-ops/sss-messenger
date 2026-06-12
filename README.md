# SSS Messenger

Минималистичный мессенджер на React + Vite с бэкендом Supabase. Поддерживает веб, десктоп (Electron) и Android (Capacitor), голосовые/видеозвонки (WebRTC) и сквозное шифрование (E2EE) переписки и вложений.

## Технологии
- React 18 + Vite 5
- Zustand (состояние)
- Supabase (auth, БД, realtime, storage)
- WebRTC (звонки)
- Electron (десктоп), Capacitor 8 (Android)

## Требования
- Node.js 18+
- npm 9+

## Установка
```bash
npm install
cp .env.example .env   # затем впишите свои значения Supabase
```

## Переменные окружения
| Переменная | Описание |
|---|---|
| VITE_SUPABASE_URL | URL проекта Supabase |
| VITE_SUPABASE_ANON_KEY | anon-ключ Supabase |

## Запуск (разработка)
```bash
npm run dev            # веб, http://localhost:5173
npm run electron:dev   # десктоп (Electron)
```

## Сборка
```bash
npm run build            # веб (папка dist/)
npm run electron:build   # десктоп-установщик (electron-builder)
npx cap sync android     # синхронизация в Android-проект
```
Android APK/AAB собирается из папки android/ через Android Studio или Gradle.



## Структура
- `src/components` — UI-компоненты
- `src/store` — состояние (Zustand): authStore, keyStore
- `src/lib` — supabase, crypto, e2ee
- `src/hooks` — useWebRTC (звонки)
- `electron` — десктоп-обёртка
- `android` — нативный проект Capacitor

## Шифрование (E2EE)
Личные и групповые сообщения и вложения шифруются на клиенте (ECDH P-256 + AES-GCM). Приватный ключ хранится локально (IndexedDB) и оборачивается паролем; есть код восстановления. Детали — в `src/lib/crypto.js` и `src/lib/e2ee.js`.

## Лицензия
MIT
