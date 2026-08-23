import { collectNews } from '../lib/fetch-news.js';

const CACHE_TTL_MS = Number(process.env.API_CACHE_TTL_MS || 5 * 60 * 1000);
const memoryCache = new Map();
const MAX_CACHE_KEYS = 25;

function getQueryValue(value, fallback = undefined) {
  if (Array.isArray(value)) return value[0] ?? fallback;
  return value ?? fallback;
}

function asBoolean(value) {
  const normalized = String(getQueryValue(value, '')).toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function makeCacheKey(req) {
  const limit = getQueryValue(req.query?.limit, 'default');
  const source = String(getQueryValue(req.query?.source, 'all')).toLowerCase();
  return `limit:${limit}|source:${source}`;
}

function setCache(key, payload) {
  if (memoryCache.size >= MAX_CACHE_KEYS && !memoryCache.has(key)) {
    const oldestKey = memoryCache.keys().next().value;
    if (oldestKey) memoryCache.delete(oldestKey);
  }

  memoryCache.set(key, {
    createdAt: Date.now(),
    payload
  });
}

function getFreshCache(key) {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > CACHE_TTL_MS) return null;
  return entry.payload;
}

function getAnyCache(key) {
  return memoryCache.get(key)?.payload || null;
}

function sendJson(res, statusCode, payload, cacheHeader = 'no-store') {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cacheHeader);
  res.end(JSON.stringify(payload));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' }, 'no-store');
    return;
  }

  const force = asBoolean(req.query?.force);
  const debug = asBoolean(req.query?.debug);
  const cacheKey = makeCacheKey(req);

  if (!force && !debug) {
    const cachedPayload = getFreshCache(cacheKey);
    if (cachedPayload) {
      sendJson(res, 200, {
        ...cachedPayload,
        meta: {
          ...cachedPayload.meta,
          cache: 'memory-hit',
          cacheKey
        }
      });
      return;
    }
  }

  try {
    const payload = await collectNews({
      limit: getQueryValue(req.query?.limit),
      source: getQueryValue(req.query?.source),
      debug
    });

    if (!debug) setCache(cacheKey, payload);

    sendJson(res, 200, {
      ...payload,
      meta: {
        ...payload.meta,
        cache: force ? 'fresh-forced' : 'fresh',
        cacheKey
      }
    }, force || debug ? 'no-store' : undefined);
  } catch (error) {
    const stalePayload = getAnyCache(cacheKey);
    if (stalePayload && !debug) {
      sendJson(res, 200, {
        ...stalePayload,
        meta: {
          ...stalePayload.meta,
          cache: 'stale-on-error',
          cacheKey,
          error: error.message
        }
      });
      return;
    }

    sendJson(res, 500, {
      items: [],
      meta: {
        generatedAt: new Date().toISOString(),
        cacheKey,
        error: error.message
      }
    }, 'no-store');
  }
}
