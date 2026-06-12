const { app, BrowserWindow, session, Menu, Tray, nativeImage, ipcMain } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

let mainWindow;
let tray = null;

// Убираем меню приложения ГЛОБАЛЬНО перед созданием окна
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  setupAutoUpdater();
});

// Авто-обновление (ПК): проверяет GitHub Releases, тихо качает новую версию
// в фоне и предлагает перезапуск для установки. Только в собранном приложении.
function setupAutoUpdater() {
  if (!app.isPackaged) return;
  try {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', (info) => {
      console.log('Доступно обновление:', info && info.version);
    });

    autoUpdater.on('update-downloaded', (info) => {
      console.log('Обновление загружено:', info && info.version);
      try {
        const { dialog } = require('electron');
        dialog
          .showMessageBox(mainWindow, {
            type: 'info',
            buttons: ['Перезапустить', 'Позже'],
            defaultId: 0,
            cancelId: 1,
            title: 'Обновление готово',
            message: 'Доступна новая версия SSS Messenger',
            detail:
              'Версия ' +
              (info && info.version) +
              ' загружена. Перезапустить сейчас, чтобы установить?',
          })
          .then((res) => {
            if (res.response === 0) autoUpdater.quitAndInstall();
          })
          .catch(() => {});
      } catch (e) {
        console.warn('update dialog error', e);
      }
    });

    autoUpdater.on('error', (err) => {
      console.error('Ошибка авто-обновления:', err);
    });

    autoUpdater.checkForUpdatesAndNotify();
  } catch (e) {
    console.error('setupAutoUpdater failed', e);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true,
      allowRunningInsecureContent: false
    },
    frame: false, // Убираем стандартную рамку браузера
    backgroundColor: '#0B0E11',
    show: false,
    titleBarStyle: 'hidden',
    transparent: false,
    resizable: true,
    maximizable: true,
    autoHideMenuBar: true // Скрываем меню
  });

  // Принудительно убираем меню для этого окна
  mainWindow.setMenu(null);
  mainWindow.setMenuBarVisibility(false);
  mainWindow.removeMenu();

  // Обработчики управления окном
  ipcMain.on('window-minimize', () => {
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.on('window-maximize', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    }
  });

  ipcMain.on('window-close', () => {
    if (mainWindow) mainWindow.close();
  });

  ipcMain.handle('window-is-maximized', () => {
    return mainWindow ? mainWindow.isMaximized() : false;
  });

  // Разрешаем доступ к микрофону и камере
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['media', 'mediaKeySystem', 'notifications', 'fullscreen'];
    if (allowedPermissions.includes(permission)) {
      callback(true);
    } else {
      callback(false);
    }
  });

  // Автоматически предоставляем разрешения
  session.defaultSession.setPermissionCheckHandler(() => {
    return true;
  });

  // Блокируем DevTools в продакшене
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    // mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    
    // Блокируем DevTools в релизе
    mainWindow.webContents.on('devtools-opened', () => {
      mainWindow.webContents.closeDevTools();
    });
  }

  // Плавное появление окна
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Предотвращаем открытие внешних ссылок
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Открываем внешние ссылки в браузере по умолчанию
    if (url.startsWith('http://') || url.startsWith('https://')) {
      require('electron').shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Создание системного трея
  createTray();
}

function createTray() {
  if (!app.isPackaged) return; // Только в продакшене
  
  try {
    // Загружаем иконку трея из ресурсов; пустую иконку не используем,
    // иначе в системном трее появляется прозрачный квадрат
    const iconCandidates = [
      path.join(process.resourcesPath || '', 'icon.png'),
      path.join(__dirname, '../build/icon.png'),
      path.join(__dirname, '../build/icon.ico')
    ];
    let trayIcon = nativeImage.createEmpty();
    for (const candidate of iconCandidates) {
      const img = nativeImage.createFromPath(candidate);
      if (!img.isEmpty()) {
        trayIcon = img;
        break;
      }
    }
    if (trayIcon.isEmpty()) {
      console.warn('Иконка трея не найдена — трей не создаётся');
      return;
    }
    tray = new Tray(trayIcon);
    
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Открыть SSS Messenger',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          } else {
            createWindow();
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Выход',
        click: () => {
          app.quit();
        }
      }
    ]);

    tray.setToolTip('SSS Messenger');
    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    });
  } catch (error) {
    console.error('Ошибка создания трея:', error);
  }
}

// Запрет на запуск нескольких экземпляров
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Отключаем аппаратное ускорение для лучшей совместимости
// app.disableHardwareAcceleration();

// Настройки безопасности
app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(navigationUrl);
    } catch (e) {
      event.preventDefault();
      return;
    }

    const allowedOrigins = ['http://localhost:5173'];
    const allowedHostSuffixes = ['supabase.co', 'supabase.in'];

    const isAllowedOrigin = allowedOrigins.includes(parsedUrl.origin);
    const isAllowedHost = allowedHostSuffixes.some(
      (suffix) => parsedUrl.hostname === suffix || parsedUrl.hostname.endsWith('.' + suffix)
    );
    const isFile = parsedUrl.protocol === 'file:';

    // Разрешаем навигацию внутри приложения, на file:// и на домены Supabase (auth redirect)
    if (!isAllowedOrigin && !isAllowedHost && !isFile) {
      event.preventDefault();
    }
  });
});
