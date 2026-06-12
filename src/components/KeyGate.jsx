import React, { useEffect, useState } from 'react';
import { useKeyStore } from '../store/keyStore';

const wrap = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#313338',
  color: '#f2f3f5',
  padding: '24px',
};
const card = {
  width: '100%',
  maxWidth: '420px',
  background: '#2b2d31',
  borderRadius: '12px',
  padding: '28px',
  boxShadow: '0 8px 30px rgba(0,0,0,0.4)',
};
const title = { fontSize: '20px', fontWeight: 700, marginBottom: '8px' };
const sub = { fontSize: '14px', color: '#b5bac1', marginBottom: '20px', lineHeight: 1.5 };
const input = {
  width: '100%',
  padding: '11px 12px',
  borderRadius: '8px',
  border: '1px solid #1e1f22',
  background: '#1e1f22',
  color: '#f2f3f5',
  fontSize: '15px',
  marginBottom: '12px',
  boxSizing: 'border-box',
  outline: 'none',
};
const btn = {
  width: '100%',
  padding: '12px',
  borderRadius: '8px',
  border: 'none',
  background: '#5865F2',
  color: '#fff',
  fontSize: '15px',
  fontWeight: 600,
  cursor: 'pointer',
};
const btnDisabled = { ...btn, opacity: 0.5, cursor: 'not-allowed' };
const linkBtn = {
  background: 'none',
  border: 'none',
  color: '#00a8fc',
  cursor: 'pointer',
  fontSize: '13px',
  marginTop: '14px',
  padding: 0,
};
const errStyle = { color: '#fa777c', fontSize: '13px', marginBottom: '12px' };
const checkLabel = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontSize: '13px',
  color: '#b5bac1',
  marginBottom: '16px',
};
const loadingText = { color: '#b5bac1' };
const codeBox = {
  background: '#1e1f22',
  borderRadius: '8px',
  padding: '16px',
  fontSize: '20px',
  fontWeight: 700,
  letterSpacing: '2px',
  textAlign: 'center',
  fontFamily: 'monospace',
  margin: '16px 0',
  wordBreak: 'break-all',
};

export default function KeyGate({ user, profile, children }) {
  const { status, busy, error, loadKeys, setup, unlock, restore } = useKeyStore();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showRestore, setShowRestore] = useState(false);
  const [generatedCode, setGeneratedCode] = useState('');
  const [savedConfirmed, setSavedConfirmed] = useState(false);
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (user && user.id) loadKeys(user.id, profile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user && user.id, profile && profile.public_key, profile && profile.encrypted_private_key]);

  const handleSetup = async () => {
    setLocalError('');
    if (password.length < 6) {
      setLocalError('Пароль должен быть не короче 6 символов');
      return;
    }
    if (password !== confirm) {
      setLocalError('Пароли не совпадают');
      return;
    }
    try {
      const code = await setup(user.id, password);
      setGeneratedCode(code);
    } catch (e) {
      setLocalError((e && e.message) || 'Ошибка настройки');
    }
  };

  const handleUnlock = async () => {
    setLocalError('');
    try {
      await unlock(user.id, profile, password);
    } catch (e) {
      setLocalError('Неверный пароль');
    }
  };

  const handleRestore = async () => {
    setLocalError('');
    if (newPassword.length < 6) {
      setLocalError('Новый пароль должен быть не короче 6 символов');
      return;
    }
    try {
      await restore(user.id, profile, recoveryCode, newPassword);
    } catch (e) {
      setLocalError('Неверный код восстановления');
    }
  };

  if (generatedCode) {
    return (
      <div style={wrap}>
        <div style={card}>
          <div style={title}>🔑 Сохраните код восстановления</div>
          <div style={sub}>
            Этот код — единственный способ восстановить доступ к переписке, если вы забудете
            пароль. Запишите его и храните в надёжном месте.
          </div>
          <div style={codeBox}>{generatedCode}</div>
          <label style={checkLabel}>
            <input
              type="checkbox"
              checked={savedConfirmed}
              onChange={(e) => setSavedConfirmed(e.target.checked)}
            />
            Я сохранил(а) код восстановления
          </label>
          <button
            style={savedConfirmed ? btn : btnDisabled}
            disabled={!savedConfirmed}
            onClick={() => setGeneratedCode('')}
          >
            Продолжить
          </button>
        </div>
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <div style={wrap}>
        <div style={loadingText}>Загрузка ключей шифрования…</div>
      </div>
    );
  }

  if (status === 'unlocked') {
    return <>{children}</>;
  }

  if (status === 'needsSetup') {
    return (
      <div style={wrap}>
        <div style={card}>
          <div style={title}>🔐 Настройка шифрования</div>
          <div style={sub}>
            Придумайте пароль шифрования. Он защищает ваши сообщения и нужен при входе с нового
            устройства. Мы не храним его и не можем восстановить.
          </div>
          {(localError || error) && <div style={errStyle}>{localError || error}</div>}
          <input
            style={input}
            type="password"
            placeholder="Пароль шифрования"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <input
            style={input}
            type="password"
            placeholder="Повторите пароль"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          <button style={busy ? btnDisabled : btn} disabled={busy} onClick={handleSetup}>
            {busy ? 'Создание…' : 'Включить шифрование'}
          </button>
        </div>
      </div>
    );
  }

  if (showRestore) {
    return (
      <div style={wrap}>
        <div style={card}>
          <div style={title}>Восстановление по коду</div>
          <div style={sub}>Введите код восстановления и задайте новый пароль.</div>
          {(localError || error) && <div style={errStyle}>{localError || error}</div>}
          <input
            style={input}
            type="text"
            placeholder="Код восстановления"
            value={recoveryCode}
            onChange={(e) => setRecoveryCode(e.target.value)}
          />
          <input
            style={input}
            type="password"
            placeholder="Новый пароль"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <button style={busy ? btnDisabled : btn} disabled={busy} onClick={handleRestore}>
            {busy ? 'Восстановление…' : 'Восстановить'}
          </button>
          <button
            style={linkBtn}
            onClick={() => {
              setShowRestore(false);
              setLocalError('');
            }}
          >
            Назад к вводу пароля
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={title}>🔓 Разблокировка</div>
        <div style={sub}>Введите пароль шифрования, чтобы открыть переписку на этом устройстве.</div>
        {(localError || error) && <div style={errStyle}>{localError || error}</div>}
        <input
          style={input}
          type="password"
          placeholder="Пароль шифрования"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
        />
        <button style={busy ? btnDisabled : btn} disabled={busy} onClick={handleUnlock}>
          {busy ? 'Проверка…' : 'Разблокировать'}
        </button>
        <button
          style={linkBtn}
          onClick={() => {
            setShowRestore(true);
            setLocalError('');
          }}
        >
          Забыли пароль? Восстановить по коду
        </button>
      </div>
    </div>
  );
}
