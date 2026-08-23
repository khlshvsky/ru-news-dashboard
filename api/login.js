// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/login  { username, password } → ставит сессионную куку
// ─────────────────────────────────────────────────────────────────────────────

import {
  verifyPassword,
  createSessionToken,
  buildSessionCookie,
  getAuthConfig,
  DUMMY_PASSWORD_HASH,
  SESSION_TTL_SECONDS
} from '../lib/auth.js';
import { getUserRecord, normalizeUsername } from '../lib/users.js';

export const config = { runtime: 'edge' };

// Троттлинг попыток. Память у каждого инстанса своя, и Vercel поднимает их
// сколько нужно, поэтому это замедляет перебор, но не отменяет его. Настоящий
// лимит требует общего хранилища — см. README.
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
  if (attempts.size > 5000) attempts.clear();

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

  const { secret, configured } = getAuthConfig();
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

  const username = normalizeUsername(body?.username);
  const password = String(body?.password ?? '');

  let user = null;
  try {
    user = await getUserRecord(username);
  } catch (error) {
    // Хранилище недоступно или AUTH_USERS сломан. Пускать в этом случае
    // нельзя, но и притворяться «неверным паролем» не стоит — иначе будешь
    // час гадать, почему правильный пароль перестал подходить.
    return json({ error: 'store_unavailable', detail: error.message }, 503);
  }

  // Хеш прогоняем всегда, даже когда пользователя нет: без этого разница
  // во времени ответа выдаёт, какие логины существуют.
  const passwordOk = await verifyPassword(password, user?.passwordHash || DUMMY_PASSWORD_HASH);

  if (!user || user.disabled === true || !passwordOk) {
    return json({ error: 'invalid_credentials' }, 401);
  }

  const token = await createSessionToken(user.username, secret);

  return json({ ok: true, username: user.username }, 200, {
    'Set-Cookie': buildSessionCookie(token, SESSION_TTL_SECONDS)
  });
}
