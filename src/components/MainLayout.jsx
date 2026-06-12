import React, { useState, useEffect, Suspense, lazy } from 'react';
import Sidebar from './Sidebar';
import ChatWindow from './ChatWindow';
import { useWebRTC } from '../hooks/useWebRTC';
import { useAuthStore } from '../store/authStore';
import {
  startCallKeepAlive,
  stopCallKeepAlive,
  notify,
  appIsActive,
  setBackButtonHandler,
  minimizeApp,
} from '../lib/native';

// Ленивая загрузка тяжёлых/редко открываемых экранов.
// Каждый компонент несёт собственный Suspense-барьер, поэтому
// разметку ниже менять не нужно.
const lazyWithBoundary = (importer) => {
  const LazyComponent = lazy(importer);
  return (props) => (
    <Suspense fallback={null}>
      <LazyComponent {...props} />
    </Suspense>
  );
};

const ProfileSettings = lazyWithBoundary(() => import('./ProfileSettings'));
const IncomingCallModal = lazyWithBoundary(() => import('./IncomingCallModal'));
const ActiveCallWindow = lazyWithBoundary(() => import('./ActiveCallWindow'));

export default function MainLayout({ isMobile }) {
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [roomsRefreshSignal, setRoomsRefreshSignal] = useState(0);
  const { user } = useAuthStore();
  const call = useWebRTC(user?.id);

  // Поддерживаем звонок живым при свёрнутом приложении и выключенном экране
  // (Android foreground-service + блокировка засыпания экрана).
  useEffect(() => {
    if (['calling', 'ringing', 'active'].includes(call.callStatus)) {
      startCallKeepAlive();
    } else {
      stopCallKeepAlive();
    }
  }, [call.callStatus]);

  // Уведомление о входящем звонке, когда приложение свёрнуто/неактивно.
  useEffect(() => {
    if (call.callStatus === 'ringing' && !appIsActive()) {
      notify({
        title: 'Входящий звонок',
        body: `${call.remoteUser?.username || 'Пользователь'} звонит вам`,
        tag: 'incoming-call',
      });
    }
  }, [call.callStatus, call.remoteUser?.username]);

  // Аппаратная кнопка «Назад» на Android: закрываем настройки/выходим из чата,
  // а если возвращаться некуда — сворачиваем приложение вместо выхода.
  useEffect(() => {
    setBackButtonHandler(() => {
      if (showSettings) {
        setShowSettings(false);
        return;
      }
      if (selectedRoom) {
        setSelectedRoom(null);
        return;
      }
      minimizeApp();
    });
  }, [showSettings, selectedRoom]);

  // Сохраняем состояние при переключении
  const handleSelectRoom = (room) => {
    setSelectedRoom(room);
  };

  const handleBack = () => {
    setSelectedRoom(null);
  };

  // Закрываем чат и принудительно обновляем список комнат после удаления.
  // (realtime по DELETE с фильтром по колонке не всегда доставляется).
  const handleRoomDeleted = () => {
    setSelectedRoom(null);
    setRoomsRefreshSignal((n) => n + 1);
  };

  return (
    <div
      className="flex h-full w-full bg-dark-bg overflow-hidden relative"
      style={ { paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' } }
    >
      {/* ... (остальной код фона такой же) ... */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 right-1/4 w-96 h-96 bg-brand-primary/10 rounded-full blur-3xl animate-pulse-soft"></div>
        <div className="absolute bottom-0 left-1/4 w-80 h-80 bg-brand-secondary/10 rounded-full blur-3xl animate-pulse-soft" style={{ animationDelay: '1.5s' }}></div>
      </div>
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAxMCAwIEwgMCAwIDAgMTAiIGZpbGw9Im5vbmUiIHN0cm9rZT0icmdiYSgyNTUsMjU1LDI1NSwwLjAyKSIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIi8+PC9zdmc+')] opacity-30"></div>

      {isMobile ? (
        <>
          {!selectedRoom ? (
            <Sidebar
              selectedRoom={selectedRoom}
              onSelectRoom={handleSelectRoom}
              onOpenSettings={() => setShowSettings(true)}
              isMobile={isMobile}
              refreshSignal={roomsRefreshSignal}
            />
          ) : (
            <div className="flex-1 flex flex-col relative z-10">
              <ChatWindow 
                room={selectedRoom} 
                isMobile={isMobile}
                onBack={handleBack}
                onRoomDeleted={handleRoomDeleted}
                onStartCall={call.startCall}
                callStatus={call.callStatus}
              />
            </div>
          )}
        </>
      ) : (
        <>
          <Sidebar
            selectedRoom={selectedRoom}
            onSelectRoom={handleSelectRoom}
            onOpenSettings={() => setShowSettings(true)}
            isMobile={isMobile}
            refreshSignal={roomsRefreshSignal}
          />
          <div className="flex-1 flex flex-col relative z-10">
            {selectedRoom ? (
              <ChatWindow room={selectedRoom} isMobile={isMobile} onRoomDeleted={handleRoomDeleted} onStartCall={call.startCall} callStatus={call.callStatus} />
            ) : (
              /* ... (блок выбора чата) ... */
              <div className="flex-1 flex items-center justify-center text-gray-400 animate-fade-in">
                <div className="text-center">
                  <h3 className="text-3xl font-bold text-white mb-3">Выберите чат</h3>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {showSettings && (
        <ProfileSettings onClose={() => setShowSettings(false)} />
      )}

      {call.callStatus === 'ringing' && (
        <IncomingCallModal
          call={call.currentCall}
          caller={call.remoteUser}
          onAccept={call.acceptCall}
          onDecline={call.declineCall}
        />
      )}

      {call.callStatus === 'calling' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="glass-effect rounded-3xl p-8 max-w-md w-full mx-4 shadow-2xl animate-slide-up">
            <div className="flex flex-col items-center mb-8">
              <div className="relative mb-6">
                <div
                  className="w-32 h-32 rounded-full bg-gradient-to-br from-brand-primary to-brand-secondary flex items-center justify-center text-white text-4xl font-bold shadow-glow-lg animate-pulse-soft"
                  style={call.remoteUser?.avatar_url ? {
                    backgroundImage: `url(${call.remoteUser.avatar_url})`,
                    backgroundSize: 'cover'
                  } : {}}
                >
                  {!call.remoteUser?.avatar_url && call.remoteUser?.username?.[0]?.toUpperCase()}
                </div>
                <div className="absolute inset-0 rounded-full border-4 border-brand-primary/30 animate-ping"></div>
              </div>
              <h2 className="text-3xl font-bold mb-2 text-white">
                {call.remoteUser?.username || 'Пользователь'}
              </h2>
              <div className="flex items-center gap-3 text-gray-300 mb-4">
                <span className="text-lg">Вызов...</span>
              </div>
            </div>
            <button
              onClick={call.endCall}
              className="w-full flex items-center justify-center gap-3 px-8 py-5 bg-brand-danger/90 hover:bg-brand-danger rounded-2xl font-semibold transition-all transform hover:scale-105 active:scale-95 shadow-lg"
            >
              <span className="text-lg">Отменить</span>
            </button>
          </div>
        </div>
      )}

      {call.callStatus === 'active' && (
        <ActiveCallWindow
          localStream={call.localStream}
          remoteStream={call.remoteStream}
          isAudioEnabled={call.isAudioEnabled}
          isVideoEnabled={call.isVideoEnabled}
          callType={call.currentCall?.call_type || 'audio'}
          otherUser={call.remoteUser}
          onToggleAudio={call.toggleAudio}
          onToggleVideo={call.toggleVideo}
          onEndCall={call.endCall}
        />
      )}
    </div>
  );
}
