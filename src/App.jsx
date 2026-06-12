import React, { useEffect, useState } from 'react';
import { useAuthStore } from './store/authStore';
import Auth from './components/Auth';
import MainLayout from './components/MainLayout';
import TitleBar from './components/TitleBar';
import KeyGate from './components/KeyGate';
import {
  requestNotificationPermission,
  ensureNotificationChannel,
  initStatusBar,
  onAppStateChange,
} from './lib/native';
import { checkForAndroidUpdate } from './lib/updater';

function App() {
  const { user, profile, loading, initialize } = useAuthStore();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    initialize();

    // Нативная инициализация (Android/Capacitor): статус-бар тёмной темы,
    // канал уведомлений и запрос разрешения на уведомления.
    initStatusBar();
    ensureNotificationChannel();
    requestNotificationPermission();

    // Проверка обновлений (Android, sideload-APK): сравниваем версию с update.json
    // в репозитории и предлагаем скачать новую сборку. На ПК обновления идут
    // через electron-updater (см. electron/main.js).
    setTimeout(() => {
      checkForAndroidUpdate({ silent: true });
    }, 4000);

    // Определяем мобильное устройство
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    // Сбрасываем онлайн-статус при сворачивании/закрытии вкладки или приложения
    const handleVisibility = () => {
      const store = useAuthStore.getState();
      if (document.visibilityState === 'hidden') {
        store.markOffline();
      } else if (store.user) {
        store.markOnline();
      }
    };
    const handleBeforeUnload = () => {
      useAuthStore.getState().markOffline();
    };
    // pagehide надёжнее beforeunload (особенно в мобильных webview)
    const handlePageHide = () => {
      useAuthStore.getState().markOffline();
    };

    // Android/Capacitor: сворачивание приложения → оффлайн, возврат → онлайн
    onAppStateChange((isActive) => {
      const store = useAuthStore.getState();
      if (!store.user) return;
      if (isActive) store.markOnline();
      else store.markOffline();
    });

    checkMobile();
    window.addEventListener('resize', checkMobile);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handlePageHide);

    // Heartbeat: пока вкладка/приложение активны, раз в 45 сек обновляем
    // is_online + last_seen. Если процесс убили или пропала сеть — обновления
    // прекращаются, и для остальных мы быстро становимся оффлайн (см. lib/presence).
    const HEARTBEAT_MS = 45 * 1000;
    const heartbeat = () => {
      const store = useAuthStore.getState();
      if (store.user && document.visibilityState === 'visible') {
        store.markOnline();
      }
    };
    heartbeat();
    const heartbeatId = setInterval(heartbeat, HEARTBEAT_MS);

    return () => {
      window.removeEventListener('resize', checkMobile);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handlePageHide);
      clearInterval(heartbeatId);
    };
    // initialize стабилен (zustand), поэтому эффект должен выполниться один раз
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Проверяем, запущено ли в Electron
  const isElectron = window.electron !== undefined;

  if (loading) {
    return (
      <div className="h-screen flex flex-col overflow-hidden bg-dark-bg">
        {isElectron && <TitleBar />}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-gray-400">Загрузка...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {isElectron && <TitleBar />}
      <div className="flex-1 overflow-hidden">
        {user ? (
          <KeyGate user={user} profile={profile}>
            <MainLayout isMobile={isMobile} />
          </KeyGate>
        ) : (
          <Auth />
        )}
      </div>
    </div>
  );
}

export default App;
