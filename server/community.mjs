// FIZY Journal — расширения: новости (геополитика), чат трейдеров, идеи и лента достижений.
// Подключается из server/api-core.mjs. Хранилище — Netlify Blobs.
import {randomBytes} from 'node:crypto';

const fail = (status, message) => { throw Object.assign(Error(message), {status}) };
const now = () => Date.now();
const id = () => randomBytes(9).toString('hex');
const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// ---------- хранилище со сравнением версии (compare-and-swap) ----------
async function cas(store, key, change, fallback) {
  for (let i = 0; i < 6; i++) {
    const prev = await store.getWithMetadata(key, {type: 'json', consistency: 'strong'});
    const next = await change(prev?.data ?? fallback);
    const r = await store.setJSON(key, next, prev ? {onlyIfMatch: prev.etag} : {onlyIfNew: true});
    if (r.modified) return next;
  }
  fail(409, 'Слишком много одновременных записей. Повтори через секунду.');
}
const load = async (store, key, fallback) =>
  (await store.get(key, {type: 'json', consistency: 'strong'})) ?? fallback;

// ---------- анти-спам ----------
const LIMITS = {chat: {max: 12, window: 60000}, post: {max: 6, window: 300000}, react: {max: 60, window: 60000}};
async function throttle(store, kind, username) {
  const {max, window} = LIMITS[kind];
  await cas(store, `rate/${kind}/${username}`, old => {
    const t = now();
    const hits = (old?.hits ?? []).filter(x => t - x < window);
    if (hits.length >= max) fail(429, 'Слишком часто. Подожди немного и повтори.');
    return {hits: [...hits, t]};
  }, {hits: []});
}

/* =========================================================
   1. ГЕОПОЛИТИКА И РЫНОК: металлы, валюты, индексы
   Функция сама ходит за RSS и отдаёт браузеру чистый JSON,
   поэтому Content-Security-Policy сайта менять не нужно.
   ========================================================= */
const FEEDS = [
  // русскоязычные источники — идут первыми и получают приоритет в ленте
  {source: 'Investing RU', lang: 'ru', url: 'https://ru.investing.com/rss/news_1.rss'},
  {source: 'Investing RU', lang: 'ru', url: 'https://ru.investing.com/rss/commodities_Gold.rss'},
  {source: 'Investing RU', lang: 'ru', url: 'https://ru.investing.com/rss/news_285.rss'},
  {source: 'Interfax',     lang: 'ru', url: 'https://www.interfax.ru/rss.asp'},
  {source: 'Финам',       lang: 'ru', url: 'https://www.finam.ru/analysis/conews/rsspoint/'},
  {source: 'RT',           lang: 'ru', url: 'https://russian.rt.com/business/rss'},
  // англоязычные
  {source: 'Reuters',   lang: 'en', url: 'https://feeds.reuters.com/reuters/businessNews'},
  {source: 'CNBC',      lang: 'en', url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html'},
  {source: 'Investing', lang: 'en', url: 'https://www.investing.com/rss/news_1.rss'},
  {source: 'Investing', lang: 'en', url: 'https://www.investing.com/rss/commodities_Gold.rss'},
  {source: 'FXStreet',  lang: 'en', url: 'https://www.fxstreet.com/rss/news'},
  {source: 'Yahoo',     lang: 'en', url: 'https://finance.yahoo.com/news/rssindex'}
];

// Календарь Forex Factory (неделя). Отдаётся отдельным маршрутом /api/calendar.
const FF_URLS = [
  'https://nfs.faireconomy.media/ff_calendar_thisweek.xml',
  'https://cdn-nfs.faireconomy.media/ff_calendar_thisweek.xml'
];
const FF_TITLES = {
  ru: {high: 'Высокая', medium: 'Средняя', low: 'Низкая', holiday: 'Выходной'}
};

// ключевые слова -> тег и «вес» важности
const TAGS = [
  {tag: 'МЕТАЛЛЫ', weight: 3, re: /\b(gold|xau|silver|xag|bullion|platinum|palladium|copper|золот|серебр|металл)\b/i},
  {tag: 'НЕФТЬ',   weight: 3, re: /\b(oil|brent|wti|opec|crude|lng|нефт|газ)\b/i},
  {tag: 'ВАЛЮТЫ',  weight: 3, re: /\b(dollar|dxy|euro|eur\/usd|yen|usd\/jpy|pound|gbp|franc|yuan|currenc|forex|доллар|евро|иен|валют)\b/i},
  {tag: 'ИНДЕКСЫ', weight: 3, re: /\b(s&p|s and p|nasdaq|dow|russell|dax|ftse|nikkei|stoxx|index|indices|индекс)\b/i},
  {tag: 'ЦБ',      weight: 4, re: /\b(fed|fomc|powell|ecb|lagarde|boj|boe|rate (hike|cut|decision)|cpi|inflation|nonfarm|payroll|ставк|инфляц)\b/i},
  {tag: 'ГЕОПОЛИТИКА', weight: 5, re: /\b(war|strike|missile|sanction|tariff|conflict|ceasefire|iran|israel|russia|ukraine|china|taiwan|hormuz|opec\+|nato|войн|санкц|пошлин|удар|перемир)\b/i}
];

function pick(text) {
  const tags = [], hits = [];
  for (const t of TAGS) if (t.re.test(text)) { tags.push(t.tag); hits.push(t.weight) }
  return {tags, score: hits.reduce((a, b) => a + b, 0)};
}

const unescapeXml = s => String(s)
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

const field = (block, name) => {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? unescapeXml(m[1]) : '';
};

function parseFeed(xml, source) {
  const items = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi) || [];
  for (const block of blocks.slice(0, 30)) {
    const title = field(block, 'title');
    if (!title) continue;
    let link = field(block, 'link');
    if (!link) link = (block.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || '';
    const date = field(block, 'pubDate') || field(block, 'published') || field(block, 'updated');
    const summary = (field(block, 'description') || field(block, 'summary')).slice(0, 400);
    const {tags, score} = pick(title + ' ' + summary);
    if (!tags.length) continue;
    const ts = Date.parse(date);
    items.push({
      id: source + '|' + title.slice(0, 80),
      title: title.slice(0, 300), summary, link: link.slice(0, 500), source,
      time: Number.isFinite(ts) ? ts : now(), tags, score
    });
  }
  return items;
}

// общий загрузчик с тайм-аутом
async function fetchText(url, ms = 7000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {signal: ctrl.signal, headers: {'User-Agent': 'FIZY-Journal/1.0 (+news reader)'}});
    if (!r.ok) return null;
    return await r.text();
  } catch { return null } finally { clearTimeout(timer) }
}

// ---------- экономический календарь Forex Factory ----------
function parseCalendar(xml) {
  const out = [];
  const blocks = xml.match(/<event>[\s\S]*?<\/event>/gi) || [];
  for (const b of blocks) {
    const title = field(b, 'title');
    if (!title) continue;
    const country = field(b, 'country');
    const impact = field(b, 'impact').toLowerCase();
    const dateRaw = field(b, 'date'), timeRaw = field(b, 'time');
    let ts = Date.parse(dateRaw + ' ' + timeRaw);
    if (!Number.isFinite(ts)) ts = Date.parse(dateRaw);
    out.push({
      id: (country + title + dateRaw + timeRaw).slice(0, 90),
      title: title.slice(0, 160),
      country: country.slice(0, 8),
      impact: impact.includes('high') ? 'high' : impact.includes('medium') ? 'medium' : impact.includes('holiday') ? 'holiday' : 'low',
      time: Number.isFinite(ts) ? ts : null,
      allDay: !/\d/.test(timeRaw),
      forecast: clean(field(b, 'forecast'), 24),
      previous: clean(field(b, 'previous'), 24),
      actual: clean(field(b, 'actual'), 24)
    });
  }
  return out.sort((a, b) => (a.time || 0) - (b.time || 0));
}

async function calendar(store) {
  const cached = await load(store, 'calendar/cache', null);
  if (cached && now() - cached.updated < 900000) return {events: cached.events, updated: cached.updated, cached: true};
  let events = [];
  for (const url of FF_URLS) {
    const xml = await fetchText(url);
    if (xml) { events = parseCalendar(xml); if (events.length) break }
  }
  if (!events.length && cached) return {events: cached.events, updated: cached.updated, stale: true};
  const payload = {events: events.slice(0, 120), updated: now(), labels: FF_TITLES.ru};
  try { await store.setJSON('calendar/cache', payload) } catch {}
  return payload;
}

async function fetchNews() {
  const results = await Promise.allSettled(FEEDS.map(async f => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      const r = await fetch(f.url, {signal: ctrl.signal, headers: {'User-Agent': 'FIZY-Journal/1.0 (+news reader)'}});
      if (!r.ok) return [];
      return parseFeed(await r.text(), f.source).map(i => ({...i, lang: f.lang || 'en'}));
    } finally { clearTimeout(timer) }
  }));
  const seen = new Set(), all = [];
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const item of r.value) {
      const key = item.title.toLowerCase().slice(0, 60);
      if (seen.has(key)) continue;
      seen.add(key); all.push(item);
    }
  }
  const fresh = now() - 3 * 86400000;
  return all.filter(i => i.time > fresh)
    .sort((a, b) => (b.score - a.score) * 1e6 + (b.time - a.time))
    .slice(0, 40)
    .sort((a, b) => b.time - a.time);
}

async function news(store) {
  const cached = await load(store, 'news/cache', null);
  if (cached && now() - cached.updated < 300000) return {items: cached.items, updated: cached.updated, cached: true};
  let items = [];
  try { items = await fetchNews() } catch { items = [] }
  if (!items.length && cached) return {items: cached.items, updated: cached.updated, cached: true, stale: true};
  const payload = {items, updated: now()};
  try { await store.setJSON('news/cache', payload) } catch {}
  return {...payload, cached: false};
}

/* =========================================================
   2. ЧАТ ТРЕЙДЕРОВ
   ========================================================= */
const CHAT_KEY = 'chat/global';
const CHAT_MAX = 300;

async function chatPost(store, username, body) {
  const text = clean(body?.text, 700);
  if (!text) fail(400, 'Пустое сообщение.');
  await throttle(store, 'chat', username);
  const message = {
    id: id(), username, text, time: now(),
    trade: body?.trade ? {
      symbol: clean(body.trade.symbol, 32),
      side: ['Long', 'Short'].includes(body.trade.side) ? body.trade.side : 'Long',
      rr: Number.isFinite(Number(body.trade.rr)) ? Number(Number(body.trade.rr).toFixed(2)) : null,
      risk: Number.isFinite(Number(body.trade.risk)) ? Number(Number(body.trade.risk).toFixed(2)) : null
    } : null
  };
  const next = await cas(store, CHAT_KEY, old => ({messages: [...(old?.messages ?? []), message].slice(-CHAT_MAX)}), {messages: []});
  return {message, messages: next.messages.slice(-60)};
}

/* =========================================================
   3. ИДЕИ И ЛЕНТА ДОСТИЖЕНИЙ (общие посты с реакциями)
   kind: 'idea' — пре-трейд идея, 'win' — карточка результата
   ========================================================= */
const POSTS_KEY = 'posts/global';
const POSTS_MAX = 400;
const EMOJI = ['🔥', '💀', '❤️', '😂', '📈', '👏', '🏆', '🧠', '✅', '👀'];
const STATUS = ['watching', 'triggered', 'invalidated', 'archived'];

function buildPost(username, body) {
  const kind = body?.kind === 'win' ? 'win' : 'idea';
  const title = clean(body?.title, 140);
  if (!title) fail(400, 'Нужен заголовок идеи.');
  const num = v => (Number.isFinite(Number(v)) && String(v).trim() !== '' ? Number(v) : null);
  return {
    id: id(), kind, username, time: now(),
    title,
    symbol: clean(body?.symbol, 32) || '—',
    side: ['Long', 'Short'].includes(body?.side) ? body.side : 'Long',
    status: STATUS.includes(body?.status) ? body.status : 'watching',
    entry: num(body?.entry), stop: num(body?.stop), target: num(body?.target),
    rr: num(body?.rr), pnl: num(body?.pnl),
    thesis: clean(body?.thesis, 1200),
    invalidation: clean(body?.invalidation, 400),
    tags: Array.isArray(body?.tags) ? body.tags.slice(0, 5).map(t => clean(t, 24)).filter(Boolean) : [],
    reactions: {}
  };
}

async function postsCreate(store, username, body) {
  await throttle(store, 'post', username);
  const post = buildPost(username, body);
  const next = await cas(store, POSTS_KEY, old => ({posts: [post, ...(old?.posts ?? [])].slice(0, POSTS_MAX)}), {posts: []});
  return {post, posts: next.posts.slice(0, 50)};
}

async function postsReact(store, username, body) {
  const emoji = String(body?.emoji ?? '');
  if (!EMOJI.includes(emoji)) fail(400, 'Недопустимая реакция.');
  const postId = clean(body?.id, 40);
  await throttle(store, 'react', username);
  const next = await cas(store, POSTS_KEY, old => {
    const posts = (old?.posts ?? []).map(p => {
      if (p.id !== postId) return p;
      const reactions = {...(p.reactions ?? {})};
      const users = new Set(reactions[emoji] ?? []);
      users.has(username) ? users.delete(username) : users.add(username);
      if (users.size) reactions[emoji] = [...users].slice(0, 500); else delete reactions[emoji];
      return {...p, reactions};
    });
    if (!posts.some(p => p.id === postId)) fail(404, 'Пост не найден.');
    return {posts};
  }, {posts: []});
  return {posts: next.posts.slice(0, 50)};
}

async function postsUpdate(store, username, body) {
  const postId = clean(body?.id, 40);
  const status = STATUS.includes(body?.status) ? body.status : null;
  if (!status) fail(400, 'Неизвестный статус идеи.');
  const next = await cas(store, POSTS_KEY, old => {
    const posts = (old?.posts ?? []).map(p =>
      p.id === postId && p.username === username ? {...p, status, updated: now()} : p);
    return {posts};
  }, {posts: []});
  return {posts: next.posts.slice(0, 50)};
}

async function postsDelete(store, username, body) {
  const postId = clean(body?.id, 40);
  const next = await cas(store, POSTS_KEY, old => ({
    posts: (old?.posts ?? []).filter(p => !(p.id === postId && p.username === username))
  }), {posts: []});
  return {posts: next.posts.slice(0, 50)};
}

/* =========================================================
   Маршрутизатор расширений
   ========================================================= */
export function createCommunity({getStore, env = process.env}) {
  const store = () => getStore((env.FIZY_STORE_NAME || 'fizy-journal-v1') + '-community');
  return async function community({path, method, username, parse, req, json}) {
    if (!path.startsWith('/api/')) return null;
    const s = store();

    if (path === '/api/news' && method === 'GET') return json(200, await news(s));
    if (path === '/api/calendar' && method === 'GET') return json(200, await calendar(s));

    if (path === '/api/chat' && method === 'GET') {
      const data = await load(s, CHAT_KEY, {messages: []});
      return json(200, {messages: data.messages.slice(-60), me: username});
    }
    if (path === '/api/chat' && method === 'POST') return json(201, await chatPost(s, username, await parse(req)));

    if (path === '/api/posts' && method === 'GET') {
      const data = await load(s, POSTS_KEY, {posts: []});
      return json(200, {posts: data.posts.slice(0, 50), me: username, emoji: EMOJI});
    }
    if (path === '/api/posts' && method === 'POST') return json(201, await postsCreate(s, username, await parse(req)));
    if (path === '/api/posts/react' && method === 'POST') return json(200, await postsReact(s, username, await parse(req)));
    if (path === '/api/posts/status' && method === 'POST') return json(200, await postsUpdate(s, username, await parse(req)));
    if (path === '/api/posts/delete' && method === 'POST') return json(200, await postsDelete(s, username, await parse(req)));

    return null;
  };
}
