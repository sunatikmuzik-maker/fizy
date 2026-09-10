// FIZY Journal — новые разделы: Рынок (геополитика + сессии), Идеи, Чат, Калькулятор.
// Модуль сам встраивается в существующий интерфейс и не трогает app.js.
import {INSTRUMENTS, calculatePosition, parseNumber} from '/fizy-calc.mjs';

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const money = v => new Intl.NumberFormat('ru-RU', {style: 'currency', currency: 'USD', maximumFractionDigits: 2}).format(v || 0);
const num = (v, d = 2) => new Intl.NumberFormat('ru-RU', {maximumFractionDigits: d}).format(v ?? 0);

let csrf = '';
let me = null;

async function api(path, method = 'GET', body) {
  const r = await fetch('/api/' + path, {
    method, credentials: 'same-origin',
    headers: {'Content-Type': 'application/json', ...(csrf ? {'X-CSRF-Token': csrf} : {})},
    ...(body === undefined ? {} : {body: JSON.stringify(body)})
  });
  let data = {};
  try { data = await r.json() } catch {}
  if (!r.ok) throw Object.assign(Error(data.error || 'Не удалось выполнить запрос.'), {status: r.status});
  return data;
}
const ago = ts => {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (m < 1) return 'только что';
  if (m < 60) return m + ' мин назад';
  const h = Math.round(m / 60);
  return h < 24 ? h + ' ч назад' : Math.round(h / 24) + ' дн назад';
};

/* ============================================================
   РАЗМЕТКА
   ============================================================ */
const MARKUP = `
<section id="marketView" class="app-view fx-view" hidden>
  <div class="fx-grid">
    <div class="panel fx-news">
      <div class="section-head">
        <div><h2>Геополитика и рынок</h2>
        <p class="muted small">Металлы, валюты, индексы и события, которые их двигают.</p></div>
        <span class="fx-live"><i></i>Прямой эфир</span>
      </div>
      <div class="fx-filters" id="newsFilters"></div>
      <div id="newsList" class="fx-feed"><p class="muted small">Загружаю ленту…</p></div>
      <div class="row fx-news-foot">
        <button id="newsRefresh">Обновить</button>
        <span class="small muted" id="newsUpdated"></span>
      </div>
    </div>

    <div class="panel fx-sessions">
      <div class="section-head">
        <div><h2>Время работы рынка</h2>
        <p class="muted small" id="sessionSub"></p></div>
        <button id="tzToggle" class="fx-chip">Ваше время</button>
      </div>
      <div class="fx-map" id="sessionMap"></div>
      <div class="fx-session-grid" id="sessionCards"></div>
    </div>
  </div>

  <div class="panel fx-calendar">
    <div class="section-head">
      <div><h2>Календарь Forex Factory</h2>
      <p class="muted small">События недели в твоём часовом поясе. Красные — высокая важность.</p></div>
      <div class="fx-filters" id="calFilters"></div>
    </div>
    <div id="calList" class="fx-cal"><p class="muted small">Загружаю календарь…</p></div>
  </div>

  <div class="panel fx-ghost">
    <div class="section-head"><h2>Призрачный Счёт</h2></div>
    <div class="fx-ghost-body">
      <div class="fx-ghost-total">
        <strong id="ghostScore">—</strong><span>/ 100</span>
        <p class="small muted" id="ghostHint">Зарегистрируйте сделку, чтобы увидеть свой рейтинг.</p>
      </div>
      <div class="fx-ghost-factors" id="ghostFactors"></div>
    </div>
  </div>

  <div class="panel">
    <div class="section-head">
      <div><h2>Haunted Achievements</h2><p class="muted small">Что трейдеры закрыли сегодня.</p></div>
      <button id="shareWin" class="primary">Поделиться результатом</button>
    </div>
    <div id="winFeed" class="fx-feed"></div>
  </div>
</section>

<section id="ideasView" class="app-view fx-view" hidden>
  <div class="panel fx-hero">
    <div>
      <div class="eyebrow">PRE-TRADE JOURNAL</div>
      <h2>Идеи трейдеров.</h2>
      <p class="muted">Запиши идею до движения: направление, что её отменит и логику. Когда идея отработает — история уже будет прикреплена.</p>
      <button id="newIdea" class="primary">+ Новая идея</button>
    </div>
    <div class="fx-stats" id="ideaStats"></div>
  </div>
  <div class="panel">
    <div class="fx-idea-toolbar">
      <input id="ideaSearch" placeholder="Поиск: идея, пара, тег…" maxlength="60">
      <div class="fx-filters" id="ideaFilters"></div>
    </div>
    <div id="ideaList" class="fx-cards"></div>
  </div>
</section>

<section id="chatView" class="app-view fx-view" hidden>
  <div class="panel fx-chat">
    <div class="section-head">
      <div><h2>Чат трейдеров</h2><p class="muted small">Общая комната. Можно прикрепить карточку своей сделки.</p></div>
      <span class="fx-live"><i></i>Онлайн</span>
    </div>
    <div id="chatLog" class="fx-chat-log"></div>
    <form id="chatForm" class="fx-chat-form">
      <label class="check"><input type="checkbox" id="chatAttach"><span>Прикрепить последнюю сделку из журнала</span></label>
      <div class="row">
        <input id="chatText" maxlength="700" placeholder="Что видишь на графике?" autocomplete="off">
        <button class="primary" type="submit">Отправить</button>
      </div>
      <p class="small muted">Не публикуй личные данные, ключи бирж и чужие контакты. Сообщения видны всем пользователям.</p>
    </form>
  </div>
</section>

<section id="calcView" class="app-view fx-view" hidden>
  <div class="section-head">
    <div><h2>Калькулятор размера позиции</h2>
    <p class="muted small">Считает объём так, чтобы потеря на стопе не превысила риск — и проверяет, хватит ли на неё маржи.</p></div>
  </div>
  <div class="fx-calc">
    <div class="panel">
      <label>Инструмент<select id="cInstrument"></select></label>
      <div class="fx-two">
        <label>Символ<input id="cSymbol" maxlength="32"></label>
        <label>Направление<select id="cSide"><option>Long</option><option>Short</option></select></label>
        <label>Считать риск<select id="cRiskMode"><option value="percent">В процентах от баланса</option><option value="money">В долларах</option></select></label>
        <label>Баланс счёта, USD<input id="cBalance" inputmode="decimal" value="10000"></label>
        <label id="cRiskLabel">Риск, %<input id="cRisk" inputmode="decimal" value="1"></label>
        <label>Стоп задан<select id="cStopMode"><option value="price">Ценой стоп-лосса</option><option value="points">В пунктах</option></select></label>
        <label>Цена входа<input id="cEntry" inputmode="decimal" value="4400"></label>
        <label id="cStopLabel">Цена стоп-лосса<input id="cStop" inputmode="decimal" value="4200"></label>
        <label>Цель, R<input id="cTarget" inputmode="decimal" value="3"></label>
        <label>Размер контракта<input id="cContract" inputmode="decimal" value="100"></label>
        <label>Размер одного пункта<input id="cPoint" inputmode="decimal" value="0.01"></label>
        <label>Кредитное плечо 1:<input id="cLeverage" inputmode="decimal" value="100"></label>
        <label>Мин. лот / шаг<input id="cLotStep" inputmode="decimal" value="0.01"></label>
      </div>
      <div class="row"><button id="cRun" class="primary">Вычислить</button><button id="cReset">Сбросить</button></div>
      <p class="small muted">Проверь размер контракта, шаг лота и плечо у своего брокера — они влияют на результат.</p>
    </div>
    <div class="panel" id="cResult"></div>
  </div>
</section>`;

/* ============================================================
   ВКЛАДКИ
   ============================================================ */
const TABS = [
  {view: 'marketView', label: 'Рынок'},
  {view: 'ideasView', label: 'Идеи'},
  {view: 'chatView', label: 'Чат'},
  {view: 'calcView', label: 'Калькулятор'}
];
const OUR = TABS.map(t => t.view);

function mount() {
  const workspace = $('#workspace') || $('main');
  if (!workspace || $('#marketView')) return;
  const holder = el('div', 'fx-mount');
  holder.innerHTML = MARKUP;
  workspace.append(...holder.children);

  const nav = $('.workspace-tabs');
  if (!nav) return;

  dropOldCalcTab();
  // сайт может перерисовать панель вкладок после входа — следим и чистим снова
  new MutationObserver(() => { dropOldCalcTab(); ensureOurTabs() }).observe(nav, {childList: true});

  TABS.forEach(t => {
    const b = el('button', 'fx-tab', esc(t.label));
    b.dataset.view = t.view;
    nav.append(b);
  });
  nav.addEventListener('click', e => {
    const btn = e.target.closest('button[data-view]');
    if (!btn) return;
    const view = btn.dataset.view;
    if (OUR.includes(view)) {
      document.querySelectorAll('.app-view').forEach(s => { s.hidden = true });
      nav.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      $('#' + view).hidden = false;
      onOpen(view);
    } else {
      OUR.forEach(v => { const s = $('#' + v); if (s) s.hidden = true });
    }
  });
}

// Убирает старую вкладку «Калькулятор» сайта, чтобы кнопка осталась одна.
function dropOldCalcTab() {
  const nav = $('.workspace-tabs');
  if (!nav) return;
  [...nav.querySelectorAll('button, a')].forEach(b => {
    if (b.classList.contains('fx-tab')) return;
    const label = (b.textContent || '').trim().toLowerCase();
    if (!/^(калькулятор|kalkulyator|calculator|калькулятор)$/.test(label)) return;
    const view = b.dataset.view;
    if (view) { const s = $('#' + view); if (s) { s.hidden = true; s.dataset.fxRetired = '1' } }
    b.remove();
  });
  // если старый раздел всё равно показался — прячем
  document.querySelectorAll('.app-view[data-fx-retired]').forEach(s => { s.hidden = true });
}

// Возвращает наши вкладки, если сайт пересобрал панель.
function ensureOurTabs() {
  const nav = $('.workspace-tabs');
  if (!nav) return;
  TABS.forEach(t => {
    if (nav.querySelector(`button.fx-tab[data-view="${t.view}"]`)) return;
    const b = el('button', 'fx-tab', esc(T(t.label)));
    b.dataset.view = t.view;
    nav.append(b);
  });
}

function onOpen(view) {
  if (view === 'marketView') { loadNews(); loadCalendar(); refreshGhost(); loadPosts() }
  if (view === 'ideasView') loadPosts();
  if (view === 'chatView') { loadChat(); chatTimer ??= setInterval(loadChat, 15000) }
  if (view === 'calcView') runCalc();
}

/* ============================================================
   СЕССИИ С АВТОМАТИЧЕСКИМ UTC
   Часы берутся из IANA-зон, поэтому переход на летнее время
   учитывается автоматически — руками смещение править не нужно.
   ============================================================ */
const SESSIONS = [
  {id: 'sydney',    name: 'Сидней',    zone: 'Australia/Sydney', open: 7 * 60, close: 16 * 60, x: 88, y: 78, color: '#a78bfa'},
  {id: 'asia',      name: 'Азия',      zone: 'Asia/Tokyo',       open: 9 * 60, close: 18 * 60, x: 82, y: 42, color: '#38bdf8'},
  {id: 'frankfurt', name: 'Франкфурт', zone: 'Europe/Berlin',   open: 8 * 60, close: 17 * 60, x: 52, y: 33, color: '#f59e0b'},
  {id: 'london',    name: 'Лондон',    zone: 'Europe/London',   open: 8 * 60, close: 17 * 60, x: 47, y: 29, color: '#22c55e'},
  {id: 'newyork',   name: 'Нью-Йорк',  zone: 'America/New_York', open: 8 * 60, close: 17 * 60, x: 25, y: 38, color: '#ef4444'}
];
let showLocal = true;
const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

// Смещение зоны от UTC в минутах на конкретный момент (с учётом DST)
function offsetMinutes(zone, date = new Date()) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const p = Object.fromEntries(dtf.formatToParts(date).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, p.hour === '24' ? 0 : +p.hour, +p.minute, +p.second);
  return Math.round((asUTC - date.getTime()) / 60000);
}
const fmtTime = (date, zone) => new Intl.DateTimeFormat('ru-RU', {timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false}).format(date);
const hhmm = mins => String(Math.floor(((mins % 1440) + 1440) % 1440 / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');

function sessionState(s, date = new Date()) {
  const off = offsetMinutes(s.zone, date);
  const localMinutes = (date.getUTCHours() * 60 + date.getUTCMinutes() + off + 1440) % 1440;
  const day = new Date(date.getTime() + off * 60000).getUTCDay();
  const weekend = day === 0 || day === 6;
  const open = !weekend && localMinutes >= s.open && localMinutes < s.close;
  // окно сессии в UTC → переводим в зону просмотра
  const viewZone = showLocal ? localZone : 'UTC';
  const viewOff = offsetMinutes(viewZone, date);
  const shift = viewOff - off;
  const minutesTo = open
    ? (s.close - localMinutes)
    : ((s.open - localMinutes + 1440) % 1440);
  return {
    open, weekend,
    windowText: hhmm(((s.open + shift) % 1440 + 1440) % 1440) + '–' + hhmm(((s.close + shift) % 1440 + 1440) % 1440),
    clock: fmtTime(date, s.zone),
    minutesTo
  };
}

function renderSessions() {
  const cards = $('#sessionCards'), map = $('#sessionMap');
  if (!cards) return;
  const date = new Date();
  const viewZone = showLocal ? localZone : 'UTC';
  $('#sessionSub').textContent =
    `${showLocal ? 'Ваш часовой пояс: ' + viewZone : 'Всё время в UTC'} · сейчас ${fmtTime(date, viewZone)} · UTC${(() => { const o = offsetMinutes(viewZone, date); const sign = o < 0 ? '−' : '+'; return sign + hhmm(Math.abs(o)) })()}`;
  $('#tzToggle').textContent = showLocal ? 'Ваше время' : 'UTC';

  cards.innerHTML = '';
  map.innerHTML = '';
  SESSIONS.forEach(s => {
    const st = sessionState(s, date);
    const card = el('div', 'fx-session' + (st.open ? ' is-open' : ''));
    card.innerHTML = `
      <div class="fx-session-top"><span class="fx-dot" style="background:${s.color}"></span><b>${esc(s.name)}</b>
      <span class="fx-session-clock">${st.clock}</span></div>
      <div class="fx-session-window">${st.windowText}</div>
      <div class="fx-session-state">${st.open ? 'ОТКРЫТО' : (st.weekend ? 'ВЫХОДНОЙ' : 'ЗАКРЫТО')}</div>
      <div class="small muted">${st.weekend ? 'Рынок отдыхает' : (st.open ? 'закроется через ' : 'откроется через ') + (st.weekend ? '' : Math.floor(st.minutesTo / 60) + 'ч ' + (st.minutesTo % 60) + 'м')}</div>`;
    cards.append(card);

    const pin = el('span', 'fx-pin' + (st.open ? ' is-open' : ''));
    pin.style.cssText = `left:${s.x}%;top:${s.y}%;--pin:${s.color}`;
    pin.innerHTML = `<i></i><b>${esc(s.name)}</b>`;
    map.append(pin);
  });
  const overlap = SESSIONS.filter(s => sessionState(s, date).open).map(s => s.name);
  if (overlap.length > 1) {
    const tip = el('div', 'fx-overlap', `Сейчас пересе��аются: <b>${overlap.map(esc).join(' + ')}</b> — лучшая ликвидность дня.`);
    cards.append(tip);
  }
}

/* ============================================================
   ГЕОПОЛИТИКА
   ============================================================ */
const NEWS_TAGS = ['ВСЁ', 'ГЕОПОЛИТИКА', 'МЕТАЛЛЫ', 'ВАЛЮТЫ', 'ИНДЕКСЫ', 'НЕФТЬ', 'ЦБ'];
let newsFilter = 'ВСЁ', newsItems = [];

function renderNewsFilters() {
  const box = $('#newsFilters');
  box.innerHTML = '';
  NEWS_TAGS.forEach(t => {
    const b = el('button', 'fx-chip' + (t === newsFilter ? ' is-active' : ''), esc(t));
    b.onclick = () => { newsFilter = t; renderNewsFilters(); renderNews() };
    box.append(b);
  });
}
function renderNews() {
  const list = $('#newsList');
  const items = newsItems.filter(i => newsFilter === 'ВСЁ' || i.tags.includes(newsFilter));
  if (!items.length) { list.innerHTML = '<p class="muted small">Пока нет новостей по этому фильтру.</p>'; return }
  list.innerHTML = items.slice(0, 25).map(i => `
    <article class="fx-news-item ${i.score >= 8 ? 'is-hot' : ''}">
      <div class="fx-news-title">${i.score >= 8 ? '<span class="fx-alert">⚠️</span>' : ''}${esc(i.title)}</div>
      ${i.summary ? `<p class="small muted">${esc(i.summary.slice(0, 180))}${i.summary.length > 180 ? '…' : ''}</p>` : ''}
      <div class="fx-news-meta">
        ${i.tags.map(t => `<span class="fx-tag">${esc(t)}</span>`).join('')}
        <span class="muted">${esc(i.source)} · ${ago(i.time)}</span>
        ${i.link ? `<a href="${esc(i.link)}" target="_blank" rel="noopener noreferrer">Открыть ↗</a>` : ''}
      </div>
    </article>`).join('');
}
async function loadNews() {
  try {
    const data = await api('news');
    newsItems = data.items || [];
    $('#newsUpdated').textContent = data.updated ? 'Обновлено ' + ago(data.updated) : '';
    renderNews();
  } catch (e) {
    $('#newsList').innerHTML = `<p class="error">${esc(e.message)}</p>`;
  }
}

/* ============================================================
   ПРИЗРАЧНЫЙ СЧЁТ (рейтинг дисциплины)
   ============================================================ */
const FACTORS = [
  {key: 'consistency', name: 'Консистенция', weight: 35},
  {key: 'discipline', name: 'Риск дисциплины', weight: 25},
  {key: 'rr', name: 'Соотношение риска и прибыли', weight: 25},
  {key: 'winrate', name: 'Коэффициент выигрыша', weight: 15}
];
let journalCache = null;

function ghostScore(trades) {
  if (!trades.length) return null;
  const days = new Set(trades.map(t => String(t.date).slice(0, 10)));
  const withResult = trades.filter(t => t.rr != null || t.pnl != null);
  const wins = withResult.filter(t => (t.rr ?? t.pnl ?? 0) > 0).length;
  const checks = trades.filter(t => Array.isArray(t.checks) && t.checks.length);
  const rulesRatio = checks.length
    ? checks.reduce((s, t) => s + t.checks.filter(Boolean).length / t.checks.length, 0) / checks.length : 0;
  const risks = trades.map(t => Number(t.risk)).filter(Number.isFinite);
  const avgRisk = risks.length ? risks.reduce((a, b) => a + b, 0) / risks.length : 0;
  const overRisk = risks.filter(r => r > 1).length / (risks.length || 1);
  const rrs = trades.map(t => Number(t.rr)).filter(Number.isFinite);
  const avgRR = rrs.length ? rrs.reduce((a, b) => a + b, 0) / rrs.length : 0;
  const winrate = withResult.length ? wins / withResult.length : 0;

  const consistency = Math.min(100, days.size / 20 * 60 + Math.min(40, trades.length / 30 * 40));
  const discipline = Math.max(0, Math.min(100, rulesRatio * 70 + (1 - overRisk) * 30));
  const rrScore = Math.max(0, Math.min(100, avgRR / 3 * 100));
  const winScore = Math.max(0, Math.min(100, winrate * 100 / 0.6));

  const values = {consistency, discipline, rr: rrScore, winrate: winScore};
  const total = FACTORS.reduce((s, f) => s + values[f.key] * f.weight, 0) / 100;
  return {
    total: Math.round(total), values,
    detail: {
      consistency: `${days.size} торговых дней · ${trades.length} сделок`,
      discipline: `правила ${Math.round(rulesRatio * 100)}% · средний риск ${num(avgRisk, 2)}%`,
      rr: `средний RR ${num(avgRR, 2)}`,
      winrate: `${Math.round(winrate * 100)}% по ${withResult.length} сделкам`
    }
  };
}

function renderGhost(score) {
  const box = $('#ghostFactors');
  if (!box) return;
  $('#ghostScore').textContent = score ? score.total : '—';
  $('#ghostHint').textContent = score
    ? '4 взвешенных фактора по твоему журналу'
    : 'Зарегистрируйте сделку, чтобы увидеть свой рейтинг.';
  box.innerHTML = FACTORS.map(f => {
    const v = score ? Math.round(score.values[f.key]) : null;
    const deg = v == null ? 0 : v * 3.6;
    return `<div class="fx-factor">
      <div class="fx-ring" style="--deg:${deg}deg"><span>${v == null ? '—' : v}<small>/100</small></span></div>
      <div><b>${esc(f.name)}</b> <span class="fx-weight">${f.weight}%</span>
      <p class="small muted">${score ? esc(score.detail[f.key]) : 'нет данных'}</p></div>
    </div>`;
  }).join('');
}

async function refreshGhost() {
  try {
    const data = await api('journal');
    journalCache = data.journal;
    renderGhost(ghostScore(data.journal?.trades ?? []));
  } catch { renderGhost(null) }
}

/* ============================================================
   ИДЕИ И ЛЕНТА ДОСТИЖЕНИЙ
   ============================================================ */
let posts = [], emojiSet = ['🔥', '💀', '❤️', '😂', '📈', '👏', '🏆', '🧠', '✅', '👀'];
const STATUS_LABEL = {watching: 'Наблюдаю', triggered: 'Отработала', invalidated: 'Отменена', archived: 'Архив'};
let ideaFilter = 'all', ideaQuery = '';

async function loadPosts() {
  try {
    const data = await api('posts');
    posts = data.posts || [];
    me = data.me || me;
    if (data.emoji?.length) emojiSet = data.emoji;
    renderIdeas(); renderWins();
  } catch (e) {
    const l = $('#ideaList'); if (l) l.innerHTML = `<p class="error">${esc(e.message)}</p>`;
  }
}

function reactionsBar(p) {
  const mine = emoji => (p.reactions?.[emoji] ?? []).includes(me);
  const used = Object.entries(p.reactions ?? {}).filter(([, u]) => u.length);
  return `<div class="fx-reactions" data-post="${esc(p.id)}">
    ${used.map(([e, u]) => `<button class="fx-react${mine(e) ? ' is-mine' : ''}" data-emoji="${esc(e)}">${e} ${u.length}</button>`).join('')}
    <div class="fx-react-add"><button class="fx-react fx-plus">+</button>
      <div class="fx-picker">${emojiSet.map(e => `<button class="fx-react" data-emoji="${esc(e)}">${e}</button>`).join('')}</div>
    </div></div>`;
}

function ideaCard(p) {
  const levels = [
    p.entry != null ? `Вход ${num(p.entry, 5)}` : '',
    p.stop != null ? `Стоп ${num(p.stop, 5)}` : '',
    p.target != null ? `Цель ${num(p.target, 5)}` : '',
    p.rr != null ? `${num(p.rr, 2)}R` : ''
  ].filter(Boolean);
  return `<article class="fx-card" data-id="${esc(p.id)}">
    <div class="fx-card-head">
      <div><span class="fx-side ${p.side === 'Long' ? 'long' : 'short'}">${esc(p.side)}</span>
      <b>${esc(p.symbol)}</b> <span class="fx-status s-${esc(p.status)}">${esc(STATUS_LABEL[p.status] || p.status)}</span></div>
      <span class="small muted">${esc(p.username)} · ${ago(p.time)}</span>
    </div>
    <h4>${esc(p.title)}</h4>
    ${levels.length ? `<div class="fx-levels">${levels.map(l => `<span>${esc(l)}</span>`).join('')}</div>` : ''}
    ${p.thesis ? `<p class="small">${esc(p.thesis)}</p>` : ''}
    ${p.invalidation ? `<p class="small muted">Идея отменяется: ${esc(p.invalidation)}</p>` : ''}
    ${p.tags?.length ? `<div class="fx-news-meta">${p.tags.map(t => `<span class="fx-tag">${esc(t)}</span>`).join('')}</div>` : ''}
    ${reactionsBar(p)}
    ${p.username === me ? `<div class="row fx-owner">
      <select class="fx-status-set">${Object.entries(STATUS_LABEL).map(([v, l]) => `<option value="${v}" ${v === p.status ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button class="fx-del">Удалить</button></div>` : ''}
  </article>`;
}

function renderIdeas() {
  const list = $('#ideaList'); if (!list) return;
  const ideas = posts.filter(p => p.kind === 'idea');
  const q = ideaQuery.toLowerCase();
  const shown = ideas.filter(p =>
    (ideaFilter === 'all' || p.status === ideaFilter) &&
    (!q || (p.title + p.symbol + (p.tags || []).join(' ')).toLowerCase().includes(q)));

  const counts = {
    all: ideas.length,
    watching: ideas.filter(p => p.status === 'watching').length,
    triggered: ideas.filter(p => p.status === 'triggered').length,
    invalidated: ideas.filter(p => p.status === 'invalidated').length,
    archived: ideas.filter(p => p.status === 'archived').length
  };
  const resolved = counts.triggered + counts.invalidated;
  $('#ideaStats').innerHTML = [
    ['ВСЕГО ИДЕЙ', counts.all, 'за всё время'],
    ['НАБЛЮДАЮ', counts.watching, 'на радаре'],
    ['ОТРАБОТАЛИ', counts.triggered, 'сыграли'],
    ['ТОЧНОСТЬ', resolved ? Math.round(counts.triggered / resolved * 100) + '%' : '0%', resolved ? `по ${resolved} идеям` : 'нет завершённых']
  ].map(([t, v, s]) => `<div class="fx-stat"><span>${t}</span><strong>${v}</strong><small>${s}</small></div>`).join('');

  const filters = $('#ideaFilters');
  filters.innerHTML = [['all', 'Все'], ...Object.entries(STATUS_LABEL)]
    .map(([v, l]) => `<button class="fx-chip${v === ideaFilter ? ' is-active' : ''}" data-status="${v}">${l} ${counts[v] ?? 0}</button>`).join('');

  list.innerHTML = shown.length
    ? shown.map(ideaCard).join('')
    : '<div class="empty"><h3>Здесь пока пусто</h3><p>Первая идея — самый честный способ проверить свою систему.</p></div>';
}

function renderWins() {
  const feed = $('#winFeed'); if (!feed) return;
  const wins = posts.filter(p => p.kind === 'win').slice(0, 15);
  feed.innerHTML = wins.length ? wins.map(p => `
    <article class="fx-win" data-id="${esc(p.id)}">
      <div class="fx-card-head"><b>${esc(p.username)}</b><span class="small muted">${ago(p.time)}</span></div>
      <div class="fx-win-body">
        <div class="fx-win-chip"><span class="fx-side ${p.side === 'Long' ? 'long' : 'short'}">${esc(p.side)}</span> ${esc(p.symbol)}
        ${p.rr != null ? `<b>${num(p.rr, 2)}R</b>` : ''}${p.pnl != null ? `<b>${money(p.pnl)}</b>` : ''}</div>
        <p class="small">${esc(p.title)}</p>
      </div>
      ${reactionsBar(p)}
    </article>`).join('')
    : '<p class="muted small">Пока никто не делился результатом. Будь первым.</p>';
}

// форма идеи / результата
function openPostDialog(kind) {
  const dlg = el('dialog', 'fx-dialog');
  dlg.innerHTML = `<form method="dialog">
    <h3>${kind === 'idea' ? 'Новая идея' : 'Поделиться результатом'}</h3>
    <label>Заголовок<input name="title" maxlength="140" required placeholder="Например: Золото снимает ликвидность Азии"></label>
    <div class="fx-two">
      <label>Символ<input name="symbol" maxlength="32" value="XAUUSD"></label>
      <label>Направление<select name="side"><option>Long</option><option>Short</option></select></label>
      ${kind === 'idea' ? `
      <label>Вход<input name="entry" inputmode="decimal"></label>
      <label>Стоп<input name="stop" inputmode="decimal"></label>
      <label>Цель<input name="target" inputmode="decimal"></label>
      <label>Ожидаемый RR<input name="rr" inputmode="decimal"></label>` : `
      <label>Результат, R<input name="rr" inputmode="decimal"></label>
      <label>Результат, USD<input name="pnl" inputmode="decimal"></label>`}
    </div>
    <label>${kind === 'idea' ? 'Логика идеи' : 'Что сработало'}<textarea name="thesis" maxlength="1200" rows="3"></textarea></label>
    ${kind === 'idea' ? '<label>Что отменит идею<input name="invalidation" maxlength="400"></label>' : ''}
    <label>Теги через запятую<input name="tags" maxlength="120" placeholder="металлы, лондон, OB"></label>
    <p class="error" data-error></p>
    <div class="row"><button value="cancel">Отмена</button><button class="primary" value="ok" id="postSave">Опубликовать</button></div>
  </form>`;
  document.body.append(dlg);
  dlg.showModal();
  dlg.querySelector('#postSave').addEventListener('click', async e => {
    e.preventDefault();
    const f = new FormData(dlg.querySelector('form'));
    const body = {kind, title: f.get('title'), symbol: f.get('symbol'), side: f.get('side'),
      thesis: f.get('thesis'), invalidation: f.get('invalidation'),
      tags: String(f.get('tags') || '').split(',').map(s => s.trim()).filter(Boolean),
      entry: parseNumber(f.get('entry')), stop: parseNumber(f.get('stop')),
      target: parseNumber(f.get('target')), rr: parseNumber(f.get('rr')), pnl: parseNumber(f.get('pnl'))};
    Object.keys(body).forEach(k => { if (Number.isNaN(body[k])) body[k] = null });
    try {
      const data = await api('posts', 'POST', body);
      posts = data.posts; renderIdeas(); renderWins(); dlg.close(); dlg.remove();
    } catch (err) { dlg.querySelector('[data-error]').textContent = err.message }
  });
  dlg.addEventListener('close', () => dlg.remove());
}

/* ============================================================
   ЧАТ
   ============================================================ */
let chatTimer = null;
function renderChat(messages) {
  const log = $('#chatLog'); if (!log) return;
  const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 40;
  log.innerHTML = messages.map(m => `
    <div class="fx-msg${m.username === me ? ' is-me' : ''}">
      <div class="fx-msg-head"><b>${esc(m.username)}</b><span class="small muted">${ago(m.time)}</span></div>
      <p>${esc(m.text)}</p>
      ${m.trade ? `<div class="fx-win-chip"><span class="fx-side ${m.trade.side === 'Long' ? 'long' : 'short'}">${esc(m.trade.side)}</span> ${esc(m.trade.symbol)}${m.trade.rr != null ? ` · ${num(m.trade.rr, 2)}R` : ''}${m.trade.risk != null ? ` · риск ${num(m.trade.risk, 2)}%` : ''}</div>` : ''}
    </div>`).join('') || '<p class="muted small">Сообщений пока нет.</p>';
  if (atBottom) log.scrollTop = log.scrollHeight;
}
async function loadChat() {
  if ($('#chatView')?.hidden) return;
  try { const d = await api('chat'); me = d.me || me; renderChat(d.messages || []) }
  catch (e) { const l = $('#chatLog'); if (l && !l.children.length) l.innerHTML = `<p class="error">${esc(e.message)}</p>` }
}

/* ============================================================
   КАЛЬКУЛЯТОР
   ============================================================ */
function fillInstruments() {
  const sel = $('#cInstrument');
  sel.innerHTML = Object.entries(INSTRUMENTS).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
  sel.onchange = () => {
    const i = INSTRUMENTS[sel.value];
    $('#cSymbol').value = sel.value === 'CUSTOM' ? '' : sel.value;
    $('#cContract').value = i.contract;
    $('#cPoint').value = i.tick;
    $('#cLeverage').value = i.leverage;
    runCalc();
  };
  $('#cSymbol').value = 'XAUUSD';
}

function runCalc() {
  const box = $('#cResult'); if (!box) return;
  const stopMode = $('#cStopMode').value;
  $('#cStopLabel').firstChild.textContent = stopMode === 'points' ? 'Стоп, пунктов' : 'Цена стоп-лосса';
  $('#cRiskLabel').firstChild.textContent = $('#cRiskMode').value === 'money' ? 'Риск, USD' : 'Риск, %';

  const stopValue = $('#cStop').value;
  const r = calculatePosition({
    balance: $('#cBalance').value,
    riskMode: $('#cRiskMode').value,
    riskValue: $('#cRisk').value,
    entry: $('#cEntry').value,
    stop: stopMode === 'price' ? stopValue : null,
    stopPoints: stopMode === 'points' ? stopValue : null,
    stopMode,
    pointSize: $('#cPoint').value,
    contract: $('#cContract').value,
    leverage: $('#cLeverage').value,
    lotStep: $('#cLotStep').value,
    minLot: $('#cLotStep').value,
    targetR: $('#cTarget').value,
    side: $('#cSide').value
  });
  const unit = INSTRUMENTS[$('#cInstrument').value]?.unit ?? 'единиц';

  if (!r.ok && !r.lots) {
    box.innerHTML = `<h3>Результат</h3>${r.errors.map(e => `<p class="error">${esc(e)}</p>`).join('')}`;
    return;
  }
  const row = (label, value, hint) => `<div class="fx-row"><span>${label}</span><div><strong>${value}</strong>${hint ? `<small>${hint}</small>` : ''}</div></div>`;
  box.innerHTML = `<h3>Результат</h3>
    ${row('Сумма риска', money(r.riskMoney), `${num(r.riskPercent, 2)}% от баланса`)}
    ${row('Стоп', num(r.stopDistance, 5) + ' в цене', `${num(r.stopPoints, 0)} пунктов${r.stopPrice != null ? ' · стоп ' + num(r.stopPrice, 5) : ''}`)}
    ${row('Цена стопа на 1 лот', money(r.lossPerLot), 'стоп × размер контракта')}
    ${row('Сколько лотов открыть', `${num(r.lots, 4)}`, 'это число вводишь в терминале')}
    ${row('Объём позиции', `${num(r.units, 4)} ${esc(unit)}`, `точный расчёт ${num(r.exactLots, 4)} лота`)}
    ${row('Реальный убыток по стопу', money(r.realRisk), 'с учётом округления лота')}
    ${row('Стоимость пункта', money(r.pointValuePosition) + ' на позицию', `${money(r.pointValuePerLot)} на 1 стандартный лот`)}
    ${r.notional != null ? row('Номинал позиции', money(r.notional), 'объём × цена входа') : ''}
    ${r.margin != null ? row('Нужно маржи', money(r.margin), `${num(r.marginPercent, 1)}% депозита · максимум по марже ≈ ${num(r.maxLotsByMargin, 2)} лота`) : ''}
    ${r.targetPrice != null ? row(`Цель при ${num(r.targetR, 2)}R`, num(r.targetPrice, 5), `потенциал ${money(r.targetMoney)}`) : ''}
    ${r.errors.map(e => `<p class="error">${esc(e)}</p>`).join('')}
    ${r.notes.map(n => `<p class="small muted">⚠️ ${esc(n)}</p>`).join('')}
    <div class="row"><button id="cCopy">Скопировать расчёт</button></div>`;

  $('#cCopy').onclick = () => {
    const text = `${$('#cSymbol').value} ${r.side}\nРиск ${r.riskMoney}$ · стоп ${r.stopDistance} (${r.stopPoints} п.)\nОбъём ${r.lots} лота (${r.units} ${unit})\nМаржа ${r.margin ?? '—'}$ · номинал ${r.notional ?? '—'}$`;
    navigator.clipboard?.writeText(text);
  };
}

/* ============================================================
   СОБЫТИЯ
   ============================================================ */
function wire() {
  $('#tzToggle').onclick = () => { showLocal = !showLocal; renderSessions() };
  $('#newsRefresh').onclick = loadNews;
  $('#newIdea').onclick = () => openPostDialog('idea');
  $('#shareWin').onclick = () => openPostDialog('win');
  $('#ideaSearch').oninput = e => { ideaQuery = e.target.value; renderIdeas() };
  $('#ideaFilters').onclick = e => {
    const b = e.target.closest('button[data-status]'); if (!b) return;
    ideaFilter = b.dataset.status; renderIdeas();
  };

  document.addEventListener('click', async e => {
    const react = e.target.closest('.fx-react[data-emoji]');
    if (react) {
      const id = react.closest('.fx-reactions')?.dataset.post;
      try { const d = await api('posts/react', 'POST', {id, emoji: react.dataset.emoji}); posts = d.posts; renderIdeas(); renderWins() }
      catch (err) { alert(err.message) }
      return;
    }
    const plus = e.target.closest('.fx-plus');
    if (plus) { plus.parentElement.classList.toggle('is-open'); return }
    const del = e.target.closest('.fx-del');
    if (del) {
      const id = del.closest('.fx-card')?.dataset.id;
      if (!confirm('Удалить идею?')) return;
      const d = await api('posts/delete', 'POST', {id}); posts = d.posts; renderIdeas(); renderWins();
    }
  });
  document.addEventListener('change', async e => {
    if (e.target.classList?.contains('fx-status-set')) {
      const id = e.target.closest('.fx-card')?.dataset.id;
      try { const d = await api('posts/status', 'POST', {id, status: e.target.value}); posts = d.posts; renderIdeas() }
      catch (err) { alert(err.message) }
    }
  });

  $('#chatForm').addEventListener('submit', async e => {
    e.preventDefault();
    const input = $('#chatText');
    const text = input.value.trim();
    if (!text) return;
    let trade = null;
    if ($('#chatAttach').checked) {
      const trades = journalCache?.trades ?? [];
      const last = [...trades].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
      if (last) trade = {symbol: last.symbol, side: last.side, rr: last.rr, risk: last.risk};
    }
    input.disabled = true;
    try { const d = await api('chat', 'POST', {text, trade}); input.value = ''; renderChat(d.messages) }
    catch (err) { alert(err.message) }
    finally { input.disabled = false; input.focus() }
  });

  ['#cBalance', '#cRisk', '#cEntry', '#cStop', '#cTarget', '#cContract', '#cPoint', '#cLeverage', '#cLotStep']
    .forEach(s => { $(s).oninput = runCalc });
  ['#cRiskMode', '#cStopMode', '#cSide'].forEach(s => { $(s).onchange = runCalc });
  $('#cRun').onclick = runCalc;
  $('#cReset').onclick = () => {
    $('#cInstrument').value = 'XAUUSD'; $('#cInstrument').dispatchEvent(new Event('change'));
    $('#cBalance').value = 10000; $('#cRisk').value = 1; $('#cEntry').value = 4400; $('#cStop').value = 4200; $('#cTarget').value = 3;
    runCalc();
  };
}

/* ============================================================
   КАЛЕНДАРЬ FOREX FACTORY
   ============================================================ */
const IMPACT = {high: {ru: 'Высокая', cls: 'i-high'}, medium: {ru: 'Средняя', cls: 'i-med'},
  low: {ru: 'Низкая', cls: 'i-low'}, holiday: {ru: 'Выходной', cls: 'i-hol'}};
let calEvents = [], calFilter = 'today';
const CAL_FILTERS = [{id: 'today', label: 'Сегодня'}, {id: 'high', label: 'Только важные'}, {id: 'week', label: 'Вся неделя'}];

function renderCalFilters() {
  const box = $('#calFilters');
  if (!box) return;
  box.innerHTML = '';
  CAL_FILTERS.forEach(f => {
    const b = el('button', 'fx-chip' + (f.id === calFilter ? ' is-active' : ''), esc(T(f.label)));
    b.onclick = () => { calFilter = f.id; renderCalFilters(); renderCalendar() };
    box.append(b);
  });
}

function renderCalendar() {
  const box = $('#calList');
  if (!box) return;
  const today = new Date().toDateString();
  let items = calEvents;
  if (calFilter === 'today') items = items.filter(e => e.time && new Date(e.time).toDateString() === today);
  if (calFilter === 'high') items = items.filter(e => e.impact === 'high');
  if (!items.length) { box.innerHTML = `<p class="muted small">${esc(T('Нет событий по этому фильтру.'))}</p>`; return }
  box.innerHTML = items.slice(0, 40).map(e => {
    const t = e.time ? new Intl.DateTimeFormat('ru-RU', {weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false}).format(new Date(e.time)) : '—';
    const im = IMPACT[e.impact] || IMPACT.low;
    return `<div class="fx-cal-row ${im.cls}">
      <span class="fx-cal-time">${esc(t)}</span>
      <span class="fx-cal-cur">${esc(e.country)}</span>
      <span class="fx-cal-title">${esc(e.title)}</span>
      <span class="fx-cal-nums">${e.actual ? `<b>${esc(e.actual)}</b>` : ''}${e.forecast ? `<i>прогноз ${esc(e.forecast)}</i>` : ''}${e.previous ? `<i>было ${esc(e.previous)}</i>` : ''}</span>
    </div>`;
  }).join('');
}

async function loadCalendar() {
  const box = $('#calList');
  if (!box) return;
  try {
    const d = await api('calendar');
    calEvents = d.events || [];
    renderCalFilters();
    renderCalendar();
  } catch (e) { box.innerHTML = `<p class="error">${esc(e.message)}</p>` }
}

/* ============================================================
   ЯЗЫКИ: РУ / УЗБ / АНГЛ / УКР
   Перевод работает по словарю русских надписей: меняются
   только те тексты, которые совпали целиком — данные пользователя не трогаем.
   ============================================================ */
const LANGS = [{id: 'ru', label: 'РУ'}, {id: 'uz', label: 'UZB'}, {id: 'en', label: 'ENG'}, {id: 'uk', label: 'УКР'}];
const DICT = {
  'Обзор': {uz: 'Umumiy', en: 'Overview', uk: 'Огляд'},
  'Сделки': {uz: 'Bitimlar', en: 'Trades', uk: 'Угоди'},
  'Калькулятор': {uz: 'Kalkulyator', en: 'Calculator', uk: 'Калькулятор'},
  'ИИ-помощник': {uz: 'AI yordamchi', en: 'AI assistant', uk: 'ШІ-помічник'},
  'Аккаунт': {uz: 'Hisob', en: 'Account', uk: 'Акаунт'},
  'Рынок': {uz: 'Bozor', en: 'Market', uk: 'Ринок'},
  'Идеи': {uz: 'Gʻoyalar', en: 'Ideas', uk: 'Ідеї'},
  'Чат': {uz: 'Chat', en: 'Chat', uk: 'Чат'},
  'Выйти': {uz: 'Chiqish', en: 'Log out', uk: 'Вийти'},
  '+ Новая сделка': {uz: '+ Yangi bitim', en: '+ New trade', uk: '+ Нова угода'},
  'Геополитика и рынок': {uz: 'Geosiyosat va bozor', en: 'Geopolitics & markets', uk: 'Геополітика і ринок'},
  'Металлы, валюты, индексы и события, которые их двигают.':
    {uz: 'Metall, valyuta, indekslar va ularni harakatga soluvchi voqealar.', en: 'Metals, currencies, indices and the events that move them.', uk: 'Метали, валюти, індекси та події, які їх рухають.'},
  'Прямой эфир': {uz: 'Jonli efir', en: 'Live', uk: 'Прямий ефір'},
  'Обновить': {uz: 'Yangilash', en: 'Refresh', uk: 'Оновити'},
  'Время работы рынка': {uz: 'Bozor ish vaqti', en: 'Market hours', uk: 'Час роботи ринку'},
  'Ваше время': {uz: 'Sizning vaqt', en: 'Your time', uk: 'Ваш час'},
  'Календарь Forex Factory': {uz: 'Forex Factory taqvimi', en: 'Forex Factory calendar', uk: 'Календар Forex Factory'},
  'События недели в твоём часовом поясе. Красные — высокая важность.':
    {uz: 'Haftalik voqealar sizning vaqt mintaqangizda. Qizil — yuqori ahamiyat.', en: 'This week\u2019s events in your timezone. Red means high impact.', uk: 'Події тижня у твоєму часовому поясі. Червоні — висока важливість.'},
  'Сегодня': {uz: 'Bugun', en: 'Today', uk: 'Сьогодні'},
  'Только важные': {uz: 'Faqat muhim', en: 'High impact', uk: 'Лише важливі'},
  'Вся неделя': {uz: 'Butun hafta', en: 'Whole week', uk: 'Увесь тиждень'},
  'Призрачный Счёт': {uz: 'Sharpa reyting', en: 'Ghost Score', uk: 'Привидний Рахунок'},
  'Консистенция': {uz: 'Barqarorlik', en: 'Consistency', uk: 'Консистентність'},
  'Риск дисциплины': {uz: 'Risk intizomi', en: 'Risk discipline', uk: 'Ризик-дисципліна'},
  'Соотношение риска и прибыли': {uz: 'Risk/foyda nisbati', en: 'Risk / reward', uk: 'Співвідношення ризику та прибутку'},
  'Коэффициент выигрыша': {uz: 'Yutuq koeffitsienti', en: 'Win rate', uk: 'Коефіцієнт виграшу'},
  'Поделиться результатом': {uz: 'Natijani ulashish', en: 'Share result', uk: 'Поділитися результатом'},
  'Что трейдеры закрыли сегодня.': {uz: 'Treyderlar bugun nimani yopdi.', en: 'What traders closed today.', uk: 'Що трейдери закрили сьогодні.'},
  'Идеи трейдеров.': {uz: 'Treyderlar gʻoyalari.', en: 'Trader ideas.', uk: 'Ідеї трейдерів.'},
  '+ Новая идея': {uz: '+ Yangi gʻoya', en: '+ New idea', uk: '+ Нова ідея'},
  'Чат трейдеров': {uz: 'Treyderlar chati', en: 'Traders chat', uk: 'Чат трейдерів'},
  'Общая комната. Можно прикрепить карточку своей сделки.':
    {uz: 'Umumiy xona. Bitim kartasini biriktirish mumkin.', en: 'Shared room. You can attach your trade card.', uk: 'Спільна кімната. Можна прикріпити картку угоди.'},
  'Отправить': {uz: 'Yuborish', en: 'Send', uk: 'Надіслати'},
  'Онлайн': {uz: 'Onlayn', en: 'Online', uk: 'Онлайн'},
  'Калькулятор размера позиции': {uz: 'Pozitsiya hajmi kalkulyatori', en: 'Position size calculator', uk: 'Калькулятор розміру позиції'},
  'Вычислить': {uz: 'Hisoblash', en: 'Calculate', uk: 'Обчислити'},
  'Сбросить': {uz: 'Tozalash', en: 'Reset', uk: 'Скинути'},
  'Нет событий по этому фильтру.': {uz: 'Bu filtr boʻyicha voqea yoʻq.', en: 'No events for this filter.', uk: 'Немає подій за цим фільтром.'},
  'Язык': {uz: 'Til', en: 'Language', uk: 'Мова'}
};
let lang = localStorage.getItem('fizy-lang') || 'ru';
const T = s => (lang === 'ru' ? s : (DICT[s]?.[lang] || s));

function applyLang() {
  document.documentElement.lang = lang;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(n => {
    const parent = n.parentElement;
    if (!parent || parent.closest('#newsList, #chatLog, #ideaList, #winFeed, #calList, script, style')) return;
    const raw = (n.fxSource ??= n.nodeValue);
    const key = raw.trim();
    if (!key || !DICT[key]) return;
    const value = lang === 'ru' ? key : DICT[key][lang] || key;
    n.nodeValue = raw.replace(key, value);
  });
  document.querySelectorAll('[placeholder]').forEach(i => {
    const raw = (i.dataset.fxPh ??= i.placeholder);
    i.placeholder = lang === 'ru' ? raw : (DICT[raw]?.[lang] || raw);
  });
  renderCalFilters();
  renderNewsFilters();
}

function langPicker(compact) {
  const box = el('div', 'fx-lang' + (compact ? ' is-compact' : ''));
  LANGS.forEach(l => {
    const b = el('button', 'fx-lang-btn' + (l.id === lang ? ' is-active' : ''), esc(l.label));
    b.type = 'button';
    b.onclick = () => {
      lang = l.id;
      localStorage.setItem('fizy-lang', lang);
      document.querySelectorAll('.fx-lang-btn').forEach(x => x.classList.toggle('is-active', x.textContent === l.label));
      applyLang();
    };
    box.append(b);
  });
  return box;
}

/* ============================================================
   ШАПКА И АККАУНТ: переключатель языка и круглый аватар
   ============================================================ */
const initials = name => String(name || '?').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase();
const avatarColor = name => {
  let h = 0;
  for (const ch of String(name || 'fizy')) h = (h * 31 + ch.codePointAt(0)) % 360;
  return `hsl(${h} 55% 42%)`;
};

function injectHeader() {
  const actions = document.querySelector('.header-actions');
  if (!actions || actions.querySelector('.fx-lang')) return;
  actions.prepend(langPicker(true));
}

function injectAccountCard() {
  const view = $('#accountView') || document.querySelector('[id*="account" i].app-view');
  if (!view || view.querySelector('.fx-profile')) return;
  const card = el('div', 'panel fx-profile');
  card.innerHTML = `
    <div class="fx-avatar" id="fxAvatar"></div>
    <div class="fx-profile-body">
      <h2 id="fxProfileName">—</h2>
      <p class="muted small" id="fxProfileMeta">Личный кабинет трейдера</p>
      <div class="fx-profile-stats" id="fxProfileStats"></div>
      <div class="fx-profile-lang"><span class="small muted">Язык</span></div>
    </div>`;
  view.prepend(card);
  card.querySelector('.fx-profile-lang').append(langPicker(false));
  refreshProfile();
}

function refreshProfile() {
  const av = $('#fxAvatar');
  if (!av) return;
  const name = me || document.querySelector('#username')?.textContent?.trim() || 'Трейдер';
  av.textContent = initials(name);
  av.style.background = avatarColor(name);
  $('#fxProfileName').textContent = name;
  const trades = journalCache?.trades ?? [];
  const wins = trades.filter(t => (t.pnl ?? t.rr ?? 0) > 0).length;
  const stats = [
    ['Сделок', trades.length],
    ['Плюсовых', wins],
    ['Винрейт', trades.length ? Math.round(wins / trades.length * 100) + '%' : '—']
  ];
  $('#fxProfileStats').innerHTML = stats.map(([k, v]) => `<div><span>${esc(k)}</span><strong>${esc(String(v))}</strong></div>`).join('');
}

async function boot() {
  mount();
  if (!$('#marketView')) return;
  fillInstruments();
  wire();
  renderSessions();
  setInterval(renderSessions, 30000);
  renderCalFilters();
  runCalc();
  injectHeader();
  injectAccountCard();
  applyLang();
  setInterval(dropOldCalcTab, 1500);
  try { const m = await api('me'); me = m.user?.username; csrf = m.csrf } catch {}
  if (me) { loadNews(); loadCalendar(); loadPosts(); refreshGhost(); refreshProfile() }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

// если вход произошёл позже — подхватываем сессию
new MutationObserver(async () => {
  const ws = $('#workspace');
  if (ws && !ws.hidden && !me) {
    try {
      const m = await api('me'); me = m.user?.username; csrf = m.csrf;
      injectHeader(); injectAccountCard(); applyLang(); dropOldCalcTab();
      loadNews(); loadCalendar(); loadPosts(); refreshGhost(); refreshProfile();
    } catch {}
  }
}).observe(document.documentElement, {attributes: true, subtree: true, attributeFilter: ['hidden']});
