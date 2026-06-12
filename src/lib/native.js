// Нативный слой (Capacitor/Android) с безопасной деградацией.
//
// ВАЖНО: здесь НЕТ статических import'ов плагинов, чтобы web/Electron-сборка
// не падала, если плагины ещё не установлены. Доступ идёт через рантайм-объект
// window.Capacitor.Plugins. После установки плагинов + `npx cap sync` функции
// автоматически начинают работать на Android. На web/Electron используются
// браузерные API (Notification, navigator.wakeLock) либо мягкая заглушка.
//
// Какие плагины задействованы (см. NATIVE_FEATURES.md):
//   @capacitor/local-notifications  — уведомления
//   @capacitor/status-bar           — статус-бар
//   @capacitor/keep-awake           — не гасить экран во время звонка
//   @capacitor/app                  — кнопка "Назад", сворачивание, состояние
//   @capawesome-team/capacitor-android-foreground-service — звонок в фоне/при выключенном экране

const Cap = typeof window !== 'undefined' ? window.Capacitor : undefined;
const P = () => (Cap && Cap.Plugins) || {};

export const isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
export const platform = (Cap && Cap.getPlatform && Cap.getPlatform()) || 'web';
export const isAndroid = platform === 'android';

export function appIsActive() {
  if (typeof document !== 'undefined') return document.visibilityState === 'visible';
  return true;
}

// ----------------------------- Уведомления -----------------------------
let webNotifAsked = false;

export async function requestNotificationPermission() {
  try {
    const { LocalNotifications } = P();
    if (LocalNotifications) {
      const res = await LocalNotifications.requestPermissions();
      return res?.display === 'granted';
    }
    if (typeof Notification !== 'undefined') {
      if (Notification.permission === 'granted') return true;
      if (Notification.permission !== 'denied' && !webNotifAsked) {
        webNotifAsked = true;
        const perm = await Notification.requestPermission();
        return perm === 'granted';
      }
      return Notification.permission === 'granted';
    }
  } catch (e) {
    console.warn('requestNotificationPermission', e);
  }
  return false;
}

export async function ensureNotificationChannel() {
  try {
    const { LocalNotifications } = P();
    if (LocalNotifications && LocalNotifications.createChannel) {
      await LocalNotifications.createChannel({
        id: 'sss-default',
        name: 'Сообщения и звонки',
        description: 'Уведомления SSS Messenger',
        importance: 5,
        visibility: 1,
      });
    }
  } catch (e) {
    /* канал не критичен */
  }
}

let notifId = 1;
export async function notify({ title, body, tag } = {}) {
  try {
    const { LocalNotifications } = P();
    if (LocalNotifications) {
      await LocalNotifications.schedule({
        notifications: [
          {
            id: (notifId++ % 2147483000) + 1,
            title: title || 'SSS Messenger',
            body: body || '',
            channelId: 'sss-default',
            smallIcon: 'ic_launcher',
            schedule: { at: new Date(Date.now() + 80) },
          },
        ],
      });
      return;
    }
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const n = new Notification(title || 'SSS Messenger', { body: body || '', tag });
      setTimeout(() => {
        try {
          n.close();
        } catch (_) {}
      }, 6000);
    }
  } catch (e) {
    console.warn('notify error', e);
  }
}

// -------------- Звонок в фоне / при выключенном экране ------------------
let wakeLockSentinel = null;
let fgServiceActive = false;

export async function startCallKeepAlive() {
  // 1) Не давать экрану гаснуть, пока приложение на переднем плане.
  try {
    const { KeepAwake } = P();
    if (KeepAwake?.keepAwake) {
      await KeepAwake.keepAwake();
    } else if (typeof navigator !== 'undefined' && navigator.wakeLock?.request) {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
    }
  } catch (e) {
    console.warn('keepAwake', e);
  }

  // 2) Foreground-service — главное для Android: процесс с активным сервисом
  //    система не убивает, поэтому звонок продолжается при свёрнутом приложении
  //    и выключенном экране.
  try {
    const { ForegroundService } = P();
    if (ForegroundService?.startForegroundService && !fgServiceActive) {
      await ForegroundService.startForegroundService({
        id: 4242,
        title: 'Активный звонок',
        body: 'SSS Messenger продолжает звонок',
        smallIcon: 'ic_launcher',
      });
      fgServiceActive = true;
    }
  } catch (e) {
    console.warn('foregroundService start', e);
  }
}

export async function stopCallKeepAlive() {
  try {
    const { KeepAwake } = P();
    if (KeepAwake?.allowSleep) await KeepAwake.allowSleep();
  } catch (_) {}
  try {
    if (wakeLockSentinel) {
      await wakeLockSentinel.release();
      wakeLockSentinel = null;
    }
  } catch (_) {}
  try {
    const { ForegroundService } = P();
    if (ForegroundService?.stopForegroundService && fgServiceActive) {
      await ForegroundService.stopForegroundService();
      fgServiceActive = false;
    }
  } catch (e) {
    console.warn('foregroundService stop', e);
  }
}

// --------------------- Статус-бар / системный UI -----------------------
export async function initStatusBar() {
  try {
    const { StatusBar } = P();
    if (!StatusBar) return;
    // Контент не залезает под статус-бар (без наложения)
    if (StatusBar.setOverlaysWebView) await StatusBar.setOverlaysWebView({ overlay: false });
    // Тёмный фон → светлые иконки статус-бара
    if (StatusBar.setStyle) await StatusBar.setStyle({ style: 'DARK' });
    if (StatusBar.setBackgroundColor) await StatusBar.setBackgroundColor({ color: '#0B0E11' });
  } catch (e) {
    console.warn('initStatusBar', e);
  }
}

// ----------------------- Кнопка "Назад" / сворачивание -----------------
let backHandlerCb = null;
let backRegistered = false;

export function setBackButtonHandler(cb) {
  backHandlerCb = cb;
  if (backRegistered) return;
  try {
    const { App } = P();
    if (App?.addListener) {
      App.addListener('backButton', (info) => {
        try {
          backHandlerCb?.(info);
        } catch (e) {
          console.warn('backButton handler', e);
        }
      });
      backRegistered = true;
    }
  } catch (e) {
    console.warn('setBackButtonHandler', e);
  }
}

export function minimizeApp() {
  try {
    const { App } = P();
    App?.minimizeApp?.();
  } catch (e) {
    console.warn('minimizeApp', e);
  }
}

// ----------------------- Состояние приложения -------------------------
export function onAppStateChange(cb) {
  try {
    const { App } = P();
    if (App?.addListener) {
      App.addListener('appStateChange', ({ isActive }) => cb?.(isActive));
      return;
    }
  } catch (_) {}
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () =>
      cb?.(document.visibilityState === 'visible'),
    );
  }
}
