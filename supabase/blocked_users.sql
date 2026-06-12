-- ============================================================
-- SSS Messenger — блокировки и политики удаления (Sandstorm 0.1)
-- Выполнить в Supabase → SQL Editor.
-- Идемпотентно: можно запускать повторно.
-- ============================================================

-- 1) Таблица блокировок -----------------------------------------------
create table if not exists public.blocked_users (
  id          uuid primary key default gen_random_uuid(),
  blocker_id  uuid not null references public.profiles(id) on delete cascade,
  blocked_id  uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index if not exists blocked_users_blocker_idx on public.blocked_users(blocker_id);
create index if not exists blocked_users_blocked_idx on public.blocked_users(blocked_id);

alter table public.blocked_users enable row level security;

-- Видно строки, где я блокирующий или заблокированный
drop policy if exists blocked_users_select on public.blocked_users;
create policy blocked_users_select on public.blocked_users
  for select using (auth.uid() = blocker_id or auth.uid() = blocked_id);

-- Блокировать можно только от своего имени
drop policy if exists blocked_users_insert on public.blocked_users;
create policy blocked_users_insert on public.blocked_users
  for insert with check (auth.uid() = blocker_id);

-- Снять блокировку может только её автор
drop policy if exists blocked_users_delete on public.blocked_users;
create policy blocked_users_delete on public.blocked_users
  for delete using (auth.uid() = blocker_id);

-- 2) Политики удаления чатов ------------------------------------------
-- Участник может выйти из комнаты (удалить свою строку — «удалить у себя»)
drop policy if exists room_members_delete_member on public.room_members;
create policy room_members_delete_member on public.room_members
  for delete using (auth.uid() = user_id);

-- Для «удалить у обоих»: участник может чистить всех участников своей комнаты
drop policy if exists room_members_delete_room on public.room_members;
create policy room_members_delete_room on public.room_members
  for delete using (
    exists (
      select 1 from public.room_members rm
      where rm.room_id = room_members.room_id and rm.user_id = auth.uid()
    )
  );

-- Удалять сообщения комнаты может её участник
drop policy if exists messages_delete_member on public.messages;
create policy messages_delete_member on public.messages
  for delete using (
    exists (
      select 1 from public.room_members rm
      where rm.room_id = messages.room_id and rm.user_id = auth.uid()
    )
  );

-- Удалять саму комнату может её участник
drop policy if exists rooms_delete_member on public.rooms;
create policy rooms_delete_member on public.rooms
  for delete using (
    exists (
      select 1 from public.room_members rm
      where rm.room_id = rooms.id and rm.user_id = auth.uid()
    )
  );

-- 3) (Опционально) ограничение длины сообщения на стороне БД -----------
-- В БД хранится ШИФРТЕКСТ (e2ee:v1:... + base64), он длиннее исходного
-- текста. Клиент ограничивает плайнтекст 4000 символами (MAX_MESSAGE_LENGTH),
-- поэтому берём с запасом под base64-накладные расходы.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'messages_content_len_chk'
  ) then
    alter table public.messages
      add constraint messages_content_len_chk
      check (content is null or char_length(content) <= 20000);
  end if;
end $$;
