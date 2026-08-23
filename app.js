const API_URL = '/api/news';
const AUTO_REFRESH_MS = 10 * 60 * 1000;
const USE_MOCK_DATA = new URLSearchParams(window.location.search).has('mock');

const fallbackNews = [
  {
    title: 'Пример заголовка для проверки вёрстки ленты',
    source: 'Медуза',
    category: 'general',
    publishedAt: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
    url: 'https://meduza.io/'
  },
  {
    title: 'Второй пример заголовка — проверка сортировки по времени',
    source: 'Медиазона',
    category: 'rights',
    publishedAt: new Date(Date.now() - 36 * 60 * 1000).toISOString(),
    url: 'https://zona.media/'
  }
];

let allNews = [];
let prevNewsUrls = new Set();   // urls из предыдущей загрузки
const readUrls = new Set();     // прочитанные статьи


let isLoading = false;

const elements = {
  feedList: document.querySelector('#feedList'),
  template: document.querySelector('#newsItemTemplate'),
  searchInput: document.querySelector('#searchInput'),
  categoryFilter: document.querySelector('#categoryFilter'),
  sourceFilter: document.querySelector('#sourceFilter'),
  timeFilter: document.querySelector('#timeFilter'),
  refreshBtn: document.querySelector('#refreshBtn'),
  totalCount: document.querySelector('#totalCount'),
  sourceCount: document.querySelector('#sourceCount'),
  visibleCount: document.querySelector('#visibleCount'),
  emptyState: document.querySelector('#emptyState'),
  newsBadge: document.querySelector('#newsBadge'),
  backToTop: document.querySelector('#backToTop'),
  logoutBtn: document.querySelector('#logoutBtn'),
  currentUser: document.querySelector('#currentUser'),
  adminLink: document.querySelector('#adminLink'),
  statusDot: document.querySelector('#statusDot'),
  statusLabel: document.querySelector('#statusLabel'),
  lastUpdated: document.querySelector('#lastUpdated')
};

function normalizeItem(item) {
  return {
    title: String(item?.title || '').trim(),
    source: String(item?.source || 'Unknown').trim(),
    category: String(item?.category || 'general').trim(),
    publishedAt: item?.publishedAt || item?.date || item?.pubDate || null,
    url: String(item?.url || item?.link || '').trim()
  };
}

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function sanitizeItems(items) {
  return items
    .map(normalizeItem)
    .filter((item) => item.title.length >= 8 && isValidHttpUrl(item.url));
}

function sortByDateDesc(items) {
  return [...items].sort((a, b) => {
    const aTime = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const bTime = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return bTime - aTime;
  });
}

function buildApiUrl({ force = false } = {}) {
  const url = new URL(API_URL, window.location.origin);
  if (force) url.searchParams.set('force', '1');
  url.searchParams.set('_', String(Date.now()));
  return url.toString();
}

async function loadNews(options = {}) {
  if (isLoading) return;
  isLoading = true;
  elements.refreshBtn.disabled = true;
  elements.refreshBtn.textContent = 'Обновляю…';
  setStatus('loading', 'Обновляю');

  try {
    const response = await fetch(buildApiUrl(options), { cache: 'no-store' });

    // Сессия истекла или куку сбросили — уводим на логин, сохранив,
    // куда человек хотел попасть.
    if (response.status === 401) {
      const next = encodeURIComponent(location.pathname + location.search);
      location.href = `/login.html?next=${next}`;
      return;
    }

    if (!response.ok) throw new Error(`API returned ${response.status}`);

    const payload = await response.json();
    const items = Array.isArray(payload) ? payload : payload.items;
    if (!Array.isArray(items)) throw new Error('Invalid API payload');

    const newItems = sortByDateDesc(sanitizeItems(items));
    const isFirstLoad = allNews.length === 0;
    if (!isFirstLoad && prevNewsUrls.size > 0) {
      const newCount = newItems.filter(i => !prevNewsUrls.has(i.url)).length;
      if (newCount > 0) {
        elements.newsBadge.textContent = `+${newCount}`;
        elements.newsBadge.hidden = false;
      }
    }
    prevNewsUrls = new Set(newItems.map(i => i.url));
    allNews = newItems;
    if (allNews.length === 0) {
      setStatus('ok', 'Свежих новостей нет');
    } else {
      setStatus('ok', 'Лента актуальна');
    }
  } catch (error) {
    console.error('News API error:', error);

    if (USE_MOCK_DATA) {
      allNews = sortByDateDesc(sanitizeItems(fallbackNews));
      setStatus('error', 'Тестовые данные');
    } else {
      allNews = [];
      setStatus('error', 'Ошибка загрузки');
      setEmptyState('Не удалось загрузить новости', 'Проверьте /api/health, /api/news и логи Vercel. Тестовые заголовки в проде больше не показываются.');
    }
  } finally {
    updateSourceFilter();
    renderFeed();
    isLoading = false;
    elements.refreshBtn.disabled = false;
    elements.refreshBtn.textContent = 'Обновить';
  }
}

function setStatus(type, label) {
  elements.statusDot.className = 'status-dot';
  if (type === 'ok') elements.statusDot.classList.add('is-ok');
  if (type === 'error') elements.statusDot.classList.add('is-error');

  elements.statusLabel.textContent = label;
  elements.lastUpdated.textContent = `обновлено в ${formatClock(new Date())}`;
}

function setEmptyState(title, text) {
  const titleNode = elements.emptyState.querySelector('strong');
  const textNode = elements.emptyState.querySelector('p');
  if (titleNode) titleNode.textContent = title;
  if (textNode) textNode.textContent = text;
}

function updateSourceFilter() {
  const selected = elements.sourceFilter.value;
  const sources = [...new Set(allNews.map((item) => item.source))].sort((a, b) => a.localeCompare(b, 'ru'));

  elements.sourceFilter.innerHTML = '<option value="all">Все источники</option>';
  for (const source of sources) {
    const option = document.createElement('option');
    option.value = source;
    option.textContent = source;
    elements.sourceFilter.append(option);
  }

  elements.sourceFilter.value = sources.includes(selected) ? selected : 'all';
}

// Поиск должен находить «ёлка» по запросу «елка» и наоборот.
function foldRu(value) {
  return String(value).toLowerCase().replace(/ё/g, 'е');
}

function getFilteredNews() {
  const query = foldRu(elements.searchInput.value.trim());
  const source = elements.sourceFilter.value;
  const category = elements.categoryFilter.value;
  const hours = elements.timeFilter.value;
  const now = Date.now();

  return allNews.filter((item) => {
    const matchesQuery = !query || foldRu(`${item.title} ${item.source}`).includes(query);
    const matchesSource = source === 'all' || item.source === source;
    const matchesCategory = category === 'all' || item.category === category;
    const itemTime = item.publishedAt ? new Date(item.publishedAt).getTime() : NaN;
    const matchesTime = hours === 'all' || (!Number.isNaN(itemTime) && now - itemTime <= Number(hours) * 60 * 60 * 1000);
    return matchesQuery && matchesSource && matchesCategory && matchesTime;
  });
}

function getVisibleItems() {
  const headlines = elements.feedList.querySelectorAll('.headline');
  const visible = [];
  const vBottom = window.innerHeight + window.scrollY + 200; // +200px запас
  headlines.forEach(el => {
    if (el.getBoundingClientRect().top + window.scrollY < vBottom) {
      const url = el.href;
      const item = getFilteredNews().find(i => i.url === url);
      if (item) visible.push(item);
    }
  });
  return visible;
}






// Дублирует CATEGORIES из lib/sources.js — фронтенд не импортирует серверный
// модуль, поэтому при добавлении категории правь оба места.
const CATEGORY_LABELS = {
  general: 'Новости',
  investigations: 'Расследование',
  rights: 'Права человека',
  economy: 'Экономика',
  regional: 'Регионы',
  broadcaster: 'Вещатель'
};

function renderFeed() {
  const filteredNews = getFilteredNews();
  elements.feedList.innerHTML = '';

  for (const item of filteredNews) {
    const node = elements.template.content.cloneNode(true);
    const article = node.querySelector('.news-item');
    const source = node.querySelector('.source');
    const time = node.querySelector('time');
    const headline = node.querySelector('.headline');

    source.textContent = item.source;
    if (item.category && CATEGORY_LABELS[item.category]) {
      const badge = document.createElement('span');
      badge.className = `cat-badge cat-${item.category}`;
      badge.textContent = CATEGORY_LABELS[item.category];
      source.appendChild(badge);
    }
    time.textContent = formatDateTime(item.publishedAt);
    if (item.publishedAt) {
      time.dateTime = item.publishedAt;
    } else {
      time.removeAttribute('datetime');
    }

    headline.textContent = item.title;
    headline.href = item.url;
    headline.setAttribute('aria-label', `${item.title}. Источник: ${item.source}`);

    article.dataset.source = item.source;
    if (readUrls.has(item.url)) article.classList.add('read');
    headline.addEventListener('click', () => {
      readUrls.add(item.url);
      article.classList.add('read');
    });
    elements.feedList.append(node);
  }

  const uniqueSources = new Set(allNews.map((item) => item.source));
  elements.totalCount.textContent = allNews.length;
  elements.sourceCount.textContent = uniqueSources.size;
  elements.visibleCount.textContent = `${filteredNews.length} показано`;

  if (allNews.length === 0) {
    setEmptyState('Свежих новостей нет', 'Backend не нашёл материалов за выбранный период или API недоступен.');
  } else {
    setEmptyState('Ничего не найдено', 'Попробуйте убрать фильтры или изменить поисковый запрос.');
  }

  elements.emptyState.hidden = filteredNews.length > 0;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Дата неизвестна';

  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Belgrade'  // поменяй, если смотришь ленту из другого пояса
  }).format(date);
}

// В шапке нужна только время последнего обновления — полная дата там
// раздувала карточку на три строки.
function formatClock(date) {
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Belgrade'
  }).format(date);
}

function debounce(fn, delay = 180) {
  let timerId;
  return (...args) => {
    clearTimeout(timerId);
    timerId = setTimeout(() => fn(...args), delay);
  };
}

elements.searchInput.addEventListener('input', debounce(renderFeed));
elements.sourceFilter.addEventListener('change', renderFeed);
elements.timeFilter.addEventListener('change', renderFeed);
elements.refreshBtn.addEventListener('click', () => {
  elements.newsBadge.hidden = true;
  loadNews({ force: true });
});
elements.categoryFilter.addEventListener('change', renderFeed);

// ── Scroll: переводы + кнопка наверх ────────────────────────────────────────
let scrollTimer;
window.addEventListener('scroll', () => {
  // Кнопка наверх
  elements.backToTop.hidden = window.scrollY < 400;
}, { passive: true });
elements.backToTop.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

elements.logoutBtn.addEventListener('click', async () => {
  elements.logoutBtn.disabled = true;
  try {
    await fetch('/api/logout', { method: 'POST' });
  } finally {
    location.href = '/login.html';
  }
});

// Кто вошёл — показываем в шапке. Не критично, поэтому ошибки глушим.
fetch('/api/me')
  .then((res) => (res.ok ? res.json() : null))
  .then((data) => {
    if (data?.username) elements.currentUser.textContent = data.username;
    if (data?.isAdmin) elements.adminLink.hidden = false;
  })
  .catch(() => {});

loadNews();
setInterval(loadNews, AUTO_REFRESH_MS);
