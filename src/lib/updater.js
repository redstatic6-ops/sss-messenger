// Проверка обновлений для Android (раздача APK напрямую, не через Play Store).
//
// Логика (вариант A — MVP):
//   1. Берём текущую версию приложения (Capacitor App.getInfo, иначе константа ниже).
//   2. Качаем манифест update.json из репозитория на GitHub.
//   3. Если versionCode в манифесте больше текущего — предлагаем скачать APK.
//   4. Открываем ссылку на APK во внешнем браузере; пользователь ставит вручную.
//
// На ПК (Electron) обновления идут отдельно через electron-updater (electron/main.js),
// поэтому здесь работаем только на Android.
//
// Когда захотим бесшовно (скачал -> поставил прямо в приложении) — это вариант B:
// нужен REQUEST_INSTALL_PACKAGES + установка APK через FileProvider (см. AUTO_UPDATE.md).

import { isAndroid } from './native';

// Текущая версия. Держим в синхроне с android/app/build.gradle (versionName/versionCode)
// и с package.json. Используется как запасной вариант, если App.getInfo недоступен.
export const APP_VERSION = '1.0';
export const APP_VERSION_CODE = 1;

// Манифест последней версии. Лежит в корне репозитория (ветка main).
const UPDATE_MANIFEST_URL =
  'https://raw.githubusercontent.com/redstatic6-ops/sss-messenger/main/update.json';

async function getCurrentVersion() {
  try {
    const Cap = typeof window !== 'undefined' ? window.Capacitor : undefined;
    const App = Cap && Cap.Plugins && Cap.Plugins.App;
    if (App && App.getInfo) {
      const info = await App.getInfo();
      return {
        versionName: info.version || APP_VERSION,
        versionCode: Number(info.build) || APP_VERSION_CODE,
      };
    }
  } catch (e) {
    console.warn('getCurrentVersion', e);
  }
  return { versionName: APP_VERSION, versionCode: APP_VERSION_CODE };
}

async function openExternal(url) {
  try {
    const Cap = typeof window !== 'undefined' ? window.Capacitor : undefined;
    const Browser = Cap && Cap.Plugins && Cap.Plugins.Browser;
    if (Browser && Browser.open) {
      await Browser.open({ url });
      return;
    }
  } catch (e) {
    console.warn('Browser.open', e);
  }
  try {
    // '_system' просит Capacitor/Cordova открыть системный браузер
    window.open(url, '_system');
  } catch (e) {
    window.open(url, '_blank');
  }
}

// Проверить наличие обновления. Возвращает манифест, если есть новее, иначе null.
// silent сейчас не влияет на поведение (зарезервировано под тихие фоновые проверки).
export async function checkForAndroidUpdate({ silent = true } = {}) {
  if (!isAndroid) return null;
  try {
    const res = await fetch(UPDATE_MANIFEST_URL + '?t=' + Date.now(), {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const manifest = await res.json();
    const cur = await getCurrentVersion();
    const isNewer = Number(manifest.versionCode) > Number(cur.versionCode);
    if (!isNewer) return null;

    const lines = ['Доступна новая версия ' + (manifest.versionName || '')];
    if (manifest.notes) lines.push('', String(manifest.notes));
    lines.push('', 'Скачать обновление?');
    const ok = window.confirm(lines.join('\n'));
    if (ok && manifest.apkUrl) {
      await openExternal(manifest.apkUrl);
    }
    return manifest;
  } catch (e) {
    console.warn('checkForAndroidUpdate', e);
    return null;
  }
}
