// Свежесть онлайн-статуса.
// Пользователь считается «в сети», только если его last_seen обновлялся
// недавно (через heartbeat). Если процесс убили, выгрузили или пропала сеть —
// heartbeat прекращается, и для остальных мы быстро становимся оффлайн,
// даже если флаг is_online завис в БД в значении true.

// Порог свежести: 2x интервала heartbeat (heartbeat ~45 сек).
export const ONLINE_THRESHOLD_MS = 90 * 1000;

export function isOnline(profile) {
  if (!profile || !profile.is_online) return false;
  // Нет данных о времени — доверяем флагу (не ломаем старые записи).
  if (!profile.last_seen) return true;
  const last = new Date(profile.last_seen).getTime();
  if (Number.isNaN(last)) return true;
  return Date.now() - last < ONLINE_THRESHOLD_MS;
}
