// GET /api/me → кто вошёл. Нужен только чтобы показать логин в шапке.
// Сюда запрос доходит уже после middleware, то есть кука точно валидна.

import { COOKIE_NAME, readCookie, verifySessionToken, getAuthConfig } from '../lib/auth.js';
import { getUserRecord, getStoreKind } from '../lib/users.js';

export const config = { runtime: 'edge' };

export default async function handler(request) {
  const { secret } = getAuthConfig();
  const token = readCookie(request.headers.get('cookie'), COOKIE_NAME);
  const session = token && secret ? await verifySessionToken(token, secret) : null;

  // Права смотрим в базе, а не в куке: если человека разжаловали час назад,
  // ссылка на админку не должна остаться у него до истечения сессии.
  let isAdmin = false;
  if (session && getStoreKind() === 'redis') {
    try {
      isAdmin = (await getUserRecord(session.u))?.isAdmin === true;
    } catch { /* база недоступна — просто не показываем ссылку */ }
  }

  return new Response(JSON.stringify({ username: session?.u || null, isAdmin }), {
    status: session ? 200 : 401,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
