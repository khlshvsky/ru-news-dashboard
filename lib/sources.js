// ─────────────────────────────────────────────────────────────────────────────
//  ru-news-dashboard — источники
//  Независимые и эмигрантские русскоязычные СМИ.
//
//  Формат совпадает с eu-news-dashboard: RAW_SOURCES + FEED_URLS + DATE_POLICIES
//  собираются в SOURCES на выходе.
//
//  Регулярки articleUrl размечены комментариями:
//    OK  — проверено, паттерн специфичен
//    ?   — предположение, прогнать tools/verify-sources.mjs
// ─────────────────────────────────────────────────────────────────────────────

const RAW_SOURCES = [
  // ── Крупные общеновостные ──────────────────────────────────────────────────
  {
    id: 'meduza',
    name: 'Медуза',
    category: 'general',
    country: 'Латвия',
    homepage: 'https://meduza.io',
    listUrls: ['https://meduza.io/news'],
    // OK: раздел + дата + слаг
    articleUrl: /^https:\/\/meduza\.io\/(?:news|feature|razbor|cards|slides|shapito|paragraph|brief|episodes)\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+/i
  },
  {
    id: 'novaya-europe',
    name: 'Новая газета Европа',
    category: 'general',
    country: 'Латвия',
    homepage: 'https://novayagazeta.eu',
    listUrls: ['https://novayagazeta.eu/news'],
    // OK: /articles/ и /news/ с датой
    articleUrl: /^https:\/\/novayagazeta\.eu\/(?:articles|news)\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+/i
  },
  {
    id: 'the-insider',
    name: 'The Insider',
    category: 'investigations',
    country: 'Латвия',
    homepage: 'https://theins.ru',
    listUrls: ['https://theins.ru/news'],
    // ?: раздел + числовой id
    articleUrl: /^https:\/\/theins\.(?:ru|press)\/[a-z-]+\/\d{4,}/i
  },
  {
    id: 'tvrain',
    name: 'Телеканал Дождь',
    category: 'general',
    country: 'Нидерланды',
    homepage: 'https://tvrain.tv',
    listUrls: ['https://tvrain.tv/news/'],
    // ?: слаг заканчивается числовым id
    articleUrl: /^https:\/\/tvrain\.tv\/(?:news|articles|teleshow)\/[a-z0-9_-]+-\d{5,}/i
  },
  {
    id: 'agentstvo',
    name: 'Агентство',
    category: 'general',
    country: 'н/д',
    homepage: 'https://www.agents.media',
    listUrls: ['https://www.agents.media/'],
    // ?: WordPress, плоские слаги в корне
    articleUrl: /^https:\/\/www\.agents\.media\/[a-z0-9-]{12,}\/?$/i
  },
  {
    id: 'republic',
    name: 'Republic',
    category: 'general',
    country: 'н/д',
    homepage: 'https://republic.ru',
    listUrls: ['https://republic.ru/'],
    // ?: /posts/NNNNN
    articleUrl: /^https:\/\/republic\.ru\/posts\/\d+/i
  },
  {
    id: 'moscow-times-ru',
    name: 'The Moscow Times',
    category: 'general',
    country: 'Нидерланды',
    homepage: 'https://www.moscowtimes.ru',
    listUrls: ['https://www.moscowtimes.ru/'],
    // ?: дата + слаг + -aNNNNN
    articleUrl: /^https:\/\/www\.moscowtimes\.ru\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+-a\d+/i
  },
  {
    id: 'novaya-gazeta',
    name: 'Новая газета',
    category: 'general',
    country: 'Россия',
    homepage: 'https://novayagazeta.ru',
    jsonFeedUrl: 'https://novayagazeta.ru/api/v1/get/records/chronological?page=0',
    jsonFeedFormat: 'novaya-chronological',
    // Главная страница — пустая JS-оболочка, поэтому HTML-резерва здесь нет.
    listUrls: [],
    // RSS и сайт используют дату и слаг: /articles/YYYY/MM/DD/<slug>
    articleUrl: /^https:\/\/novayagazeta\.ru\/articles\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+/i
  },
  {
    id: 'echo',
    name: 'Эхо',
    category: 'general',
    country: 'Германия',
    homepage: 'https://echofm.online',
    listUrls: ['https://echofm.online/news'],
    // Оперативная лента: /news/<slug>
    articleUrl: /^https:\/\/echofm\.online\/news\/[a-z0-9-]+/i
  },

  // ── Расследования ──────────────────────────────────────────────────────────
  {
    id: 'istories',
    name: 'Важные истории',
    category: 'investigations',
    country: 'Латвия',
    homepage: 'https://istories.media',
    listUrls: ['https://istories.media/news/'],
    // ?: раздел + слаг
    articleUrl: /^https:\/\/istories\.media\/(?:news|stories|investigations|reportages|opinions|interviews)\/[a-z0-9-]{8,}\/?$/i
  },
  {
    id: 'proekt',
    name: 'Проект',
    category: 'investigations',
    country: 'н/д',
    homepage: 'https://www.proekt.media',
    listUrls: ['https://www.proekt.media/'],
    // ?: раздел + слаг
    articleUrl: /^https:\/\/www\.proekt\.media\/(?:investigation|research|narrative|portrait|note|guide|opinion)\/[a-z0-9-]{6,}\/?$/i
  },
  {
    id: 'verstka',
    name: 'Вёрстка',
    category: 'investigations',
    country: 'н/д',
    homepage: 'https://verstka.media',
    listUrls: ['https://verstka.media/category/news', 'https://verstka.media/'],
    // ?: плоские слаги в корне
    articleUrl: /^https:\/\/verstka\.media\/[a-z0-9-]{12,}\/?$/i
  },
  {
    id: 'holod',
    name: 'Холод',
    category: 'investigations',
    country: 'Грузия',
    homepage: 'https://holod.media',
    listUrls: ['https://holod.media/'],
    // ?: WordPress с датой
    articleUrl: /^https:\/\/holod\.media\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+/i
  },
  {
    id: 'cherta',
    name: 'Черта',
    category: 'investigations',
    country: 'н/д',
    homepage: 'https://cherta.media/',
    listUrls: ['https://cherta.media/'],
    // ?: /story/ + слаг
    articleUrl: /^https:\/\/cherta\.media\/(?:story|stories|articles?)\/[a-z0-9-]{6,}\/?$/i
  },
  {
    id: 'mozhem-obyasnit',
    name: 'Можем объяснить',
    category: 'investigations',
    country: 'н/д',
    homepage: 'https://mozhemobyasnit.com',
    listUrls: ['https://mozhemobyasnit.com/'],
    // ?: плоские слаги
    articleUrl: /^https:\/\/mozhemobyasnit\.com\/[a-z0-9-]{12,}\/?$/i
  },

  // ── Суды, право, репрессии ─────────────────────────────────────────────────
  {
    id: 'sota-project',
    name: 'SOTA',
    category: 'rights',
    country: 'н/д',
    homepage: 'https://sotaproject.com',
    jsonFeedUrl: 'https://sotaproject.com/api/v1/tg-news?limit=50&offset=0',
    listUrls: ['https://sotaproject.com/tg-news', 'https://sotaproject.com/news'],
    // Лента содержит как материалы сайта, так и прямые посты Telegram.
    articleUrl: /^(?:https:\/\/sotaproject\.com\/(?:tg-news|news|articles?|post)\/[a-z0-9._-]{4,}|https:\/\/t\.me\/sotaproject\/\d+)/i
  },
  {
    id: 'astra',
    name: 'Astra',
    category: 'rights',
    country: 'н/д',
    homepage: 'https://astra.press',
    listUrls: [
      'https://astra.press/ru/articles/exclusives/',
      'https://astra.press/ru/news/'
    ],
    // ?: /ru/<раздел>/.../<слаг>
    articleUrl: /^https:\/\/astra\.press\/ru\/(?:articles|news)\/(?:[a-z0-9-]+\/)*[a-z0-9-]{6,}\/?$/i
  },
  {
    id: 'port-media',
    name: 'Port',
    category: 'general',
    country: 'н/д',
    homepage: 'https://portmedia.info',
    listUrls: ['https://portmedia.info/news'],
    // ?: /news/<слаг>
    articleUrl: /^https:\/\/portmedia\.info\/(?:news|articles?|stories)\/[a-z0-9._-]{5,}/i
  },

  {
    id: 'mediazona',
    name: 'Медиазона',
    category: 'rights',
    country: 'н/д',
    homepage: 'https://zona.media',
    listUrls: ['https://zona.media/news'],
    // OK: раздел + дата + слаг
    articleUrl: /^https:\/\/zona\.media\/(?:news|article|chronics|photo|online)\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9_-]+/i
  },
  {
    id: 'ovd-info',
    name: 'ОВД-Инфо',
    category: 'rights',
    country: 'н/д',
    homepage: 'https://ovd.news',
    listUrls: ['https://ovd.news/'],
    // ?: раздел + дата + слаг
    articleUrl: /^https:\/\/ovd\.news\/(?:news|express-news|articles|stories)\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+/i
  },
  {
    id: 'sotavision',
    name: 'SOTAvision',
    category: 'rights',
    country: 'н/д',
    homepage: 'https://sotavision.world',
    listUrls: ['https://sotavision.world/'],
    // ?: плоские слаги
    articleUrl: /^https:\/\/sotavision\.world\/[a-z0-9-]{12,}\/?$/i
  },

  // ── Экономика ──────────────────────────────────────────────────────────────
  {
    id: 'the-bell',
    name: 'The Bell',
    category: 'economy',
    country: 'н/д',
    homepage: 'https://thebell.io',
    listUrls: ['https://thebell.io/'],
    // ?: плоские слаги
    articleUrl: /^https:\/\/thebell\.io\/[a-z0-9-]{12,}\/?$/i
  },

  // ── Региональные и локальные ───────────────────────────────────────────────
  {
    id: 'semnasem',
    name: '7x7',
    category: 'regional',
    country: 'н/д',
    homepage: 'https://semnasem.org',
    listUrls: ['https://semnasem.org/'],
    // ?: раздел + дата
    articleUrl: /^https:\/\/semnasem\.org\/(?:articles|news)\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+/i
  },
  {
    id: 'lyudi-baikala',
    name: 'Люди Байкала',
    category: 'regional',
    country: 'н/д',
    homepage: 'https://lyudibaikala.ru',
    listUrls: ['https://lyudibaikala.ru/'],
    articleUrl: /^https:\/\/lyudibaikala\.ru\/[a-z0-9-]{12,}\/?$/i
  },
  {
    id: 'novaya-vkladka',
    name: 'Новая вкладка',
    category: 'regional',
    country: 'н/д',
    homepage: 'https://thenewtab.io',
    listUrls: ['https://thenewtab.io/'],
    articleUrl: /^https:\/\/thenewtab\.io\/[a-z0-9-]{12,}\/?$/i
  },
  {
    id: 'paperpaper',
    name: 'Бумага',
    category: 'regional',
    country: 'н/д',
    homepage: 'https://paperpaper.io',
    listUrls: ['https://paperpaper.io/'],
    articleUrl: /^https:\/\/paperpaper\.io\/[a-z0-9-]{12,}\/?$/i
  },
  {
    id: 'kedr',
    name: 'Кедр.медиа',
    category: 'regional',
    country: 'н/д',
    homepage: 'https://kedr.media',
    listUrls: ['https://kedr.media/'],
    articleUrl: /^https:\/\/kedr\.media\/(?:news|stories|articles|interview|opinion|reportage)\/[a-z0-9-]{6,}\/?$/i
  },
  {
    id: 'govorit-nemoskva',
    name: 'Говорит НеМосква',
    category: 'regional',
    country: 'н/д',
    homepage: 'https://govorit-nemoskva.com',
    listUrls: ['https://govorit-nemoskva.com/'],
    articleUrl: /^https:\/\/govorit-nemoskva\.com\/[a-z0-9-]{12,}\/?$/i
  },

  // ── Международные вещатели на русском ──────────────────────────────────────
  {
    id: 'bbc-russian',
    name: 'BBC News Русская служба',
    category: 'broadcaster',
    country: 'Великобритания',
    homepage: 'https://www.bbc.com/russian',
    listUrls: ['https://www.bbc.com/russian'],
    // OK: /articles/<id> — новый формат; -NNNNN — старый
    articleUrl: /^https:\/\/www\.bbc\.com\/russian\/(?:articles\/[a-z0-9]+|[a-z-]+-\d{6,})/i
  },
  {
    id: 'dw-russian',
    name: 'DW на русском',
    category: 'broadcaster',
    country: 'Германия',
    homepage: 'https://www.dw.com/ru',
    listUrls: ['https://www.dw.com/ru/'],
    // OK: /a-NNNNN
    articleUrl: /^https:\/\/www\.dw\.com\/ru\/.+\/a-\d+/i
  },
  {
    id: 'svoboda',
    name: 'Радио Свобода',
    category: 'broadcaster',
    country: 'Чехия',
    homepage: 'https://www.svoboda.org',
    listUrls: ['https://www.svoboda.org/'],
    // OK: формат Pangea (RFE/RL) — /a/<slug>/<id>.html
    articleUrl: /^https:\/\/www\.svoboda\.org\/a\/[a-z0-9-]+\/\d+\.html/i
  },
  {
    id: 'currenttime',
    name: 'Настоящее Время',
    category: 'broadcaster',
    country: 'Чехия',
    homepage: 'https://www.currenttime.tv',
    listUrls: ['https://www.currenttime.tv/'],
    articleUrl: /^https:\/\/www\.currenttime\.tv\/a\/[a-z0-9-]+\/\d+\.html/i
  },
  {
    id: 'rfi-ru',
    name: 'RFI на русском',
    category: 'broadcaster',
    country: 'Франция',
    homepage: 'https://www.rfi.fr/ru',
    listUrls: ['https://www.rfi.fr/ru/'],
    // ?: /ru/<рубрика>/YYYYMMDD-<слаг>
    articleUrl: /^https:\/\/www\.rfi\.fr\/ru\/[^/]+\/\d{8}-/i
  },
  {
    id: 'golos-ameriki',
    name: 'Голос Америки',
    category: 'broadcaster',
    country: 'США',
    homepage: 'https://www.golosameriki.com',
    listUrls: ['https://www.golosameriki.com/'],
    articleUrl: /^https:\/\/www\.golosameriki\.com\/a\/[a-z0-9-]+\/\d+\.html/i
  },

  // ── Региональные проекты RFE/RL ────────────────────────────────────────────
  {
    id: 'sibreal',
    name: 'Сибирь.Реалии',
    category: 'regional',
    country: 'Чехия',
    homepage: 'https://www.sibreal.org',
    listUrls: ['https://www.sibreal.org/'],
    articleUrl: /^https:\/\/www\.sibreal\.org\/a\/[a-z0-9-]+\/\d+\.html/i
  },
  {
    id: 'severreal',
    name: 'Север.Реалии',
    category: 'regional',
    country: 'Чехия',
    homepage: 'https://www.severreal.org',
    listUrls: ['https://www.severreal.org/'],
    articleUrl: /^https:\/\/www\.severreal\.org\/a\/[a-z0-9-]+\/\d+\.html/i
  },
  {
    id: 'idelreal',
    name: 'Idel.Реалии',
    category: 'regional',
    country: 'Чехия',
    homepage: 'https://www.idelreal.org',
    listUrls: ['https://www.idelreal.org/'],
    articleUrl: /^https:\/\/www\.idelreal\.org\/a\/[a-z0-9-]+\/\d+\.html/i
  },
  {
    id: 'kavkazr',
    name: 'Кавказ.Реалии',
    category: 'regional',
    country: 'Чехия',
    homepage: 'https://www.kavkazr.com',
    listUrls: ['https://www.kavkazr.com/'],
    articleUrl: /^https:\/\/www\.kavkazr\.com\/a\/[a-z0-9-]+\/\d+\.html/i
  },
  {
    id: 'krymr',
    name: 'Крым.Реалии',
    category: 'regional',
    country: 'Чехия',
    homepage: 'https://ru.krymr.com',
    listUrls: ['https://ru.krymr.com/'],
    articleUrl: /^https:\/\/ru\.krymr\.com\/a\/[a-z0-9-]+\/\d+\.html/i
  }
];

// ─────────────────────────────────────────────────────────────────────────────
//  RSS-фиды. Пустой массив = у источника фида нет либо он отдаёт 403/404,
//  обход идёт по HTML через listUrls.
//  Помеченные /* ? */ подтверди верификатором и почисти этот список.
// ─────────────────────────────────────────────────────────────────────────────

const FEED_URLS = {
  // Подтверждено
  meduza:            ['https://meduza.io/rss/news', 'https://meduza.io/rss/all'],
  'bbc-russian':     ['https://feeds.bbci.co.uk/russian/rss.xml'],
  'dw-russian':      ['https://rss.dw.com/rdf/rss-ru-all'],

  // Требует проверки
  'novaya-europe':   ['https://novayagazeta.eu/feed/rss'] /* ? */,
  'the-insider':     ['https://theins.ru/feed'] /* ? */,
  mediazona:         ['https://zona.media/rss'] /* ? */,
  istories:          ['https://istories.media/rss.xml'] /* ? */,
  holod:             ['https://holod.media/feed/'] /* ? */,
  verstka:           ['https://verstka.media/category/news/feed/', 'https://verstka.media/feed/'] /* ? */,
  proekt:            ['https://www.proekt.media/feed/'] /* ? */,
  agentstvo:         ['https://www.agents.media/feed/'] /* ? */,
  cherta:            ['https://cherta.media/feed/'] /* ? */,
  kedr:              ['https://kedr.media/feed/'] /* ? */,
  paperpaper:        ['https://paperpaper.io/feed/'] /* ? */,
  semnasem:          ['https://semnasem.org/feed/'] /* ? */,
  'novaya-vkladka':  ['https://thenewtab.io/feed/'] /* ? */,
  'lyudi-baikala':   ['https://lyudibaikala.ru/feed/'] /* ? */,
  'the-bell':        ['https://thebell.io/feed/'] /* ? */,
  tvrain:            ['https://tvrain.tv/rss/'] /* ? */,
  sotavision:        ['https://sotavision.world/feed/'] /* ? */,
  'moscow-times-ru': ['https://www.moscowtimes.ru/rss/news'] /* ? */,
  'novaya-gazeta':   [],
  echo:               [],
  'ovd-info':        ['https://ovd.news/rss'] /* ? */,
  'sota-project':    ['https://sotaproject.com/rss', 'https://sotaproject.com/feed'] /* ? */,
  astra:             ['https://astra.press/ru/rss', 'https://astra.press/rss'] /* ? */,
  'port-media':      ['https://portmedia.info/rss', 'https://portmedia.info/feed'] /* ? */,
  'mozhem-obyasnit': [],
  'govorit-nemoskva': [],
  republic:          [],

  // RFE/RL: фиды есть, но с непредсказуемыми id — идём по HTML
  svoboda:           [],
  currenttime:       [],
  sibreal:           [],
  severreal:         [],
  idelreal:          [],
  kavkazr:           [],
  krymr:             [],
  'golos-ameriki':   [],
  'rfi-ru':          []
};

// ─────────────────────────────────────────────────────────────────────────────
//  Политики извлечения даты
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_DATE_POLICY = {
  summary: 'meta/json-ld → видимая дата → дата из URL',
  articleDateSelectors: [],
  articleTextSelectors: [],
  listDateSelectors: []
};

const DATE_POLICIES = {
  meduza: {
    summary: 'RSS pubDate; на листинге дат нет — добираем из URL и meta',
    articleDateSelectors: ['meta[property="article:published_time"]']
  },
  mediazona: {
    summary: 'дата в URL всегда есть; уточняем по meta',
    alwaysCheckArticleDate: false
  },
  // Сайты RFE/RL отдают время по Праге в видимом тексте, но корректный
  // ISO лежит в json-ld — приоритет ему.
  svoboda:     { summary: 'json-ld datePublished (Pangea)' },
  currenttime: { summary: 'json-ld datePublished (Pangea)' },
  sibreal:     { summary: 'json-ld datePublished (Pangea)' },
  severreal:   { summary: 'json-ld datePublished (Pangea)' },
  idelreal:    { summary: 'json-ld datePublished (Pangea)' },
  kavkazr:     { summary: 'json-ld datePublished (Pangea)' },
  krymr:       { summary: 'json-ld datePublished (Pangea)' },
  'bbc-russian': {
    summary: 'RSS pubDate + meta',
    listDateSelectors: ['time[datetime]', '[data-testid="card-metadata-lastupdated"]']
  },
  'sota-project': {
    summary: 'официальный JSON API /api/v1/tg-news: created_at с точным временем'
  },
  'novaya-gazeta': {
    summary: 'внутренний JSON API /api/v1/get/records/chronological: dateISO'
  },
  echo: {
    summary: 'HTML /news + article:published_time со страницы материала',
    articleDateSelectors: ['meta[property="article:published_time"]']
  }
};

export const SOURCES = RAW_SOURCES.map((source) => ({
  ...source,
  feedUrls: FEED_URLS[source.id] || [],
  datePolicy: {
    ...DEFAULT_DATE_POLICY,
    ...(DATE_POLICIES[source.id] || {})
  }
}));

export const CATEGORIES = {
  general: 'Общие новости',
  investigations: 'Расследования',
  rights: 'Права человека',
  economy: 'Экономика',
  regional: 'Регионы',
  broadcaster: 'Вещатели'
};
