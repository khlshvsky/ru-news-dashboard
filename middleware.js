// ─────────────────────────────────────────────────────────────────────────────
//  Edge Middleware — единственный вход в приложение.
//
//  Перехватывает ВСЁ, включая статику и /api/news. Это важно: если бы проверка
//  жила только во фронтенде, любой мог бы дёрнуть /api/news напрямую и получить
//  ленту без пароля.
//
//  Открыты без сессии только страница логина и её эндпоинты.
// ─────────────────────────────────────────────────────────────────────────────

import { COOKIE_NAME, readCookie, verifySessionToken, getAuthConfig, buildClearCookie } from './lib/auth.js';
import { getUserRecord } from './lib/users.js';

// Кука самодостаточна: подпись проверяется без обращения к базе, поэтому
// middleware не добавляет задержки к каждому запросу. Обратная сторона — если
// удалить пользователя, его текущая сессия доживёт до истечения срока.
//
// AUTH_STRICT_SESSION=true меняет размен: каждый запрос сверяется с базой,
// удаление действует мгновенно, но к любому запросу добавляется поход в Redis.
const STRICT_SESSION = process.env.AUTH_STRICT_SESSION === 'true';

export const config = {
  matcher: [
    // Всё, кроме внутренних путей Vercel, страницы логина и её ассетов.
    '/((?!_next|_vercel|favicon\\.ico|login\\.html|setup\\.html|api/login|api/logout|api/setup|api/telegram-publish).*)'
  ]
};

function url0(request) {
  return new URL(request.url);
}

export default async function middleware(request) {
  const { secret, configured, missing } = getAuthConfig();

  // Пока не настроено — не пускаем никого, но вместо голого текста уводим
  // на страницу настройки: она сама покажет, чего не хватает.
  if (!configured) {
    return Response.redirect(new URL('/setup.html', request.url), 302);
  }

  const token = readCookie(request.headers.get('cookie'), COOKIE_NAME);
  const session = token ? await verifySessionToken(token, secret) : null;

  let revoked = false;
  if (session && STRICT_SESSION) {
    try {
      const user = await getUserRecord(session.u);
      revoked = !user || user.disabled === true;
    } catch {
      // База недоступна — не выкидываем уже вошедших. Подпись куки валидна,
      // а падение Redis не должно превращаться в тотальный разлогин.
      revoked = false;
    }
  }

  if (session && !revoked) {
    // Страница админки. Данные всё равно защищены в /api/admin, но пускать
    // обычного пользователя на пустую панель — сбивать с толку.
    if (url0(request).pathname === '/admin.html') {
      try {
        const user = await getUserRecord(session.u);
        if (user?.isAdmin !== true) {
          return new Response('Доступ только для администраторов.', {
            status: 403,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        }
      } catch {
        return new Response('Хранилище пользователей недоступно.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }
    }
    return;   // пропускаем дальше
  }

  const url = new URL(request.url);

  // API отвечает кодом, а не редиректом: фронтенду нужен разбираемый ответ,
  // а не HTML страницы логина внутри fetch.
  // Отозванную куку сразу гасим, чтобы браузер не слал её снова и снова.
  const clearHeaders = revoked ? { 'Set-Cookie': buildClearCookie() } : {};

  if (url.pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...clearHeaders }
    });
  }

  const loginUrl = new URL('/login.html', request.url);
  if (url.pathname !== '/') loginUrl.searchParams.set('next', url.pathname + url.search);

  return new Response(null, {
    status: 302,
    headers: { Location: loginUrl.toString(), ...clearHeaders }
  });
}
