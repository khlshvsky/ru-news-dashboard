// ─────────────────────────────────────────────────────────────────────────────
//  Edge Middleware — единственный вход в приложение.
//
//  Перехватывает ВСЁ, включая статику и /api/news. Это важно: если бы проверка
//  жила только во фронтенде, любой мог бы дёрнуть /api/news напрямую и получить
//  ленту без пароля.
//
//  Открыты без сессии только страница логина и её эндпоинты.
// ─────────────────────────────────────────────────────────────────────────────

import { COOKIE_NAME, readCookie, verifySessionToken, getAuthConfig } from './lib/auth.js';

export const config = {
  matcher: [
    // Всё, кроме внутренних путей Vercel, страницы логина и её ассетов.
    '/((?!_next|_vercel|favicon\\.ico|login\\.html|login\\.css|api/login|api/logout).*)'
  ]
};

export default async function middleware(request) {
  const { secret, configured, missing } = getAuthConfig();

  // Без настроенных переменных не пускаем никого. Открытый дашборд «пока
  // не настроил» — это ровно та ситуация, ради которой всё и затевалось.
  if (!configured) {
    return new Response(
      `Аутентификация не настроена. Задай переменные окружения: ${missing.join(', ')}\n` +
      `Сгенерировать значения: node tools/hash-password.mjs\n`,
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    );
  }

  const token = readCookie(request.headers.get('cookie'), COOKIE_NAME);
  const session = token ? await verifySessionToken(token, secret) : null;

  if (session) return;   // пропускаем дальше

  const url = new URL(request.url);

  // API отвечает кодом, а не редиректом: фронтенду нужен разбираемый ответ,
  // а не HTML страницы логина внутри fetch.
  if (url.pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  const loginUrl = new URL('/login.html', request.url);
  if (url.pathname !== '/') loginUrl.searchParams.set('next', url.pathname + url.search);

  return Response.redirect(loginUrl, 302);
}
