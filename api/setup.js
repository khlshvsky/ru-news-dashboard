// ─────────────────────────────────────────────────────────────────────────────
//  /api/setup — создание первого администратора из браузера.
//
//  Работает ровно один раз. Два независимых условия:
//    1. В базе НЕТ ни одного пользователя. Как только появился первый —
//       эндпоинт мёртв навсегда, даже с правильным токеном.
//    2. Совпал AUTH_SETUP_TOKEN из переменных окружения. Без этого любой,
//       кто откроет свежий деплой раньше тебя, стал бы администратором.
//
//  Дальше пользователи заводятся через /admin.html.
// ─────────────────────────────────────────────────────────────────────────────

import { derivePasswordHash, formatPasswordHash } from '../lib/auth.js';
import { listUsers, saveUserRecord, normalizeUsername, getStoreKind } from '../lib/users.js';

export const config = { runtime: 'edge' };

const ITERATIONS = 210000;
const MIN_PASSWORD_LENGTH = 12;
const USERNAME_RE = /^[a-z0-9._-]{2,32}$/;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

// Сравнение за постоянное время — чтобы токен нельзя было подобрать
// посимвольно, замеряя задержку ответа.
function timingSafeEqualString(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(String(a));
  const y = enc.encode(String(b));
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x[i] ^ y[i];
  return diff === 0;
}

// GET — чего не хватает. Нужен, чтобы страница показала понятный статус,
// а не гоняла человека вслепую.
async function status() {
  const storeKind = getStoreKind();
  const hasSecret = Boolean(process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 32);
  const hasSetupToken = Boolean(process.env.AUTH_SETUP_TOKEN && process.env.AUTH_SETUP_TOKEN.length >= 16);

  let userCount = null;
  let storeError = null;
  if (storeKind === 'redis') {
    try {
      userCount = (await listUsers()).length;
    } catch (error) {
      storeError = error.message;
    }
  }

  return {
    storeKind,
    hasSecret,
    hasSetupToken,
    userCount,
    storeError,
    ready: storeKind === 'redis' && hasSecret && hasSetupToken && userCount === 0,
    done: userCount !== null && userCount > 0
  };
}

export default async function handler(request) {
  if (request.method === 'GET') return json(await status());
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  if (getStoreKind() !== 'redis') {
    return json({ error: 'no_store', message: 'Не подключено хранилище: нет KV_REST_API_URL и KV_REST_API_TOKEN.' }, 503);
  }

  const setupToken = process.env.AUTH_SETUP_TOKEN;
  if (!setupToken || setupToken.length < 16) {
    return json({ error: 'no_setup_token', message: 'Не задана переменная AUTH_SETUP_TOKEN (минимум 16 символов).' }, 503);
  }

  if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32) {
    return json({ error: 'no_secret', message: 'Не задана переменная AUTH_SECRET (минимум 32 символа).' }, 503);
  }

  let existing;
  try {
    existing = await listUsers();
  } catch (error) {
    return json({ error: 'store_unavailable', message: `Хранилище недоступно: ${error.message}` }, 503);
  }

  if (existing.length > 0) {
    return json({
      error: 'already_done',
      message: 'Пользователи уже есть — первичная настройка закрыта. Управление через /admin.html.'
    }, 410);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  if (!timingSafeEqualString(body?.setupToken ?? '', setupToken)) {
    return json({ error: 'bad_token', message: 'Код настройки не совпал.' }, 403);
  }

  const username = normalizeUsername(body?.username);
  if (!USERNAME_RE.test(username)) {
    return json({ error: 'bad_username', message: 'Логин: 2–32 символа, латиница, цифры, точка, дефис, подчёркивание.' }, 400);
  }

  const password = String(body?.password ?? '');
  if (password.length < MIN_PASSWORD_LENGTH) {
    return json({ error: 'weak_password', message: `Пароль минимум ${MIN_PASSWORD_LENGTH} символов.` }, 400);
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const passwordHash = formatPasswordHash(ITERATIONS, salt, await derivePasswordHash(password, salt, ITERATIONS));

  await saveUserRecord({
    username,
    passwordHash,
    disabled: false,
    isAdmin: true,
    createdAt: new Date().toISOString(),
    note: 'первый администратор'
  });

  return json({ ok: true, username }, 201);
}
