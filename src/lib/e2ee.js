import { useKeyStore } from '../store/keyStore';
import { supabase } from './supabase';
import {
  b64encode,
  b64decode,
  deriveSharedKey,
  generateRoomKey,
  exportRoomKeyRaw,
  importRoomKeyRaw,
  wrapKeyForMember,
  unwrapKeyWithPrivate,
  aesEncryptBytes,
  aesDecryptBytes,
} from './crypto';

export const MSG_PREFIX = 'e2ee:v1:';
export const FILE_PREFIX = 'e2ee:file:v1:';

const roomKeyCache = new Map();
const dmKeyCache = new Map();
const pubKeyCache = new Map();

export function clearE2EECaches() {
  roomKeyCache.clear();
  dmKeyCache.clear();
  pubKeyCache.clear();
}

export function isEncryptedText(content) {
  return typeof content === 'string' && content.startsWith(MSG_PREFIX);
}

export function isEncryptedFile(content) {
  return typeof content === 'string' && content.startsWith(FILE_PREFIX);
}

function getMyPrivateKey() {
  return useKeyStore.getState().privateKey;
}

async function fetchPublicJwk(userId) {
  if (pubKeyCache.has(userId)) return pubKeyCache.get(userId);
  const { data } = await supabase
    .from('profiles')
    .select('public_key')
    .eq('id', userId)
    .maybeSingle();
  if (!data || !data.public_key) return null;
  const jwk = JSON.parse(data.public_key);
  pubKeyCache.set(userId, jwk);
  return jwk;
}

async function getDmKey(room) {
  if (dmKeyCache.has(room.id)) return dmKeyCache.get(room.id);
  const myPriv = getMyPrivateKey();
  if (!myPriv) return null;
  const { userId } = useKeyStore.getState();
  const { data: members } = await supabase
    .from('room_members')
    .select('user_id')
    .eq('room_id', room.id);
  if (!members) return null;
  const other = members.find((m) => m.user_id !== userId);
  if (!other) return null;
  const otherPub = await fetchPublicJwk(other.user_id);
  if (!otherPub) return null;
  const key = await deriveSharedKey(myPriv, otherPub);
  dmKeyCache.set(room.id, key);
  return key;
}

async function getGroupKey(room) {
  if (roomKeyCache.has(room.id)) return roomKeyCache.get(room.id);
  const myPriv = getMyPrivateKey();
  if (!myPriv) return null;
  const { userId } = useKeyStore.getState();
  const { data } = await supabase
    .from('room_keys')
    .select('wrapped_key')
    .eq('room_id', room.id)
    .eq('user_id', userId)
    .maybeSingle();
  if (!data || !data.wrapped_key) return null;
  const wrapped = JSON.parse(data.wrapped_key);
  const rawKey = await unwrapKeyWithPrivate(myPriv, wrapped);
  const key = await importRoomKeyRaw(b64encode(rawKey), false);
  roomKeyCache.set(room.id, key);
  return key;
}

export async function getRoomContentKey(room) {
  if (!room) return null;
  if (room.is_group) return getGroupKey(room);
  return getDmKey(room);
}

export async function ensureGroupRoomKey(roomId, memberIds) {
  const myPriv = getMyPrivateKey();
  if (!myPriv) return;
  const { data: existing } = await supabase
    .from('room_keys')
    .select('user_id')
    .eq('room_id', roomId);
  if (existing && existing.length > 0) return;
  const roomKey = await generateRoomKey();
  const rawB64 = await exportRoomKeyRaw(roomKey);
  const rawBytes = b64decode(rawB64);
  const rows = [];
  for (const memberId of memberIds) {
    const pub = await fetchPublicJwk(memberId);
    if (!pub) continue;
    const wrapped = await wrapKeyForMember(pub, rawBytes);
    rows.push({ room_id: roomId, user_id: memberId, wrapped_key: JSON.stringify(wrapped) });
  }
  if (rows.length > 0) {
    await supabase.from('room_keys').upsert(rows, { onConflict: 'room_id,user_id' });
  }
}

export async function encryptText(room, plaintext) {
  const key = await getRoomContentKey(room);
  if (!key) return null;
  const enc = new TextEncoder();
  const { iv, ct } = await aesEncryptBytes(key, enc.encode(plaintext));
  return MSG_PREFIX + JSON.stringify({ iv, ct });
}

export async function decryptText(room, content) {
  if (!isEncryptedText(content)) return content;
  try {
    const key = await getRoomContentKey(room);
    if (!key) return '🔒 Сообщение зашифровано (нет ключа)';
    const payload = JSON.parse(content.slice(MSG_PREFIX.length));
    const bytes = await aesDecryptBytes(key, payload.iv, payload.ct);
    return new TextDecoder().decode(bytes);
  } catch (e) {
    console.warn('decryptText error', e);
    return '🔒 Не удалось расшифровать';
  }
}

export async function encryptFile(room, file) {
  const roomKey = await getRoomContentKey(room);
  if (!roomKey) return null;
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const fileKey = await generateRoomKey();
  const fileEnc = await aesEncryptBytes(fileKey, fileBytes);
  const fileKeyRawB64 = await exportRoomKeyRaw(fileKey);
  const keyEnc = await aesEncryptBytes(roomKey, b64decode(fileKeyRawB64));
  const blob = new Blob([b64decode(fileEnc.ct)], { type: 'application/octet-stream' });
  const envelope =
    FILE_PREFIX +
    JSON.stringify({
      fileIv: fileEnc.iv,
      keyIv: keyEnc.iv,
      keyCt: keyEnc.ct,
      name: file.name,
      type: file.type,
      size: file.size,
    });
  return { blob, envelope };
}

export async function decryptFileToUrl(room, url, content) {
  if (!isEncryptedFile(content)) {
    return { url, name: null, type: null, legacy: true };
  }
  try {
    const roomKey = await getRoomContentKey(room);
    if (!roomKey) return null;
    const meta = JSON.parse(content.slice(FILE_PREFIX.length));
    const resp = await fetch(url);
    const cipherBytes = new Uint8Array(await resp.arrayBuffer());
    const fileKeyRaw = await aesDecryptBytes(roomKey, meta.keyIv, meta.keyCt);
    const fileKey = await importRoomKeyRaw(b64encode(fileKeyRaw), false);
    const plainBytes = await aesDecryptBytes(fileKey, meta.fileIv, b64encode(cipherBytes));
    const blob = new Blob([plainBytes], { type: meta.type || 'application/octet-stream' });
    const objUrl = URL.createObjectURL(blob);
    return { url: objUrl, name: meta.name, type: meta.type, legacy: false };
  } catch (e) {
    console.warn('decryptFileToUrl error', e);
    return null;
  }
}
