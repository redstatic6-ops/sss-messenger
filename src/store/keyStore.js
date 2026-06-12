// Хранилище ключей шифрования. Приватный ключ хранится локально в IndexedDB.
import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import {
  generateIdentityKeyPair,
  importPrivateKey,
  wrapPrivateKey,
  unwrapPrivateKey,
  generateRecoveryCode,
  normalizeRecoveryCode,
} from '../lib/crypto';

const DB_NAME = 'sss-e2ee';
const STORE_NAME = 'keys';
const idbKey = (userId) => 'priv:' + userId;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbDel(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export const useKeyStore = create((set, get) => ({
  status: 'loading',
  userId: null,
  privateKey: null,
  publicKeyJwk: null,
  error: null,
  busy: false,

  loadKeys: async (userId, profile) => {
    set({ status: 'loading', userId, error: null });
    try {
      const hasServerKey = !!(profile && profile.public_key && profile.encrypted_private_key);
      if (!hasServerKey) {
        set({ status: 'needsSetup', privateKey: null, publicKeyJwk: null });
        return;
      }
      const storedKey = await idbGet(idbKey(userId));
      if (storedKey) {
        set({
          status: 'unlocked',
          privateKey: storedKey,
          publicKeyJwk: profile.public_key ? JSON.parse(profile.public_key) : null,
        });
        return;
      }
      set({
        status: 'locked',
        privateKey: null,
        publicKeyJwk: profile.public_key ? JSON.parse(profile.public_key) : null,
      });
    } catch (e) {
      console.error('loadKeys error', e);
      set({ status: 'locked', error: e.message });
    }
  },

  setup: async (userId, password) => {
    set({ busy: true, error: null });
    try {
      const { publicJwk, privateJwk } = await generateIdentityKeyPair();
      const recoveryCode = generateRecoveryCode();
      const encryptedByPassword = await wrapPrivateKey(privateJwk, password);
      const encryptedByRecovery = await wrapPrivateKey(privateJwk, normalizeRecoveryCode(recoveryCode));
      const { error } = await supabase
        .from('profiles')
        .update({
          public_key: JSON.stringify(publicJwk),
          encrypted_private_key: JSON.stringify(encryptedByPassword),
          recovery_private_key: JSON.stringify(encryptedByRecovery),
        })
        .eq('id', userId);
      if (error) throw error;
      const privateKey = await importPrivateKey(privateJwk, false);
      await idbSet(idbKey(userId), privateKey);
      set({ status: 'unlocked', userId, privateKey, publicKeyJwk: publicJwk, busy: false });
      return recoveryCode;
    } catch (e) {
      console.error('setup error', e);
      set({ busy: false, error: e.message });
      throw e;
    }
  },

  unlock: async (userId, profile, password) => {
    set({ busy: true, error: null });
    try {
      const envelope = JSON.parse(profile.encrypted_private_key);
      const privateJwk = await unwrapPrivateKey(envelope, password);
      const privateKey = await importPrivateKey(privateJwk, false);
      await idbSet(idbKey(userId), privateKey);
      set({
        status: 'unlocked',
        userId,
        privateKey,
        publicKeyJwk: profile.public_key ? JSON.parse(profile.public_key) : null,
        busy: false,
      });
    } catch (e) {
      console.error('unlock error', e);
      set({ busy: false, error: 'Неверный пароль' });
      throw e;
    }
  },

  restore: async (userId, profile, recoveryCode, newPassword) => {
    set({ busy: true, error: null });
    try {
      const envelope = JSON.parse(profile.recovery_private_key);
      const privateJwk = await unwrapPrivateKey(envelope, normalizeRecoveryCode(recoveryCode));
      const encryptedByPassword = await wrapPrivateKey(privateJwk, newPassword);
      const { error } = await supabase
        .from('profiles')
        .update({ encrypted_private_key: JSON.stringify(encryptedByPassword) })
        .eq('id', userId);
      if (error) throw error;
      const privateKey = await importPrivateKey(privateJwk, false);
      await idbSet(idbKey(userId), privateKey);
      set({
        status: 'unlocked',
        userId,
        privateKey,
        publicKeyJwk: profile.public_key ? JSON.parse(profile.public_key) : null,
        busy: false,
      });
    } catch (e) {
      console.error('restore error', e);
      set({ busy: false, error: 'Неверный код восстановления' });
      throw e;
    }
  },

  clear: async (userId) => {
    try {
      if (userId) await idbDel(idbKey(userId));
    } catch (e) {
      console.warn('clear idb error', e);
    }
    set({
      status: 'loading',
      userId: null,
      privateKey: null,
      publicKeyJwk: null,
      error: null,
      busy: false,
    });
  },
}));
