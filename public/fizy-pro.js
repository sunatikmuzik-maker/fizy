// FIZY Journal PRO — аналитика журнала, теги ошибок, ссылка на график,
// риск-менеджер и рейтинг трейдеров по дисциплине.
// Модуль самостоятельный: не зависит от app.js и fizy-extras.js.

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const money = v => new Intl.NumberFormat('ru-RU', {style: 'currency', currency: 'USD', maximumFractionDigits: 2}).format(v || 0);
const num = (v, d = 2) => new Intl.NumberFormat('ru-RU', {maximumFractionDigits: d}).format(Number.isFinite(v) ? v : 0);
const pct = v => num(v * 100, 1) + '%';

let csrf = '';
let journal = null;      // последний загруженный журнал
let revision = 0;
let snapshot = new Map(); // состояние сделок перед сохранением формы

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

/* ============================================================
   ТЕГИ ОШИБОК И ЭМОЦИЙ
   ============================================================ */
const TAGS = [
  {id: 'plan', label: 'По плану', good: true},
  {id: 'fomo', label: 'FOMO / догонял'},
  {id: 'revenge', label: 'Отыгрывался'},
  {id: 'nosignal', label: 'Вход без сигнала'},
  {id: 'movedstop', label: 'Перенёс стоп'},
  {id: 'held', label: 'Передержал'},
  {id: 'early', label: 'Вышел рано'},
  {id: 'average', label: 'Усреднял'},
  {id: 'oversize', label: 'Завысил объём'},
  {id: 'news', label: 'Торговал на новостях'},
  {id: 'tired', label: 'Устал / не выспался'},
  {id: 'tilt', label: 'Тильт'}
];
const tagLabel = id => TAGS.find(t => t.id === id)?.label || id;

/* ============================================================
   РАЗМЕТКА НОВЫХ РАЗДЕЛОВ
   ============================================================ */
const MARKUP = `
<section id="statsView" class="app-view fx-view" hidden>
  <div class="panel fxp-risk" id="riskPanel">
    <div class="section-head">
      <div><h2>Риск-менеджер</h2><p class="muted small">Лимиты считаются по журналу за сегодня.</p></div>
      <span class="fxp-risk-state" id="riskState">—</span>
    </div>
    <div class="fxp-risk-grid">
      <label>Риск на сделку, %<input id="riskPerTrade" type="number" min="0.1" max="10" step="0.1"></label>
      <label>Сделок в день, макс.<input id="riskMaxTrades" type="number" min="1" max="50" step="1"></label>
      <label>Дневной убыток, USD<input id="riskMaxLoss" type="number" min="1" max="1000000" step="1"></label>
      <label>Дневной убыток, %<input id="riskMaxLossPct" type="number" min="0.1" max="50" step="0.1"></label>
    </div>
    <div id="riskToday" class="fxp-risk-today"></div>
  </div>

  <div class="panel">
    <div class="section-head">
      <div><h2>Кривая результата</h2><p class="muted small" id="equitySub">Накопленный результат по закрытым сделкам.</p></div>
      <div class="fxp-filters" id="periodFilters"></div>
    </div>
    <div class="fxp-chart" id="equityChart"></div>
    <div class="fxp-metrics" id="metrics"></div>
  </div>

  <div class="fxp-two">
    <div class="panel">
      <div class="section-head"><div><h2>Где вы теряете</h2><p class="muted small">Разрезы журнала: находим утечку.</p></div>
      <div class="fxp-filters" id="breakFilters"></div></div>
      <div id="breakTable" class="fxp-table"></div>
    </div>
    <div class="panel">
      <div class="section-head"><div><h2>Ошибки и эмоции</h2><p class="muted small">Сколько стоила каждая пометка.</p></div></div>
      <div id="tagTable" class="fxp-table"></div>
    </div>
  </div>

  <div class="fxp-two">
    <div class="panel">
      <div class="section-head"><div><h2>Чек-лист против эмоций</h2><p class="muted small">Сравнение сделок по дисциплине.</p></div></div>
      <div id="checkTable" class="fxp-table"></div>
    </div>
    <div class="panel">
      <div class="section-head"><div><h2>Отчёт и выгрузка</h2><p class="muted small">Сводка за период и резервная копия.</p></div></div>
      <div id="reportBox" class="fxp-report"></div>
      <div class="row fxp-export">
        <button id="exportCsv" class="primary">Скачать CSV</button>
        <button id="exportJson">Резервная копия JSON</button>
        <button id="copyReport">Копировать отчёт</button>
      </div>
    </div>
  </div>
</section>

<section id="ratingView" class="app-view fx-view" hidden>
  <div class="panel fxp-hero">
    <div>
      <div class="eyebrow">РЕЙТИНГ ДИСЦИПЛИНЫ</div>
      <h2>Не кто больше заработал, а кто лучше держит правила.</h2>
      <p class="muted">Считаем чек-лист, соблюдение риска, регулярность и серию дней без нарушений. Сделки и суммы остаются приватными — в рейтинг уходят только эти показатели.</p>
      <button id="ratingPush" class="primary">Обновить мой результат</button>
      <p class="small muted" id="ratingHint"></p>
    </div>
    <div class="fxp-myscore">
      <div class="fxp-ring" id="ratingRing" style="--deg:0deg"><span id="ratingScore">—</span></div>
      <p class="small muted" id="ratingPlace">Место не определено</p>
    </div>
  </div>
  <div class="panel">
    <div class="section-head"><div><h2>Топ трейдеров</h2><p class="muted small">Обновляется, когда участники присылают свои показатели.</p></div></div>
    <div id="ratingList" class="fxp-table"></div>
  </div>
</section>`;

const TABS = [{view: 'statsView', label: 'Аналитика'}, {view: 'ratingView', label: 'Рейтинг'}];
const OUR = TABS.map(t => t.view);

function mount() {
  const workspace = $('#workspace') || $('main');
  if (!workspace || $('#statsView')) return;
  const holder = el('div', 'fxp-mount');
  holder.innerHTML = MARKUP;
  workspace.append(...holder.children);

  const nav = $('.workspace-tabs');
  if (!nav) return;
  ensureTabs();
  new MutationObserver(ensureTabs).observe(nav, {childList: true});
  nav.addEventListener('click', e => {
    const btn = e.target.closest('button[data-view]');
    if (!btn) return;
    const view = btn.dataset.view;
    if (OUR.includes(view)) {
      $$('.app-view').forEach(s => { s.hidden = true });
      nav.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      $('#' + view).hidden = false;
      onOpen(view);
    } else {
      OUR.forEach(v => { const s = $('#' + v); if (s) s.hidden = true });
    }
  });
}

function ensureTabs() {
  const nav = $('.workspace-tabs');
  if (!nav) return;
  TABS.forEach(t => {
    if (nav.querySelector(`button.fxp-tab[data-view="${t.view}"]`)) return;
    const b = el('button', 'fxp-tab', esc(t.label));
    b.dataset.view = t.view;
    // ставим сразу после вкладки «Сделки», если она есть
    const after = nav.querySelector('button[data-view="tradesView"]');
    if (after && t.view === 'statsView') after.after(b); else nav.append(b);
  });
}

async function onOpen(view) {
  await loadJournal();
  if (view === 'statsView') renderStats();
  if (view === 'ratingView') loadRating();
}

/* ============================================================
   ЖУРНАЛ
   ============================================================ */
async function loadJournal() {
  try {
    const d = await api('journal');
    journal = d.journal || {trades: [], rules: []};
    revision = d.revision ?? 0;
  } catch { journal = journal || {trades: [], rules: []} }
  return journal;
}

const trades = () => (journal?.trades ?? []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
const closed = list => list.filter(t => Number.isFinite(t.pnl));

/* ============================================================
   ССЫЛКА НА ГРАФИК И ТЕГИ В ФОРМЕ СДЕЛКИ
   ============================================================ */
function injectTradeFields() {
  const form = $('#tradeForm');
  if (!form || form.querySelector('#fxpLink')) return;
  const grid = form.querySelector('.grid') || form;

  const linkLabel = el('label', 'wide');
  linkLabel.innerHTML = `Ссылка на график
    <input id="fxpLink" type="url" maxlength="500" placeholder="https://www.tradingview.com/x/...">
    <span class="field-hint">Скриншот из TradingView (кнопка «Снимок» → «Копировать ссылку») или любой другой адрес разбора.</span>`;
  grid.append(linkLabel);

  const tagLabelBox = el('label', 'wide');
  tagLabelBox.innerHTML = `Что произошло в сделке
    <div class="fxp-tags" id="fxpTags">${TAGS.map(t =>
      `<button type="button" class="fxp-tag${t.good ? ' is-good' : ''}" data-tag="${t.id}">${esc(t.label)}</button>`).join('')}</div>
    <span class="field-hint">Отмечай честно — раздел «Аналитика» покажет, сколько денег стоит каждая привычка.</span>`;
  grid.append(tagLabelBox);

  tagLabelBox.querySelector('#fxpTags').addEventListener('click', e => {
    const b = e.target.closest('.fxp-tag');
    if (b) b.classList.toggle('is-on');
  });

  // перед сохранением запоминаем состояние журнала, чтобы найти нужную сделку после записи
  form.addEventListener('submit', () => {
    const link = $('#fxpLink')?.value.trim() || '';
    const tags = $$('#fxpTags .fxp-tag.is-on').map(b => b.dataset.tag);
    snapshot = new Map(trades().map(t => [t.id, JSON.stringify({
      symbol: t.symbol, date: t.date, side: t.side, risk: t.risk, rr: t.rr, pnl: t.pnl, notes: t.notes
    })]));
    setTimeout(() => saveExtras(link, tags), 1200);
  }, true);
}

// Находит только что созданную или изменённую сделку и дописывает ссылку с тегами.
async function saveExtras(link, tags) {
  if (!link && !tags.length) { await loadJournal(); return }
  try {
    const d = await api('journal');
    const list = d.journal?.trades ?? [];
    let target = list.find(t => !snapshot.has(t.id));
    if (!target) {
      target = list.find(t => snapshot.get(t.id) !== JSON.stringify({
        symbol: t.symbol, date: t.date, side: t.side, risk: t.risk, rr: t.rr, pnl: t.pnl, notes: t.notes
      }));
    }
    if (!target) return;
    const safe = /^https?:\/\//i.test(link) ? link.slice(0, 500) : '';
    const next = {
      ...d.journal,
      trades: list.map(t => t.id === target.id ? {...t, link: safe, tags: tags.slice(0, 12)} : t)
    };
    await api('journal', 'PUT', {journal: next, revision: d.revision});
    journal = next;
    revision = (d.revision ?? 0) + 1;
    decorateTradeCards();
  } catch {}
}

// Заполняет форму, когда пользователь открыл сделку на редактирование.
function prefillForm() {
  const form = $('#tradeForm');
  if (!form || !$('#fxpLink')) return;
  const title = ($('#tradeTitle')?.textContent || '').toLowerCase();
  const editing = !title.includes('нов');
  let trade = null;
  if (editing) {
    const symbol = form.elements.symbol?.value?.trim();
    const date = form.elements.date?.value || '';
    trade = trades().find(t => t.symbol === symbol && String(t.date).slice(0, 16) === date.slice(0, 16));
  }
  $('#fxpLink').value = trade?.link || '';
  $$('#fxpTags .fxp-tag').forEach(b => b.classList.toggle('is-on', !!trade?.tags?.includes(b.dataset.tag)));
}

// Добавляет ссылку и теги в карточки раздела «Сделки».
function decorateTradeCards() {
  const map = new Map(trades().map(t => [t.id, t]));
  $$('[data-edit]').forEach(btn => {
    const card = btn.closest('article, li, div.trade, .panel');
    const t = map.get(btn.dataset.edit);
    if (!card || !t) return;
    card.querySelector('.fxp-card-extra')?.remove();
    if (!t.link && !t.tags?.length) return;
    const box = el('div', 'fxp-card-extra');
    box.innerHTML = [
      t.link ? `<a class="fxp-chart-link" href="${esc(t.link)}" target="_blank" rel="noopener nofollow">Смотреть график</a>` : '',
      (t.tags || []).map(x => `<span class="fxp-chip${TAGS.find(v => v.id === x)?.good ? ' is-good' : ''}">${esc(tagLabel(x))}</span>`).join('')
    ].join('');
    (btn.closest('.trade-actions') || card).before(box);
  });
}

/* ============================================================
   РИСК-МЕНЕДЖЕР
   ============================================================ */
const RISK_DEFAULT = {perTrade: 1, maxTrades: 3, maxLoss: 300, maxLossPct: 3};
const riskRead = () => {
  try { return {...RISK_DEFAULT, ...JSON.parse(localStorage.getItem('fizy-risk') || '{}')} }
  catch { return {...RISK_DEFAULT} }
};
const riskWrite = v => { try { localStorage.setItem('fizy-risk', JSON.stringify(v)) } catch {} };

function todayStats() {
  const day = new Date().toISOString().slice(0, 10);
  const local = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const list = trades().filter(t => String(t.date).slice(0, 10) === local || String(t.date).slice(0, 10) === day);
  const pnl = list.reduce((s, t) => s + (Number.isFinite(t.pnl) ? t.pnl : 0), 0);
  const over = list.filter(t => Number(t.risk) > riskRead().perTrade).length;
  return {list, pnl, over};
}

function renderRisk() {
  const cfg = riskRead();
  $('#riskPerTrade').value = cfg.perTrade;
  $('#riskMaxTrades').value = cfg.maxTrades;
  $('#riskMaxLoss').value = cfg.maxLoss;
  $('#riskMaxLossPct').value = cfg.maxLossPct;

  const {list, pnl, over} = todayStats();
  const stopByLoss = pnl <= -Math.abs(cfg.maxLoss);
  const stopByCount = list.length >= cfg.maxTrades;
  const state = $('#riskState');
  const panel = $('#riskPanel');
  panel.classList.toggle('is-stop', stopByLoss || stopByCount);
  panel.classList.toggle('is-warn', !stopByLoss && !stopByCount && (over > 0 || pnl < 0));
  state.textContent = stopByLoss ? 'СТОП НА СЕГОДНЯ' : stopByCount ? 'Лимит сделок исчерпан' : over ? 'Риск превышен' : 'В пределах плана';

  $('#riskToday').innerHTML = `
    <div><span>Сделок сегодня</span><strong>${list.length} / ${cfg.maxTrades}</strong></div>
    <div><span>Результат дня</span><strong class="${pnl < 0 ? 'is-neg' : 'is-pos'}">${money(pnl)}</strong></div>
    <div><span>Лимит убытка</span><strong>${money(-Math.abs(cfg.maxLoss))}</strong></div>
    <div><span>Сделок с превышением риска</span><strong>${over}</strong></div>
    ${stopByLoss || stopByCount ? `<p class="fxp-stop-note">Дневной лимит достигнут. Лучшее решение сейчас — закрыть терминал и разобрать сделки, а не искать отыгрыш.</p>` : ''}`;
}

function wireRisk() {
  const save = () => {
    riskWrite({
      perTrade: Number($('#riskPerTrade').value) || RISK_DEFAULT.perTrade,
      maxTrades: Number($('#riskMaxTrades').value) || RISK_DEFAULT.maxTrades,
      maxLoss: Number($('#riskMaxLoss').value) || RISK_DEFAULT.maxLoss,
      maxLossPct: Number($('#riskMaxLossPct').value) || RISK_DEFAULT.maxLossPct
    });
    renderRisk();
  };
  ['#riskPerTrade', '#riskMaxTrades', '#riskMaxLoss', '#riskMaxLossPct'].forEach(s => { const n = $(s); if (n) n.onchange = save });
}

/* ============================================================
   АНАЛИТИКА
   ============================================================ */
const PERIODS = [{id: 'all', label: 'Всё время'}, {id: '30', label: '30 дней'}, {id: '7', label: 'Неделя'}, {id: 'month', label: 'Этот месяц'}];
const BREAKS = [
  {id: 'symbol', label: 'Инструмент'},
  {id: 'weekday', label: 'День недели'},
  {id: 'hour', label: 'Час входа'},
  {id: 'session', label: 'Сессия'},
  {id: 'side', label: 'Long / Short'},
  {id: 'model', label: 'Модель'}
];
let period = 'all', breakBy = 'symbol';

const WEEK = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
function sessionOf(date) {
  const h = new Date(date).getUTCHours();
  if (h >= 23 || h < 6) return 'Азия / Сидней';
  if (h < 11) return 'Азия + Лондон';
  if (h < 15) return 'Лондон';
  if (h < 20) return 'Лондон + Нью-Йорк';
  return 'Нью-Йорк';
}

function inPeriod(t) {
  const d = new Date(t.date);
  if (period === 'all') return true;
  if (period === 'month') { const n = new Date(); return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear() }
  return Date.now() - d.getTime() <= Number(period) * 86400000;
}

function aggregate(list) {
  const done = closed(list);
  const wins = done.filter(t => t.pnl > 0), losses = done.filter(t => t.pnl < 0);
  const sum = a => a.reduce((s, t) => s + t.pnl, 0);
  const grossWin = sum(wins), grossLoss = Math.abs(sum(losses));
  const avgWin = wins.length ? grossWin / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const winrate = done.length ? wins.length / done.length : 0;
  const rrs = list.map(t => Number(t.rr)).filter(Number.isFinite);
  const risks = list.map(t => Number(t.risk)).filter(Number.isFinite);
  const checkRatio = (() => {
    const c = list.filter(t => Array.isArray(t.checks) && t.checks.length);
    return c.length ? c.reduce((s, t) => s + t.checks.filter(Boolean).length / t.checks.length, 0) / c.length : 0;
  })();
  return {
    count: list.length, done: done.length, net: sum(done), winrate,
    profitFactor: grossLoss ? grossWin / grossLoss : (grossWin ? Infinity : 0),
    expectancy: done.length ? sum(done) / done.length : 0,
    avgWin, avgLoss,
    payoff: avgLoss ? avgWin / avgLoss : (avgWin ? Infinity : 0),
    best: done.length ? Math.max(...done.map(t => t.pnl)) : 0,
    worst: done.length ? Math.min(...done.map(t => t.pnl)) : 0,
    avgRR: rrs.length ? rrs.reduce((a, b) => a + b, 0) / rrs.length : 0,
    avgRisk: risks.length ? risks.reduce((a, b) => a + b, 0) / risks.length : 0,
    days: new Set(list.map(t => String(t.date).slice(0, 10))).size,
    checkRatio
  };
}

function drawdown(done) {
  let peak = 0, eq = 0, max = 0;
  done.forEach(t => { eq += t.pnl; peak = Math.max(peak, eq); max = Math.max(max, peak - eq) });
  return max;
}

function equitySvg(done) {
  if (done.length < 2) return `<p class="muted small">Нужно минимум две закрытые сделки с результатом в USD, чтобы построить кривую.</p>`;
  let eq = 0;
  const pts = done.map(t => (eq += t.pnl));
  const min = Math.min(0, ...pts), max = Math.max(0, ...pts);
  const span = (max - min) || 1;
  const W = 700, H = 220, pad = 8;
  const x = i => pad + i * (W - pad * 2) / (pts.length - 1);
  const y = v => pad + (max - v) * (H - pad * 2) / span;
  const line = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${y(min).toFixed(1)} L${x(0).toFixed(1)},${y(min).toFixed(1)} Z`;
  const last = pts[pts.length - 1];
  const color = last >= 0 ? '#16a34a' : '#dc2626';
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Кривая результата">
    <line x1="${pad}" x2="${W - pad}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" class="fxp-zero" />
    <path d="${area}" fill="${color}" opacity=".12" />
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" />
    <circle cx="${x(pts.length - 1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="4" fill="${color}" />
  </svg>`;
}

function renderStats() {
  renderRisk();
  const list = trades().filter(inPeriod);
  const done = closed(list);
  const a = aggregate(list);
  const dd = drawdown(done);

  $('#periodFilters').innerHTML = PERIODS.map(p =>
    `<button class="fxp-pill${period === p.id ? ' is-on' : ''}" data-period="${p.id}">${esc(p.label)}</button>`).join('');
  $('#breakFilters').innerHTML = BREAKS.map(b =>
    `<button class="fxp-pill${breakBy === b.id ? ' is-on' : ''}" data-break="${b.id}">${esc(b.label)}</button>`).join('');

  $('#equityChart').innerHTML = equitySvg(done);
  $('#equitySub').textContent = `${a.count} сделок · ${a.done} с денежным результатом · ${a.days} торговых дней`;

  const metrics = [
    ['Чистый результат', money(a.net), a.net >= 0 ? 'is-pos' : 'is-neg'],
    ['Винрейт', pct(a.winrate)],
    ['Профит-фактор', a.profitFactor === Infinity ? '∞' : num(a.profitFactor, 2), a.profitFactor >= 1.3 ? 'is-pos' : a.profitFactor < 1 ? 'is-neg' : ''],
    ['Ожидание на сделку', money(a.expectancy), a.expectancy >= 0 ? 'is-pos' : 'is-neg'],
    ['Средний плюс', money(a.avgWin), 'is-pos'],
    ['Средний минус', money(-a.avgLoss), 'is-neg'],
    ['Отношение плюс/минус', a.payoff === Infinity ? '∞' : num(a.payoff, 2)],
    ['Максимальная просадка', money(-dd), 'is-neg'],
    ['Лучшая сделка', money(a.best), 'is-pos'],
    ['Худшая сделка', money(a.worst), 'is-neg'],
    ['Средний RR', num(a.avgRR, 2)],
    ['Средний риск', num(a.avgRisk, 2) + '%']
  ];
  $('#metrics').innerHTML = metrics.map(([k, v, cls]) =>
    `<div class="fxp-metric"><span>${esc(k)}</span><strong class="${cls || ''}">${esc(v)}</strong></div>`).join('');

  renderBreakdown(list);
  renderTags(list);
  renderChecks(list);
  renderReport(list, a, dd);
}

function keyOf(t) {
  if (breakBy === 'symbol') return String(t.symbol || '—').toUpperCase();
  if (breakBy === 'weekday') return WEEK[new Date(t.date).getDay()];
  if (breakBy === 'hour') return String(new Date(t.date).getHours()).padStart(2, '0') + ':00';
  if (breakBy === 'session') return sessionOf(t.date);
  if (breakBy === 'side') return t.side === 'Short' ? 'Short' : 'Long';
  return String(t.model || '—');
}

function rowsTable(rows, firstLabel) {
  if (!rows.length) return `<p class="muted small">Пока нет данных — добавьте сделки с результатом в USD.</p>`;
  const worst = Math.min(...rows.map(r => r.net));
  return `<table class="fxp-grid"><thead><tr><th>${esc(firstLabel)}</th><th>Сделок</th><th>Винрейт</th><th>Результат</th></tr></thead><tbody>
    ${rows.map(r => `<tr class="${r.net === worst && r.net < 0 ? 'is-leak' : ''}">
      <td>${esc(r.key)}</td><td>${r.count}</td><td>${pct(r.winrate)}</td>
      <td class="${r.net >= 0 ? 'is-pos' : 'is-neg'}">${esc(money(r.net))}</td></tr>`).join('')}
  </tbody></table>`;
}

function groupRows(list, key) {
  const map = new Map();
  list.forEach(t => {
    const k = key(t);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(t);
  });
  return [...map].map(([k, items]) => {
    const done = closed(items);
    const wins = done.filter(t => t.pnl > 0).length;
    return {key: k, count: items.length, winrate: done.length ? wins / done.length : 0, net: done.reduce((s, t) => s + t.pnl, 0)};
  }).sort((a, b) => a.net - b.net);
}

function renderBreakdown(list) {
  $('#breakTable').innerHTML = rowsTable(groupRows(list, keyOf), BREAKS.find(b => b.id === breakBy).label);
}

function renderTags(list) {
  const tagged = list.filter(t => t.tags?.length);
  if (!tagged.length) {
    $('#tagTable').innerHTML = `<p class="muted small">Отмечайте теги при записи сделки («FOMO», «перенёс стоп», «по плану») — здесь появится отчёт, во сколько обходится каждая привычка.</p>`;
    return;
  }
  const rows = [];
  TAGS.forEach(tag => {
    const items = tagged.filter(t => t.tags.includes(tag.id));
    if (!items.length) return;
    const done = closed(items);
    rows.push({
      key: tag.label, count: items.length,
      winrate: done.length ? done.filter(t => t.pnl > 0).length / done.length : 0,
      net: done.reduce((s, t) => s + t.pnl, 0)
    });
  });
  $('#tagTable').innerHTML = rowsTable(rows.sort((a, b) => a.net - b.net), 'Пометка');
}

function renderChecks(list) {
  const withChecks = list.filter(t => Array.isArray(t.checks) && t.checks.length);
  if (!withChecks.length) { $('#checkTable').innerHTML = `<p class="muted small">Нет сделок с чек-листом.</p>`; return }
  const full = withChecks.filter(t => t.checks.every(Boolean));
  const partial = withChecks.filter(t => !t.checks.every(Boolean));
  const stat = items => {
    const done = closed(items);
    return {
      count: items.length,
      winrate: done.length ? done.filter(t => t.pnl > 0).length / done.length : 0,
      net: done.reduce((s, t) => s + t.pnl, 0),
      avg: done.length ? done.reduce((s, t) => s + t.pnl, 0) / done.length : 0
    };
  };
  const f = stat(full), p = stat(partial);
  $('#checkTable').innerHTML = `
    <table class="fxp-grid"><thead><tr><th>Тип входа</th><th>Сделок</th><th>Винрейт</th><th>На сделку</th><th>Итог</th></tr></thead><tbody>
      <tr><td>Чек-лист выполнен полностью</td><td>${f.count}</td><td>${pct(f.winrate)}</td>
        <td class="${f.avg >= 0 ? 'is-pos' : 'is-neg'}">${esc(money(f.avg))}</td>
        <td class="${f.net >= 0 ? 'is-pos' : 'is-neg'}">${esc(money(f.net))}</td></tr>
      <tr><td>С нарушением правил</td><td>${p.count}</td><td>${pct(p.winrate)}</td>
        <td class="${p.avg >= 0 ? 'is-pos' : 'is-neg'}">${esc(money(p.avg))}</td>
        <td class="${p.net >= 0 ? 'is-pos' : 'is-neg'}">${esc(money(p.net))}</td></tr>
    </tbody></table>
    <p class="small muted">Разница между строками — цена дисциплины в деньгах.</p>`;
}

let reportText = '';
function renderReport(list, a, dd) {
  const label = PERIODS.find(p => p.id === period).label;
  reportText = [
    `FIZY Journal — отчёт (${label})`,
    `Сделок: ${a.count}, с результатом: ${a.done}, торговых дней: ${a.days}`,
    `Чистый результат: ${money(a.net)}`,
    `Винрейт: ${pct(a.winrate)} · профит-фактор: ${a.profitFactor === Infinity ? '∞' : num(a.profitFactor, 2)}`,
    `Ожидание на сделку: ${money(a.expectancy)} · средний RR: ${num(a.avgRR, 2)}`,
    `Максимальная просадка: ${money(-dd)}`,
    `Чек-лист выполнен в среднем на ${pct(a.checkRatio)} · средний риск ${num(a.avgRisk, 2)}%`
  ].join('\n');
  $('#reportBox').innerHTML = `<pre>${esc(reportText)}</pre>`;
}

function download(name, text, type) {
  const blob = new Blob([text], {type});
  const url = URL.createObjectURL(blob);
  const a = el('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportCsv() {
  const head = ['Дата', 'Инструмент', 'Направление', 'Модель', 'Риск %', 'RR', 'PnL USD', 'Чек-лист', 'Теги', 'Ссылка', 'Заметки'];
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = trades().map(t => [
    t.date, t.symbol, t.side, t.model, t.risk, t.rr ?? '', t.pnl ?? '',
    Array.isArray(t.checks) ? `${t.checks.filter(Boolean).length}/${t.checks.length}` : '',
    (t.tags || []).map(tagLabel).join('; '), t.link || '', t.notes || ''
  ].map(cell).join(','));
  download(`fizy-journal-${new Date().toISOString().slice(0, 10)}.csv`,
    '\uFEFF' + [head.map(cell).join(','), ...rows].join('\r\n'), 'text/csv;charset=utf-8');
}

/* ============================================================
   РЕЙТИНГ ДИСЦИПЛИНЫ
   ============================================================ */
function myRating() {
  const list = trades();
  if (!list.length) return null;
  const cfg = riskRead();
  const withChecks = list.filter(t => Array.isArray(t.checks) && t.checks.length);
  const checklist = withChecks.length
    ? withChecks.reduce((s, t) => s + t.checks.filter(Boolean).length / t.checks.length, 0) / withChecks.length : 0;
  const risks = list.map(t => Number(t.risk)).filter(Number.isFinite);
  const riskOk = risks.length ? risks.filter(r => r <= cfg.perTrade + 0.001).length / risks.length : 0;
  const days = new Set(list.map(t => String(t.date).slice(0, 10))).size;
  const filled = list.filter(t => Number.isFinite(t.pnl) || Number.isFinite(t.rr)).length / list.length;
  const consistency = Math.min(1, days / 20);
  const done = closed(list);
  const winrate = done.length ? done.filter(t => t.pnl > 0).length / done.length : 0;

  // серия последних сделок без нарушений (полный чек-лист и риск в лимите)
  let streak = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const t = list[i];
    const ok = Array.isArray(t.checks) && t.checks.length && t.checks.every(Boolean) && Number(t.risk) <= cfg.perTrade + 0.001;
    if (!ok) break;
    streak++;
  }
  const score = Math.round((checklist * 0.4 + riskOk * 0.3 + filled * 0.15 + consistency * 0.15) * 100);
  return {
    score, discipline: Math.round(checklist * 100), checklist: Math.round(checklist * 100),
    trades: list.length, days, winrate: Math.round(winrate * 100), streak
  };
}

function renderRating(data, mine) {
  const ring = $('#ratingRing');
  $('#ratingScore').textContent = mine ? mine.score : '—';
  ring.style.setProperty('--deg', (mine ? mine.score * 3.6 : 0) + 'deg');
  $('#ratingHint').textContent = mine
    ? `Чек-лист ${mine.checklist}% · серия без нарушений: ${mine.streak} · торговых дней: ${mine.days}`
    : 'Добавьте первую сделку, чтобы получить оценку дисциплины.';
  $('#ratingPlace').textContent = data?.place
    ? `Ваше место: ${data.place} из ${data.total}`
    : 'Нажмите «Обновить мой результат», чтобы попасть в рейтинг.';

  const rows = data?.rows ?? [];
  $('#ratingList').innerHTML = rows.length ? `
    <table class="fxp-grid"><thead><tr><th>#</th><th>Трейдер</th><th>Дисциплина</th><th>Серия</th><th>Сделок</th><th>Дней</th></tr></thead><tbody>
    ${rows.map((r, i) => `<tr class="${r.username === data.me ? 'is-me' : ''}">
      <td>${i + 1}</td><td>${esc(r.username)}</td>
      <td><span class="fxp-bar" style="--v:${r.score}%"></span>${r.score}</td>
      <td>${r.streak}</td><td>${r.trades}</td><td>${r.days}</td></tr>`).join('')}
    </tbody></table>` : `<p class="muted small">Рейтинг пока пуст. Станьте первым — нажмите «Обновить мой результат».</p>`;
}

async function loadRating(push = false) {
  const mine = myRating();
  try {
    const data = push && mine ? await api('rating', 'POST', mine) : await api('rating');
    renderRating(data, mine);
  } catch (e) {
    renderRating(null, mine);
    const box = $('#ratingList');
    if (box && e.message) box.innerHTML = `<p class="error">${esc(e.message)}</p>`;
  }
}

/* ============================================================
   СВЯЗКА
   ============================================================ */
function wire() {
  wireRisk();
  $('#periodFilters')?.addEventListener('click', e => {
    const b = e.target.closest('[data-period]');
    if (!b) return;
    period = b.dataset.period;
    renderStats();
  });
  $('#breakFilters')?.addEventListener('click', e => {
    const b = e.target.closest('[data-break]');
    if (!b) return;
    breakBy = b.dataset.break;
    renderStats();
  });
  $('#exportCsv')?.addEventListener('click', exportCsv);
  $('#exportJson')?.addEventListener('click', () =>
    download(`fizy-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(journal, null, 2), 'application/json'));
  $('#copyReport')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(reportText); $('#copyReport').textContent = 'Скопировано' }
    catch { $('#copyReport').textContent = 'Не удалось' }
    setTimeout(() => { const b = $('#copyReport'); if (b) b.textContent = 'Копировать отчёт' }, 2000);
  });
  $('#ratingPush')?.addEventListener('click', async () => {
    const btn = $('#ratingPush');
    btn.disabled = true;
    await loadJournal();
    await loadRating(true);
    btn.disabled = false;
  });

  // форма сделки: поля появляются при открытии диалога
  const dialog = $('#tradeDialog');
  if (dialog) {
    new MutationObserver(() => {
      if (!dialog.open) return;
      injectTradeFields();
      setTimeout(prefillForm, 60);
    }).observe(dialog, {attributes: true, attributeFilter: ['open']});
  }
}

async function boot() {
  mount();
  if (!$('#statsView')) return;
  wire();
  try { const m = await api('me'); csrf = m.csrf } catch { return }
  await loadJournal();
  renderRisk();
  decorateTradeCards();
  // карточки сделок перерисовываются самим сайтом — дополняем их снова
  const host = $('#tradesView') || $('#workspace');
  if (host) new MutationObserver(() => decorateTradeCards()).observe(host, {childList: true, subtree: true});
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

// вход мог произойти позже — тогда подхватываем сессию
new MutationObserver(async () => {
  const ws = $('#workspace');
  if (ws && !ws.hidden && !csrf) {
    try {
      const m = await api('me');
      csrf = m.csrf;
      ensureTabs();
      await loadJournal();
      renderRisk();
      decorateTradeCards();
    } catch {}
  }
}).observe(document.documentElement, {attributes: true, subtree: true, attributeFilter: ['hidden']});
