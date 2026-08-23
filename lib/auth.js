// ─────────────────────────────────────────────────────────────────────────────
//  Аутентификация. Работает на Edge Runtime — только Web Crypto, без Node API,
//  поэтому файл импортируется и из middleware.js, и из api/login.js.
//
//  Пользователи лежат в lib/users.js (Redis или AUTH_USERS), здесь только
//  криптография: хеширование паролей и подпись сессий.
//
//    AUTH_SECRET — секрет для подписи сессионной куки (32+ байта)
//
//  Пользователи заводятся через `node tools/manage-users.mjs add <логин>`.
// ─────────────────────────────────────────────────────────────────────────────

import { getStoreKind } from './users.js';

const enc = new TextEncoder();

export const COOKIE_NAME = 'ru_news_session';
export const SESSION_TTL_SECONDS = Number(process.env.AUTH_SESSION_TTL || 60 * 60 * 24 * 14); // 14 дней

// ── base64url ───────────────────────────────────────────────────────────────

function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

// ── Сравнение за постоянное время ───────────────────────────────────────────
// Обычное === на строках выходит из цикла на первом различии, и по времени
// ответа можно посимвольно подобрать значение. Здесь время не зависит от того,
// где именно данные разошлись.

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ── PBKDF2 ──────────────────────────────────────────────────────────────────

export async function derivePasswordHash(password, salt, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  );

  return new Uint8Array(bits);
}

export function formatPasswordHash(iterations, salt, hash) {
  return `pbkdf2$${iterations}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;

  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;

  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1000) return false;

  let salt;
  let expected;
  try {
    salt = fromBase64Url(parts[2]);
    expected = fromBase64Url(parts[3]);
  } catch {
    return false;
  }

  const actual = await derivePasswordHash(password, salt, iterations);
  return timingSafeEqual(actual, expected);
}

// ── Сессионный токен: payload + HMAC-SHA256 ────────────────────────────────

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

export async function createSessionToken(username, secret, ttlSeconds = SESSION_TTL_SECONDS) {
  const payload = {
    v: 1,
    u: username,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds
  };

  const body = toBase64Url(enc.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body)));

  return `${body}.${toBase64Url(signature)}`;
}

export async function verifySessionToken(token, secret) {
  if (typeof token !== 'string') return null;

  const dot = token.indexOf('.');
  if (dot < 1) return null;

  const body = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);

  let signature;
  try {
    signature = fromBase64Url(providedSig);
  } catch {
    return null;
  }

  const key = await hmacKey(secret);
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body)));
  if (!timingSafeEqual(signature, expected)) return null;

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body)));
  } catch {
    return null;
  }

  if (!payload || typeof payload.exp !== 'number' || typeof payload.u !== 'string') return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;

  return payload;
}

// ── Кука ────────────────────────────────────────────────────────────────────
// HttpOnly — недоступна из JS, так что XSS не утащит сессию.
// SameSite=Lax — защита от CSRF, при этом переход по ссылке извне работает.

export function buildSessionCookie(token, maxAgeSeconds = SESSION_TTL_SECONDS) {
  return [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`
  ].join('; ');
}

export function buildClearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function readCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  for (const chunk of cookieHeader.split(';')) {
    const index = chunk.indexOf('=');
    if (index < 0) continue;
    if (chunk.slice(0, index).trim() === name) return chunk.slice(index + 1).trim();
  }
  return null;
}

// ── Проверка конфигурации ───────────────────────────────────────────────────

export function getAuthConfig() {
  const secret = process.env.AUTH_SECRET;
  const storeKind = getStoreKind();

  const missing = [];
  if (!secret || secret.length < 32) missing.push('AUTH_SECRET (минимум 32 символа)');
  if (storeKind === 'none') {
    missing.push('хранилище пользователей: либо KV_REST_API_URL + KV_REST_API_TOKEN, либо AUTH_USERS');
  }

  return { secret, storeKind, missing, configured: missing.length === 0 };
}

// Фиктивный хеш для случая «такого пользователя нет». Мы всё равно прогоняем
// PBKDF2, чтобы время ответа не выдавало, существует логин или нет — иначе
// список действующих пользователей вычисляется простым замером задержки.
export const DUMMY_PASSWORD_HASH =
  'pbkdf2$210000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
