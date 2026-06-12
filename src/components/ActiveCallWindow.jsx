import React, { useEffect, useRef, useState } from 'react';

/**
 * Окно активного звонка с видео
 */
export default function ActiveCallWindow({
  localStream,
  remoteStream,
  isAudioEnabled,
  isVideoEnabled,
  callType,
  otherUser,
  duration,
  onToggleAudio,
  onToggleVideo,
  onEndCall
}) {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const [callDuration, setCallDuration] = useState(0);

  // Подключаем локальный поток к video элементу
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // Подключаем удаленный поток к video элементу
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  // Подключаем удаленный поток к audio элементу для воспроизведения звука
  useEffect(() => {
    if (remoteAudioRef.current && remoteStream) {
      console.log('🔊 Подключение удалённого аудио потока');
      remoteAudioRef.current.srcObject = remoteStream;
      // Явно пытаемся воспроизвести
      remoteAudioRef.current.play().catch(err => {
        console.error('❌ Ошибка воспроизведения аудио:', err);
      });
    }
  }, [remoteStream]);

  // Таймер длительности звонка
  useEffect(() => {
    const interval = setInterval(() => {
      setCallDuration(prev => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Форматирование времени
  const formatDuration = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const isVideoCall = callType === 'video';

  return (
    <div className="fixed inset-0 z-50 bg-gradient-to-br from-dark-bg via-dark-surface to-dark-bg flex flex-col animate-fade-in">
      {/* Скрытый audio элемент для воспроизведения удалённого звука */}
      <audio
        ref={remoteAudioRef}
        autoPlay
        playsInline
      />
      
      {/* Удаленное видео (основное) */}
      <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden">
        {/* Анимированный фон для аудиозвонков */}
        {!isVideoCall && (
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-brand-primary/10 rounded-full blur-3xl animate-pulse-soft"></div>
            <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-brand-secondary/10 rounded-full blur-3xl animate-pulse-soft" style={{ animationDelay: '1.5s' }}></div>
          </div>
        )}

        {isVideoCall && remoteStream ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="flex flex-col items-center animate-fade-in relative z-10">
            <div className="relative mb-8">
              <div
                className="w-48 h-48 rounded-3xl bg-gradient-to-br from-brand-primary to-brand-secondary flex items-center justify-center text-white text-7xl font-bold shadow-glow-lg animate-pulse-soft"
                style={otherUser?.avatar_url ? {
                  backgroundImage: `url(${otherUser.avatar_url})`,
                  backgroundSize: 'cover'
                } : {}}
              >
                {!otherUser?.avatar_url && otherUser?.username?.[0]?.toUpperCase()}
              </div>
              {/* Пульсирующие волны */}
              <div className="absolute -inset-4 rounded-3xl border-4 border-brand-primary/30 animate-ping"></div>
              <div className="absolute -inset-2 rounded-3xl border-2 border-brand-primary/20 animate-ping" style={{ animationDelay: '0.5s' }}></div>
            </div>
            <h2
              className="text-4xl font-bold mb-4"
              style={{ color: otherUser?.custom_color || '#FFFFFF' }}
            >
              {otherUser?.username || 'Пользователь'}
            </h2>
            <div className="flex items-center gap-3 px-6 py-3 glass-effect rounded-2xl">
              {remoteStream ? (
                <>
                  <div className="w-3 h-3 bg-brand-success rounded-full animate-pulse"></div>
                  <p className="text-xl text-white font-semibold">На связи</p>
                </>
              ) : (
                <>
                  <svg className="animate-spin h-5 w-5 text-brand-primary" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <p className="text-xl text-gray-300">Соединение...</p>
                </>
              )}
            </div>
          </div>
        )}

        {/* Информация о звонке */}
        <div className="absolute top-6 left-6 glass-effect-dark px-6 py-4 rounded-2xl shadow-xl border border-white/10 animate-slide-in-right">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-primary to-brand-secondary flex items-center justify-center text-white font-bold shadow-lg">
              {otherUser?.username?.[0]?.toUpperCase() || 'U'}
            </div>
            <div>
              <p className="text-white font-bold text-lg">
                {otherUser?.username || 'Пользователь'}
              </p>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-brand-success rounded-full animate-pulse"></div>
                <p className="text-sm text-gray-300 font-medium">
                  {formatDuration(callDuration)}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Локальное видео (миниатюра) */}
        {isVideoCall && localStream && (
          <div className="absolute bottom-6 right-6 w-64 h-48 bg-black rounded-2xl overflow-hidden shadow-2xl border-2 border-white/20 animate-slide-in-left">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover mirror"
            />
            {!isVideoEnabled && (
              <div className="absolute inset-0 glass-effect-dark flex items-center justify-center backdrop-blur-sm">
                <div className="text-center">
                  <div className="w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-brand-primary to-brand-secondary flex items-center justify-center text-white text-3xl font-bold shadow-lg mb-3">
                    Вы
                  </div>
                  <p className="text-sm text-gray-300">Камера выключена</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Панель управления */}
      <div className="glass-effect-dark border-t border-white/10 p-8 backdrop-blur-xl">
        <div className="flex items-center justify-center gap-4">
          {/* Микрофон */}
          <button
            onClick={onToggleAudio}
            className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all transform hover:scale-110 active:scale-95 shadow-xl ${
              isAudioEnabled
                ? 'bg-dark-accent hover:bg-dark-hover border border-dark-border'
                : 'bg-brand-danger hover:bg-red-600 shadow-glow border border-brand-danger'
            }`}
            title={isAudioEnabled ? 'Выключить микрофон' : 'Включить микрофон'}
          >
            {isAudioEnabled ? (
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            ) : (
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
              </svg>
            )}
          </button>

          {/* Видео (только для видеозвонков) */}
          {isVideoCall && (
            <button
              onClick={onToggleVideo}
              className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all transform hover:scale-110 active:scale-95 shadow-xl ${
                isVideoEnabled
                  ? 'bg-dark-accent hover:bg-dark-hover border border-dark-border'
                  : 'bg-brand-danger hover:bg-red-600 shadow-glow border border-brand-danger'
              }`}
              title={isVideoEnabled ? 'Выключить видео' : 'Включить видео'}
            >
              {isVideoEnabled ? (
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              ) : (
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
              )}
            </button>
          )}

          {/* Завершить звонок */}
          <button
            onClick={onEndCall}
            className="w-20 h-20 rounded-2xl bg-brand-danger hover:bg-red-600 flex items-center justify-center transition-all transform hover:scale-110 active:scale-95 shadow-2xl border-2 border-white/10"
            title="Завершить звонок"
          >
            <svg className="w-9 h-9" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" />
            </svg>
          </button>
        </div>

        {/* Подсказки */}
        <div className="mt-6 flex items-center justify-center gap-6 text-xs text-gray-400">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isAudioEnabled ? 'bg-brand-success' : 'bg-brand-danger'}`}></div>
            <span>{isAudioEnabled ? 'Микрофон вкл.' : 'Микрофон выкл.'}</span>
          </div>
          {isVideoCall && (
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${isVideoEnabled ? 'bg-brand-success' : 'bg-brand-danger'}`}></div>
              <span>{isVideoEnabled ? 'Камера вкл.' : 'Камера выкл.'}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
