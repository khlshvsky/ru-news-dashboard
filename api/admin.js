// ─────────────────────────────────────────────────────────────────────────────
//  /api/admin — управление пользователями из браузера.
//
//  GET  → { me, users }
//  POST → { action: create | password | disabled | admin | delete, ... }
//
//  Сюда запрос попадает уже после middleware, то есть человек точно вошёл.
//  Но «вошёл» ≠ «администратор», поэтому права проверяются здесь заново,
//  и не по куке, а по свежей записи из базы: если админа только что разжаловали,
//  он не должен успеть ничего сделать по старой куке.
// ─────────────────────────────────────────────────────────────────────────────

import {
  COOKIE_NAME, readCookie, verifySessionToken, getAuthConfig,
  derivePasswordHash, formatPasswordHash
} from '../lib/auth.js';
import {
  getUserRecord, listUsers, saveUserRecord, deleteUserRecord,
  normalizeUsername, getStoreKind
} from '../lib/users.js';

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

// Наружу отдаём запись без хеша пароля. Хеш стойкий, но светить его в UI,
// откуда он попадёт в логи браузера и историю запросов, незачем.
function publicView(user) {
  return {
    username: user.username,
    disabled: user.disabled === true,
    isAdmin: user.isAdmin === true,
    createdAt: user.createdAt || null,
    note: user.note || null
  };
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePasswordHash(password, salt, ITERATIONS);
  return formatPasswordHash(ITERATIONS, salt, hash);
}

async function resolveActor(request) {
  const { secret } = getAuthConfig();
  const token = readCookie(request.headers.get('cookie'), COOKIE_NAME);
  const session = token && secret ? await verifySessionToken(token, secret) : null;
  if (!session) return null;
  return getUserRecord(session.u);
}

export default async function handler(request) {
  if (getStoreKind() !== 'redis') {
    return json({
      error: 'read_only_store',
      message: 'Панель работает только с Redis. В режиме AUTH_USERS правки идут через CLI и передеплой.'
    }, 501);
  }

  let actor;
  try {
    actor = await resolveActor(request);
  } catch (error) {
    return json({ error: 'store_unavailable', detail: error.message }, 503);
  }

  if (!actor || actor.disabled === true) return json({ error: 'unauthorized' }, 401);
  if (actor.isAdmin !== true) return json({ error: 'forbidden' }, 403);

  if (request.method === 'GET') {
    const users = await listUsers();
    return json({ me: publicView(actor), users: users.map(publicView) });
  }

  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  const action = String(body?.action || '');
  const username = normalizeUsername(body?.username);
  const isSelf = username === normalizeUsername(actor.username);

  // ── Создание ──────────────────────────────────────────────────────────────

  if (action === 'create') {
    if (!USERNAME_RE.test(username)) {
      return json({ error: 'bad_username', message: 'Логин: 2–32 символа, латиница, цифры, точка, дефис, подчёркивание.' }, 400);
    }
    if (await getUserRecord(username)) {
      return json({ error: 'exists', message: `Пользователь «${username}» уже есть.` }, 409);
    }

    const password = String(body?.password ?? '');
    if (password.length < MIN_PASSWORD_LENGTH) {
      return json({ error: 'weak_password', message: `Пароль минимум ${MIN_PASSWORD_LENGTH} символов.` }, 400);
    }

    const record = {
      username,
      passwordHash: await hashPassword(password),
      disabled: false,
      isAdmin: body?.isAdmin === true,
      createdAt: new Date().toISOString(),
      ...(body?.note ? { note: String(body.note).slice(0, 200) } : {})
    };

    await saveUserRecord(record);
    return json({ ok: true, user: publicView(record) }, 201);
  }

  // Дальше все действия — над существующим пользователем.
  const target = await getUserRecord(username);
  if (!target) return json({ error: 'not_found' }, 404);

  // ── Смена пароля ──────────────────────────────────────────────────────────

  if (action === 'password') {
    const password = String(body?.password ?? '');
    if (password.length < MIN_PASSWORD_LENGTH) {
      return json({ error: 'weak_password', message: `Пароль минимум ${MIN_PASSWORD_LENGTH} символов.` }, 400);
    }

    await saveUserRecord({ ...target, passwordHash: await hashPassword(password) });
    return json({ ok: true });
  }

  // ── Блокировка ────────────────────────────────────────────────────────────

  if (action === 'disabled') {
    const disabled = body?.disabled === true;
    // Иначе можно заблокировать самого себя и потерять доступ к панели.
    if (isSelf && disabled) {
      return json({ error: 'self_lockout', message: 'Нельзя заблокировать самого себя.' }, 400);
    }

    await saveUserRecord({ ...target, disabled });
    return json({ ok: true });
  }

  // ── Права администратора ──────────────────────────────────────────────────

  if (action === 'admin') {
    const isAdmin = body?.isAdmin === true;

    if (isSelf && !isAdmin) {
      return json({ error: 'self_demote', message: 'Нельзя снять права с самого себя.' }, 400);
    }

    // Последнего администратора терять нельзя: панель станет недоступна
    // никому, и чинить придётся через CLI.
    if (!isAdmin) {
      const admins = (await listUsers()).filter((u) => u.isAdmin === true && u.disabled !== true);
      if (admins.length <= 1) {
        return json({ error: 'last_admin', message: 'Это последний администратор.' }, 400);
      }
    }

    await saveUserRecord({ ...target, isAdmin });
    return json({ ok: true });
  }

  // ── Удаление ──────────────────────────────────────────────────────────────

  if (action === 'delete') {
    if (isSelf) {
      return json({ error: 'self_delete', message: 'Нельзя удалить самого себя.' }, 400);
    }

    if (target.isAdmin === true) {
      const admins = (await listUsers()).filter((u) => u.isAdmin === true && u.disabled !== true);
      if (admins.length <= 1) {
        return json({ error: 'last_admin', message: 'Это последний администратор.' }, 400);
      }
    }

    await deleteUserRecord(username);
    return json({ ok: true });
  }

  return json({ error: 'unknown_action' }, 400);
}
