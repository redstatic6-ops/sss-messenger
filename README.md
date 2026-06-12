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

## Настройка Supabase (SQL)
Выполните в SQL Editor проекта Supabase один раз:
```sql
alter table profiles
  add column if not exists public_key text,
  add column if not exists encrypted_private_key text,
  add column if not exists recovery_private_key text;

create table if not exists room_keys (
  room_id uuid not null references rooms(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  wrapped_key text not null,
  created_at timestamptz default now(),
  primary key (room_id, user_id)
);
alter table room_keys enable row level security;
create policy "room_keys_select" on room_keys for select using (exists (select 1 from room_members rm where rm.room_id = room_keys.room_id and rm.user_id = auth.uid()));
create policy "room_keys_insert" on room_keys for insert with check (exists (select 1 from room_members rm where rm.room_id = room_keys.room_id and rm.user_id = auth.uid()));
create policy "room_keys_update" on room_keys for update using (exists (select 1 from room_members rm where rm.room_id = room_keys.room_id and rm.user_id = auth.uid()));
```

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
