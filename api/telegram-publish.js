import { publishTelegramNews } from '../lib/telegram.js';

export const config = { maxDuration: 60 };

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function safeEqual(left, right) {
  const a = new TextEncoder().encode(String(left || ''));
  const b = new TextEncoder().encode(String(right || ''));
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'method_not_allowed' });
    return;
  }

  const secret = process.env.TELEGRAM_PUBLISH_SECRET || process.env.CRON_SECRET;
  if (!secret || secret.length < 16 || !safeEqual(req.headers.authorization, `Bearer ${secret}`)) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }

  try {
    sendJson(res, 200, await publishTelegramNews());
  } catch (error) {
    console.error('Telegram publish error:', error);
    sendJson(res, 500, { error: 'publish_failed', message: error.message });
  }
}
