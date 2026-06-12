import React from 'react';

export default function TitleBar() {
  const handleMinimize = () => {
    window.electron?.minimize();
  };

  const handleMaximize = () => {
    window.electron?.maximize();
  };

  const handleClose = () => {
    window.electron?.close();
  };

  return (
    <div className="h-8 bg-dark-surface/95 backdrop-blur-xl border-b border-dark-border/50 flex items-center justify-between px-4 flex-shrink-0" style={{ WebkitAppRegion: 'drag' }}>
      {/* Логотип и название */}
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded-lg bg-gradient-to-br from-brand-primary to-brand-secondary flex items-center justify-center">
          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </div>
        <span className="text-xs font-semibold text-white">SSS Messenger</span>
      </div>

      {/* Кнопки управления окном */}
      <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' }}>
        <button
          onClick={handleMinimize}
          className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center transition-colors group"
          title="Свернуть"
        >
          <svg className="w-4 h-4 text-gray-400 group-hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
          </svg>
        </button>
        
        <button
          onClick={handleMaximize}
          className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center transition-colors group"
          title="Развернуть"
        >
          <svg className="w-3.5 h-3.5 text-gray-400 group-hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
          </svg>
        </button>
        
        <button
          onClick={handleClose}
          className="w-8 h-8 rounded-lg hover:bg-brand-danger flex items-center justify-center transition-colors group"
          title="Закрыть"
        >
          <svg className="w-4 h-4 text-gray-400 group-hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
