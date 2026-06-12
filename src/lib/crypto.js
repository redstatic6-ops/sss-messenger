// Криптографические примитивы E2EE (Web Crypto API, ECDH P-256 + AES-GCM)
const PBKDF2_ITERATIONS = 250000;
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function b64encode(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary);
}

export function b64decode(str) {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function randomBytes(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

export async function generateIdentityKeyPair() {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits'],
  );
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { publicJwk, privateJwk };
}

export async function importPrivateKey(jwk, extractable = false) {
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    extractable,
    ['deriveKey', 'deriveBits'],
  );
}

export async function importPublicKey(jwk) {
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
}

async function deriveWrapKey(secret, salt) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function wrapPrivateKey(privateJwk, secret) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const wrapKey = await deriveWrapKey(secret, salt);
  const enc = new TextEncoder();
  const data = enc.encode(JSON.stringify(privateJwk));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, data);
  return { v: 1, salt: b64encode(salt), iv: b64encode(iv), ct: b64encode(new Uint8Array(ct)) };
}

export async function unwrapPrivateKey(envelope, secret) {
  const salt = b64decode(envelope.salt);
  const iv = b64decode(envelope.iv);
  const ct = b64decode(envelope.ct);
  const wrapKey = await deriveWrapKey(secret, salt);
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, wrapKey, ct);
  return JSON.parse(new TextDecoder().decode(data));
}

export function generateRecoveryCode() {
  const groups = [];
  for (let g = 0; g < 4; g++) {
    let group = '';
    const rand = randomBytes(5);
    for (let i = 0; i < 5; i++) group += RECOVERY_ALPHABET[rand[i] % RECOVERY_ALPHABET.length];
    groups.push(group);
  }
  return groups.join('-');
}

export function normalizeRecoveryCode(code) {
  return (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export async function aesEncryptBytes(key, bytes) {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return { iv: b64encode(iv), ct: b64encode(new Uint8Array(ct)) };
}

export async function aesDecryptBytes(key, ivB64, ctB64) {
  const iv = b64decode(ivB64);
  const ct = b64decode(ctB64);
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new Uint8Array(data);
}

export async function deriveSharedKey(myPrivateKey, otherPublicJwk) {
  const otherPub = await importPublicKey(otherPublicJwk);
  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: otherPub },
    myPrivateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function generateRoomKey() {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function exportRoomKeyRaw(key) {
  const raw = await crypto.subtle.exportKey('raw', key);
  return b64encode(new Uint8Array(raw));
}

export async function importRoomKeyRaw(rawB64, extractable = false) {
  const raw = b64decode(rawB64);
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, extractable, [
    'encrypt',
    'decrypt',
  ]);
}

// ECIES-подобная обёртка ключа для участника: эфемерная пара ECDH + AES-GCM
export async function wrapKeyForMember(memberPublicJwk, rawKeyBytes) {
  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveKey',
  ]);
  const memberPub = await importPublicKey(memberPublicJwk);
  const sharedKey = await crypto.subtle.deriveKey(
    { name: 'ECDH', public: memberPub },
    ephemeral.privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sharedKey, rawKeyBytes);
  const epk = await crypto.subtle.exportKey('jwk', ephemeral.publicKey);
  return { epk, iv: b64encode(iv), ct: b64encode(new Uint8Array(ct)) };
}

export async function unwrapKeyWithPrivate(myPrivateKey, wrapped) {
  const ephemeralPub = await importPublicKey(wrapped.epk);
  const sharedKey = await crypto.subtle.deriveKey(
    { name: 'ECDH', public: ephemeralPub },
    myPrivateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  const iv = b64decode(wrapped.iv);
  const ct = b64decode(wrapped.ct);
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, sharedKey, ct);
  return new Uint8Array(data);
}
