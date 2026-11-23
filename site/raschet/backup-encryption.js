import { MAX_BACKUP_BYTES } from './backups.js';

const FORMAT = 'raschet-encrypted-backup';
const VERSION = 1;
const ITERATIONS = 600_000;
const encoder = new TextEncoder();
const context = encoder.encode(`${FORMAT}:${VERSION}`);
export const MAX_ENCRYPTED_BYTES = Math.ceil((MAX_BACKUP_BYTES + 16) / 3) * 4 + 1024;

export const isEncryptedBackup = value => value?.format === FORMAT;

const toBase64 = bytes => {
  let binary = '';
  for (let start = 0; start < bytes.length; start += 0x4000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x4000));
  }
  return btoa(binary);
};

function fromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(password, salt, usage) {
  if (!globalThis.crypto?.subtle) throw Error('Для защиты копии откройте «Расчёт» по HTTPS в современном браузере.');
  const source = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt },
    source, { name: 'AES-GCM', length: 256 }, false, [usage],
  );
}

export async function encryptBackup(raw, password) {
  if (password.length < 12 || password.length > 128) throw Error('Введите пароль из 12–128 символов.');
  const plaintext = encoder.encode(raw);
  if (plaintext.length > MAX_BACKUP_BYTES) throw Error('Размер книги превышает 16 МБ.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, 'encrypt');
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: context }, key, plaintext);
  return JSON.stringify({ format: FORMAT, version: VERSION, salt: toBase64(salt), iv: toBase64(iv), data: toBase64(new Uint8Array(ciphertext)) });
}

export async function decryptBackup(envelope, password) {
  if (envelope.version !== VERSION) throw Error('Эта версия защищённой копии не поддерживается.');
  let salt, iv, ciphertext;
  try {
    if (typeof envelope.salt !== 'string' || envelope.salt.length !== 24 ||
        typeof envelope.iv !== 'string' || envelope.iv.length !== 16 ||
        typeof envelope.data !== 'string' || envelope.data.length > MAX_ENCRYPTED_BYTES) throw Error();
    salt = fromBase64(envelope.salt);
    iv = fromBase64(envelope.iv);
    ciphertext = fromBase64(envelope.data);
    if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 16 || ciphertext.length > MAX_BACKUP_BYTES + 16) throw Error();
  } catch {
    throw Error('Защищённая копия повреждена.');
  }
  const key = await deriveKey(password, salt, 'decrypt');
  try {
    const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: context }, key, ciphertext);
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    throw Error('Пароль неверный или файл повреждён.');
  }
}
