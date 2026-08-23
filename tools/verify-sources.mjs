#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
//  verify-sources.mjs — проверка источников ru-news-dashboard
//
//  Что делает:
//    1. Дёргает каждый RSS-фид, смотрит статус и число элементов.
//    2. Дёргает каждую listUrl, вытаскивает ссылки, проверяет articleUrl.
//    3. Если регулярка не поймала ничего — предлагает паттерн по факту.
//
//  Запуск (Node 18+, без зависимостей):
//    npm run verify
//    node tools/verify-sources.mjs
//    npm run verify
//    node tools/verify-sources.mjs --only meduza,holod
//    npm run verify
//    node tools/verify-sources.mjs --rss-only
//
//  Из России часть доменов заблокирована — гоняй через VPN, иначе получишь
//  ложные ERR на живых источниках.
// ─────────────────────────────────────────────────────────────────────────────

import { SOURCES } from '../lib/sources.js';

// Служебные пути: дублирует SERVICE_URL_RE из fetch-news.js в упрощённом виде —
// здесь он нужен только чтобы не предлагать регулярку по мусорным ссылкам.
const SERVICE_URL_RE = /(?:^|\/)(?:about|contacts?|privacy|cookie|terms|subscribe|login|register|search|rss|feed|sitemap|tags?|topics?|authors?|o-nas|kontakty|redakciya|reklama|podderzhat|podpiska|rubrika|tema|teg|avtor|poisk|pravila|arhiv)(?:\/|$|[?#])/i;

const TIMEOUT_MS = 15000;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const args = process.argv.slice(2);
const rssOnly = args.includes('--rss-only');
const htmlOnly = args.includes('--html-only');
const onlyArg = args.find(a => a.startsWith('--only'));
const only = onlyArg
  ? (onlyArg.includes('=') ? onlyArg.split('=')[1] : args[args.indexOf(onlyArg) + 1] || '')
      .split(',').map(s => s.trim()).filter(Boolean)
  : null;

const C = {
  ok:   s => `\x1b[32m${s}\x1b[0m`,
  warn: s => `\x1b[33m${s}\x1b[0m`,
  err:  s => `\x1b[31m${s}\x1b[0m`,
  dim:  s => `\x1b[2m${s}\x1b[0m`,
  b:    s => `\x1b[1m${s}\x1b[0m`
};

async function grab(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: { 'user-agent': UA, 'accept-language': 'ru,en;q=0.8' }
    });
    const body = await res.text();
    return { status: res.status, body, finalUrl: res.url };
  } catch (e) {
    return { status: 0, body: '', error: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally {
    clearTimeout(t);
  }
}

// ── RSS ──────────────────────────────────────────────────────────────────────

function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  for (const b of blocks) {
    const title = (b.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
    let link = (b.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1] || '';
    if (!link.trim()) link = (b.match(/<link[^>]*href=["']([^"']+)["']/i) || [])[1] || '';
    const date = (b.match(/<(pubDate|published|updated|dc:date)[^>]*>([\s\S]*?)<\/\1>/i) || [])[2] || '';
    items.push({
      title: clean(title).slice(0, 90),
      link: clean(link),
      date: clean(date)
    });
  }
  return items;
}

function clean(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function checkRss(id, urls) {
  for (const url of urls) {
    const r = await grab(url);
    if (r.status !== 200) {
      console.log(`   ${C.err('RSS ✗')} ${url} ${C.dim(`(${r.error || 'HTTP ' + r.status})`)}`);
      continue;
    }
    if (!/<(rss|feed|rdf:RDF)\b/i.test(r.body)) {
      console.log(`   ${C.err('RSS ✗')} ${url} ${C.dim('(200, но это не фид — вероятно, редирект на HTML)')}`);
      continue;
    }
    const items = parseFeed(r.body);
    if (!items.length) {
      console.log(`   ${C.warn('RSS ~')} ${url} ${C.dim('(фид валиден, но пуст)')}`);
      continue;
    }
    const withDates = items.filter(i => i.date && !isNaN(Date.parse(i.date))).length;
    console.log(`   ${C.ok('RSS ✓')} ${url} ${C.dim(`— ${items.length} записей, дат: ${withDates}`)}`);
    console.log(`         ${C.dim(items[0].title)}`);
    console.log(`         ${C.dim(items[0].link)}`);
    return true;
  }
  return false;
}

// ── HTML ─────────────────────────────────────────────────────────────────────

function extractLinks(html, base) {
  const out = new Set();
  const re = /<a\b[^>]*href=["']([^"'#]+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const u = new URL(m[1], base);
      u.hash = '';
      if (/^https?:$/.test(u.protocol)) out.add(u.toString());
    } catch { /* мусорный href */ }
  }
  return [...out];
}

// Строит паттерн по фактическим ссылкам: ищет самую частую форму пути.
function suggestPattern(links, homepage) {
  let host;
  try { host = new URL(homepage).host; } catch { return null; }

  const shapes = new Map();
  for (const l of links) {
    let u;
    try { u = new URL(l); } catch { continue; }
    if (u.host !== host) continue;
    if (SERVICE_URL_RE.test(u.pathname)) continue;

    const segs = u.pathname.split('/').filter(Boolean);
    if (!segs.length) continue;

    const shape = segs.map(s => {
      if (/^\d{4}$/.test(s)) return '\\d{4}';
      if (/^\d{2}$/.test(s)) return '\\d{2}';
      if (/^\d+$/.test(s)) return '\\d+';
      if (/^[a-z0-9-]+-\d+$/i.test(s)) return '[a-z0-9-]+-\\d+';
      if (/^[a-z0-9-]+\.html$/i.test(s)) return '[a-z0-9-]+\\.html';
      if (/^[a-z0-9_-]+$/i.test(s)) return '[a-z0-9_-]+';
      return null;
    });
    if (shape.includes(null)) continue;

    const key = shape.join('/');
    if (!shapes.has(key)) shapes.set(key, { count: 0, sample: l });
    shapes.get(key).count++;
  }

  const ranked = [...shapes.entries()]
    .filter(([k]) => k.split('/').length >= 2)   // одноуровневые пути чаще всего рубрики
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 3);

  if (!ranked.length) return null;

  return ranked.map(([shape, info]) => ({
    regex: `/^https:\\/\\/${host.replace(/\./g, '\\\\.')}\\/${shape.replace(/\//g, '\\\\/')}/i`,
    count: info.count,
    sample: info.sample
  }));
}

async function checkHtml(src) {
  let all = [];
  let anyOk = false;

  for (const url of src.listUrls) {
    const r = await grab(url);
    if (r.status !== 200) {
      console.log(`   ${C.err('HTML ✗')} ${url} ${C.dim(`(${r.error || 'HTTP ' + r.status})`)}`);
      continue;
    }
    anyOk = true;
    all = all.concat(extractLinks(r.body, url));
  }

  if (!anyOk) return;

  const uniq = [...new Set(all)];
  const matched = uniq.filter(l => src.articleUrl.test(l) && !SERVICE_URL_RE.test(l));

  if (matched.length >= 5) {
    console.log(`   ${C.ok('HTML ✓')} ${matched.length} ссылок прошли articleUrl ${C.dim(`(из ${uniq.length})`)}`);
    console.log(`         ${C.dim(matched[0])}`);
  } else {
    const verdict = matched.length ? C.warn('HTML ~') : C.err('HTML ✗');
    console.log(`   ${verdict} только ${matched.length} совпадений из ${uniq.length} ссылок`);
    const sug = suggestPattern(uniq, src.homepage);
    if (sug) {
      console.log(`         ${C.b('предложение:')}`);
      for (const s of sug) {
        console.log(`           ${s.regex}  ${C.dim(`(${s.count} шт.)`)}`);
        console.log(`           ${C.dim(s.sample)}`);
      }
    } else {
      console.log(`         ${C.dim('паттерн не выводится — вероятно, список рендерится через JS')}`);
    }
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

const list = only ? SOURCES.filter(s => only.includes(s.id)) : SOURCES;

if (!list.length) {
  console.error('Ни один источник не подошёл под --only');
  process.exit(1);
}

console.log(`\nПроверяю ${list.length} источник(ов)\n${'─'.repeat(70)}`);

const summary = { rssOk: 0, rssNo: 0, checked: 0 };

for (const src of list) {
  console.log(`\n${C.b(src.name)} ${C.dim(`[${src.id}] ${src.category}`)}`);
  summary.checked++;

  const feeds = src.feedUrls;
  let rssWorked = false;

  if (!htmlOnly && feeds && feeds.length) {
    rssWorked = await checkRss(src.id, feeds);
    rssWorked ? summary.rssOk++ : summary.rssNo++;
  } else if (!htmlOnly) {
    console.log(`   ${C.dim('RSS —  не задан, идём по HTML')}`);
  }

  // HTML проверяем всегда, если RSS не сработал: это боевой фолбэк
  if (!rssOnly && !rssWorked) {
    await checkHtml(src);
  }
}

console.log(`\n${'─'.repeat(70)}`);
console.log(`Итого: ${summary.checked} источников, RSS живых ${C.ok(summary.rssOk)}, мёртвых ${C.err(summary.rssNo)}\n`);
