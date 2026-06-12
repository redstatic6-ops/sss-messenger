import React, { useEffect } from 'react';

/**
 * Модальное окно входящего звонка
 */
export default function IncomingCallModal({ call, caller, onAccept, onDecline }) {
  useEffect(() => {
    // Воспроизведение звука звонка (опционально)
    const audio = new Audio('/call-ringtone.mp3');
    audio.loop = true;
    audio.play().catch(() => {
      // Браузер может блокировать автоматическое воспроизведение
    });

    return () => {
      audio.pause();
      audio.currentTime = 0;
    };
  }, []);

  const isVideoCall = call?.call_type === 'video';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-lg animate-fade-in">
      {/* Фоновые эффекты */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-brand-primary/20 rounded-full blur-3xl animate-pulse-soft"></div>
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-brand-success/20 rounded-full blur-3xl animate-pulse-soft" style={{ animationDelay: '1s' }}></div>
      </div>

      <div className="glass-effect-dark rounded-3xl p-10 max-w-lg w-full mx-4 shadow-2xl border border-white/10 animate-scale-in relative z-10">
        {/* Аватар звонящего */}
        <div className="flex flex-col items-center mb-10">
          <div className="relative mb-8">
            <div
              className="w-36 h-36 rounded-2xl bg-gradient-to-br from-brand-primary to-brand-secondary flex items-center justify-center text-white text-5xl font-bold shadow-glow-lg animate-pulse-soft"
              style={caller?.avatar_url ? { 
                backgroundImage: `url(${caller.avatar_url})`, 
                backgroundSize: 'cover' 
              } : {}}
            >
              {!caller?.avatar_url && caller?.username?.[0]?.toUpperCase()}
            </div>
            {/* Пульсирующие кольца */}
            <div className="absolute -inset-4 rounded-2xl border-4 border-brand-primary/40 animate-ping"></div>
            <div className="absolute -inset-2 rounded-2xl border-2 border-brand-primary/30 animate-ping" style={{ animationDelay: '0.5s' }}></div>
          </div>

          <h2 
            className="text-4xl font-bold mb-3 text-center"
            style={{ color: caller?.custom_color || '#FFFFFF' }}
          >
            {caller?.username || 'Пользователь'}
          </h2>

          <div className="flex items-center gap-3 px-6 py-3 glass-effect rounded-2xl">
            {isVideoCall ? (
              <>
                <div className="p-2.5 bg-brand-primary/20 rounded-xl">
                  <svg className="w-6 h-6 text-brand-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
                <span className="text-lg font-semibold text-white">Видеозвонок</span>
              </>
            ) : (
              <>
                <div className="p-2.5 bg-brand-success/20 rounded-xl">
                  <svg className="w-6 h-6 text-brand-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                </div>
                <span className="text-lg font-semibold text-white">Аудиозвонок</span>
              </>
            )}
          </div>
        </div>

        {/* Кнопки управления */}
        <div className="flex gap-4 justify-center mb-6">
          {/* Кнопка отклонить */}
          <button
            onClick={onDecline}
            className="flex-1 group relative overflow-hidden flex flex-col items-center justify-center gap-3 px-6 py-6 bg-brand-danger/90 hover:bg-brand-danger rounded-2xl font-bold transition-all transform hover:scale-105 active:scale-95 shadow-xl"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-red-600 to-brand-danger opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <svg className="w-8 h-8 relative z-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" />
            </svg>
            <span className="text-base relative z-10">Отклонить</span>
          </button>

          {/* Кнопка принять */}
          <button
            onClick={onAccept}
            className="flex-1 group relative overflow-hidden flex flex-col items-center justify-center gap-3 px-6 py-6 bg-brand-success/90 hover:bg-brand-success rounded-2xl font-bold transition-all transform hover:scale-105 active:scale-95 shadow-xl"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-green-600 to-brand-success opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <svg className="w-8 h-8 relative z-10 animate-bounce-soft" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
            <span className="text-base relative z-10">Принять</span>
          </button>
        </div>

        {/* Подсказка */}
        <div className="flex items-center justify-center gap-2 text-sm text-gray-400">
          {isVideoCall ? (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <span>Убедитесь, что камера и микрофон работают</span>
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
              <span>Убедитесь, что микрофон работает</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
