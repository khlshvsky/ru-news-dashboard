// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/login  { username, password } → ставит сессионную куку
// ─────────────────────────────────────────────────────────────────────────────

import {
  verifyPassword,
  createSessionToken,
  buildSessionCookie,
  getAuthConfig,
  SESSION_TTL_SECONDS
} from '../lib/auth.js';

export const config = { runtime: 'edge' };

// Троттлинг попыток. Память у каждого инстанса своя, и Vercel поднимает их
// сколько нужно, поэтому это замедляет перебор, но не отменяет его. Настоящий
// лимит требует внешнего хранилища (Upstash/KV) — см. README.
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function throttle(key) {
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry || now - entry.start > WINDOW_MS) {
    attempts.set(key, { start: now, count: 1 });
    return { blocked: false };
  }

  entry.count += 1;
  if (attempts.size > 5000) attempts.clear();   // грубая защита от роста памяти

  if (entry.count > MAX_ATTEMPTS) {
    return { blocked: true, retryAfter: Math.ceil((entry.start + WINDOW_MS - now) / 1000) };
  }
  return { blocked: false };
}

function json(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders }
  });
}

export default async function handler(request) {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const { username, passwordHash, secret, configured } = getAuthConfig();
  if (!configured) return json({ error: 'not_configured' }, 503);

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const limit = throttle(ip);
  if (limit.blocked) {
    return json({ error: 'too_many_attempts', retryAfter: limit.retryAfter }, 429, {
      'Retry-After': String(limit.retryAfter)
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  const providedUser = String(body?.username ?? '');
  const providedPass = String(body?.password ?? '');

  // Хеш проверяем всегда, даже если логин уже не совпал: иначе по времени
  // ответа можно отличить «такого логина нет» от «пароль неверный».
  const passwordOk = await verifyPassword(providedPass, passwordHash);
  const userOk = providedUser === username;

  if (!userOk || !passwordOk) {
    return json({ error: 'invalid_credentials' }, 401);
  }

  const token = await createSessionToken(username, secret);

  return json({ ok: true }, 200, {
    'Set-Cookie': buildSessionCookie(token, SESSION_TTL_SECONDS)
  });
}
