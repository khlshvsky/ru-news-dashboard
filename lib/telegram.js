import { collectNews } from './fetch-news.js';
import { getRedisConfig, redisCommand } from './users.js';

const SENT_KEY = 'telegram:sent';
const INITIALIZED_KEY = 'telegram:initialized';
const LOCK_KEY = 'telegram:publish-lock';

function envInt(name, fallback, min, max) {
  const value = Number.parseInt(process.env[name] || '', 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

function envBoolean(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function escapeTelegramHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatTelegramMessage(item) {
  const rawTitle = String(item?.title || '').trim();
  const title = rawTitle.length > 3500 ? `${rawTitle.slice(0, 3499)}…` : rawTitle;
  const source = String(item?.source || 'Источник').trim();
  const url = String(item?.url || '').trim();
  return `${escapeTelegramHtml(title)} — <a href="${escapeTelegramHtml(url)}">${escapeTelegramHtml(source)}</a>`;
}

function telegramConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const channelId = process.env.TELEGRAM_CHANNEL_ID;
  const missing = [];
  if (!token) missing.push('TELEGRAM_BOT_TOKEN');
  if (!channelId) missing.push('TELEGRAM_CHANNEL_ID');
  if (!getRedisConfig()) missing.push('KV_REST_API_URL + KV_REST_API_TOKEN');
  if (missing.length) throw new Error(`Не настроено: ${missing.join(', ')}`);
  return { token, channelId };
}

async function sendTelegramMessage(config, item, retry = true) {
  const response = await fetch(`https://api.telegram.org/bot${config.token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: config.channelId,
      text: formatTelegramMessage(item),
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true }
    }),
    cache: 'no-store'
  });

  const payload = await response.json().catch(() => ({}));
  if (response.ok && payload.ok) return payload.result;

  const retryAfter = Number(payload?.parameters?.retry_after || 0);
  if (retry && response.status === 429 && retryAfter > 0 && retryAfter <= 30) {
    await sleep((retryAfter + 1) * 1000);
    return sendTelegramMessage(config, item, false);
  }

  throw new Error(`Telegram ${response.status}: ${payload?.description || 'неизвестная ошибка'}`);
}

function selectedSourceIds() {
  return new Set(String(process.env.TELEGRAM_SOURCE_IDS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean));
}

function itemScore(item) {
  const parsed = new Date(item.publishedAt || 0).getTime();
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Date.now();
}

async function rememberItems(redis, items) {
  if (!items.length) return;
  const command = ['ZADD', SENT_KEY];
  for (const item of items) command.push(String(itemScore(item)), item.url);
  await redisCommand(redis, command);
}

async function releaseLock(redis, token) {
  const script = 'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end';
  await redisCommand(redis, ['EVAL', script, '1', LOCK_KEY, token]);
}

export async function publishTelegramNews() {
  const telegram = telegramConfig();
  const redis = getRedisConfig();
  const lockToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const locked = await redisCommand(redis, ['SET', LOCK_KEY, lockToken, 'NX', 'EX', '240']);
  if (locked !== 'OK') return { status: 'locked', sent: 0 };

  try {
    const maxPerRun = envInt('TELEGRAM_MAX_PER_RUN', 5, 1, 20);
    const maxAgeMinutes = envInt('TELEGRAM_MAX_AGE_MINUTES', 20, 5, 1440);
    const sourceIds = selectedSourceIds();
    const payload = await collectNews({ limit: 300 });
    const freshCutoff = Date.now() - maxAgeMinutes * 60 * 1000;
    const items = payload.items
      .filter((item) => item?.title && item?.url && item?.source)
      .filter((item) => sourceIds.size === 0 || sourceIds.has(String(item.sourceId || '').toLowerCase()))
      // После простоя не разгребаем многочасовую очередь: в Telegram попадают
      // только действительно свежие материалы. Внутри окна сохраняем порядок
      // от старых к новым, чтобы несколько новостей не пришли задом наперёд.
      .filter((item) => itemScore(item) >= freshCutoff)
      .sort((a, b) => itemScore(a) - itemScore(b));

    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    await redisCommand(redis, ['ZREMRANGEBYSCORE', SENT_KEY, '-inf', String(cutoff)]);

    const initialized = await redisCommand(redis, ['GET', INITIALIZED_KEY]);
    if (!initialized && !envBoolean('TELEGRAM_BOOTSTRAP_SEND', false)) {
      await rememberItems(redis, items);
      await redisCommand(redis, ['SET', INITIALIZED_KEY, new Date().toISOString()]);
      return { status: 'initialized', sent: 0, remembered: items.length };
    }

    const scores = items.length
      ? await redisCommand(redis, ['ZMSCORE', SENT_KEY, ...items.map((item) => item.url)])
      : [];
    const allUnsent = items.filter((_, index) => scores?.[index] == null);
    const unsent = allUnsent.slice(0, maxPerRun);
    const sent = [];

    for (const item of unsent) {
      // Резервируем URL до отправки. При ошибке снимаем резерв, чтобы следующая
      // попытка могла повторить публикацию.
      await redisCommand(redis, ['ZADD', SENT_KEY, String(itemScore(item)), item.url]);
      try {
        const message = await sendTelegramMessage(telegram, item);
        sent.push({ url: item.url, messageId: message.message_id });
      } catch (error) {
        await redisCommand(redis, ['ZREM', SENT_KEY, item.url]);
        throw error;
      }
      if (sent.length < unsent.length) await sleep(1100);
    }

    if (!initialized) await redisCommand(redis, ['SET', INITIALIZED_KEY, new Date().toISOString()]);
    return {
      status: 'ok',
      sent: sent.length,
      remaining: Math.max(0, allUnsent.length - sent.length),
      maxAgeMinutes,
      messages: sent
    };
  } finally {
    await releaseLock(redis, lockToken).catch(() => {});
  }
}
