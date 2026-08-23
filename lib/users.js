// ─────────────────────────────────────────────────────────────────────────────
//  Хранилище пользователей. Работает на Edge Runtime (только fetch и Web Crypto).
//
//  Два бэкенда, выбираются автоматически:
//
//  1. Redis (Upstash / Vercel KV) — если заданы KV_REST_API_URL и
//     KV_REST_API_TOKEN. Пользователи добавляются без передеплоя.
//
//  2. Переменная окружения AUTH_USERS — JSON-массив. Никаких внешних
//     сервисов, но каждый новый пользователь требует передеплоя.
//
//  Формат записи в обоих случаях одинаковый:
//    { "username": "anna", "passwordHash": "pbkdf2$...", "disabled": false,
//      "createdAt": "2026-08-23T10:00:00.000Z", "note": "необязательно" }
//
//  В обоих случаях хранится ТОЛЬКО хеш. Пароль восстановить нельзя.
// ─────────────────────────────────────────────────────────────────────────────

const KEY_PREFIX = 'user:';

// ── Redis через REST API ────────────────────────────────────────────────────

export function getRedisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
}

async function redisCommand(config, command) {
  const res = await fetch(config.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(command),
    cache: 'no-store'
  });

  if (!res.ok) {
    throw new Error(`Redis ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const data = await res.json();
  if (data.error) throw new Error(`Redis: ${data.error}`);
  return data.result;
}

// ── Разбор AUTH_USERS ───────────────────────────────────────────────────────

function parseEnvUsers() {
  const raw = process.env.AUTH_USERS;
  if (!raw) return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Молча вернуть пустой список нельзя: опечатка в JSON превратилась бы
    // в «никто не может войти» без единого намёка на причину.
    throw new Error('AUTH_USERS содержит невалидный JSON');
  }

  if (!Array.isArray(parsed)) throw new Error('AUTH_USERS должен быть массивом');
  return parsed;
}

// Совместимость с одиночным пользователем из первой версии.
function legacyUser() {
  const username = process.env.AUTH_USERNAME;
  const passwordHash = process.env.AUTH_PASSWORD_HASH;
  if (!username || !passwordHash) return null;
  return [{ username, passwordHash, disabled: false, note: 'legacy AUTH_USERNAME' }];
}

// ── Публичный интерфейс ─────────────────────────────────────────────────────

export function getStoreKind() {
  if (getRedisConfig()) return 'redis';
  if (process.env.AUTH_USERS) return 'env';
  if (process.env.AUTH_USERNAME && process.env.AUTH_PASSWORD_HASH) return 'legacy';
  return 'none';
}

function normalizeUsername(value) {
  // Приводим к нижнему регистру, чтобы «Anna» и «anna» были одним человеком
  // и нельзя было завести двойника отличающегося только регистром.
  return String(value ?? '').trim().toLowerCase();
}

export async function getUserRecord(username) {
  const key = normalizeUsername(username);
  if (!key) return null;

  const redis = getRedisConfig();
  if (redis) {
    const raw = await redisCommand(redis, ['GET', KEY_PREFIX + key]);
    if (!raw) return null;
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return null;
    }
  }

  const list = parseEnvUsers() || legacyUser() || [];
  return list.find((user) => normalizeUsername(user?.username) === key) || null;
}

export async function listUsers() {
  const redis = getRedisConfig();

  if (redis) {
    const users = [];
    let cursor = '0';
    do {
      const [next, keys] = await redisCommand(redis, [
        'SCAN', cursor, 'MATCH', `${KEY_PREFIX}*`, 'COUNT', '200'
      ]);
      cursor = next;

      if (keys.length) {
        const values = await redisCommand(redis, ['MGET', ...keys]);
        for (const value of values) {
          if (!value) continue;
          try {
            users.push(typeof value === 'string' ? JSON.parse(value) : value);
          } catch { /* битая запись — пропускаем */ }
        }
      }
    } while (cursor !== '0');

    return users.sort((a, b) => String(a.username).localeCompare(String(b.username), 'ru'));
  }

  return (parseEnvUsers() || legacyUser() || [])
    .slice()
    .sort((a, b) => String(a.username).localeCompare(String(b.username), 'ru'));
}

export async function saveUserRecord(record) {
  const redis = getRedisConfig();
  if (!redis) throw new Error('Запись возможна только в режиме Redis');

  const key = normalizeUsername(record.username);
  await redisCommand(redis, ['SET', KEY_PREFIX + key, JSON.stringify({ ...record, username: key })]);
}

export async function deleteUserRecord(username) {
  const redis = getRedisConfig();
  if (!redis) throw new Error('Удаление возможно только в режиме Redis');

  const removed = await redisCommand(redis, ['DEL', KEY_PREFIX + normalizeUsername(username)]);
  return removed > 0;
}

export { normalizeUsername };
