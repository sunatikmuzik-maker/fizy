// FIZY — тёмная/светлая тема, @упоминания в чате и напоминание о важных новостях.

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

/* ---------- 1. Тема: Авто / Светлая / Тёмная ---------- */
const THEMES = [
  {id: 'auto', label: 'Авто', icon: '◑', hint: 'Как в системе'},
  {id: 'light', label: 'Светлая', icon: '☀', hint: 'Светлая тема'},
  {id: 'dark', label: 'Тёмная', icon: '☾', hint: 'Тёмная тема'}
];
const themeRead = () => { try { return localStorage.getItem('fizy-theme') || 'auto' } catch { return 'auto' } };

function applyTheme(id) {
  const root = document.documentElement;
  if (id === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', id);
  try { localStorage.setItem('fizy-theme', id) } catch {}
  const t = THEMES.find(x => x.id === id) || THEMES[0];
  const btn = $('#fxThemeBtn');
  if (btn) {
    btn.innerHTML = `<span class="fx-theme-icon">${t.icon}</span><span class="fx-theme-text">${esc(t.label)}</span>`;
    btn.title = t.hint;
    btn.setAttribute('aria-label', 'Тема оформления: ' + t.label);
  }
}

function injectTheme() {
  if ($('#fxThemeBtn')) return;
  const host = $('.header-actions');
  if (!host) return;
  const btn = el('button', 'fx-theme-btn');
  btn.id = 'fxThemeBtn';
  btn.type = 'button';
  btn.addEventListener('click', () => {
    const i = THEMES.findIndex(t => t.id === themeRead());
    applyTheme(THEMES[(i + 1) % THEMES.length].id);
  });
  host.prepend(btn);
  applyTheme(themeRead());
}

applyTheme(themeRead());

/* ---------- 2. @упоминания в чате ---------- */
let me = '';
const people = new Set();
const nickRe = /(^|[\s(\[.,:;—-])@([a-zA-Z0-9_]{3,32})/g;
let seenMentions = 0;

function notice(text) {
  const n = $('#notice');
  if (!n) return;
  n.textContent = text;
  n.hidden = false;
  clearTimeout(notice._t);
  notice._t = setTimeout(() => { n.hidden = true }, 6000);
}

function collectPeople() {
  $$('#chatLog b, #chatLog strong, #chatLog .fx-msg-user').forEach(x => {
    const v = x.textContent.trim().replace(/^@/, '');
    if (/^[a-zA-Z0-9_]{3,32}$/.test(v)) people.add(v);
  });
}

function highlightChat() {
  const log = $('#chatLog');
  if (!log) return;
  collectPeople();
  const walker = document.createTreeWalker(log, NodeFilter.SHOW_TEXT);
  const targets = [];
  let n;
  while ((n = walker.nextNode())) {
    if (!n.nodeValue.includes('@')) continue;
    if (n.parentElement && n.parentElement.closest('.fx-mention, a, button, input, textarea')) continue;
    targets.push(n);
  }
  targets.forEach(node => {
    const plain = esc(node.nodeValue);
    const html = plain.replace(nickRe, (all, pre, nick) =>
      `${pre}<span class="fx-mention${me && nick.toLowerCase() === me.toLowerCase() ? ' is-me' : ''}">@${esc(nick)}</span>`);
    if (html === plain) return;
    node.replaceWith(el('span', 'fx-mention-wrap', html));
  });
  checkMentions();
}

function checkMentions() {
  if (!me) return;
  const hits = $$('#chatLog .fx-mention.is-me').length;
  if (seenMentions && hits > seenMentions) notice('Вас упомянули в чате трейдеров.');
  seenMentions = hits;
  const tab = document.querySelector('.workspace-tabs button[data-view="chatView"]');
  if (tab) tab.dataset.fxMentions = hits ? String(hits) : '';
}

function wireMentionInput() {
  const input = $('#chatText');
  if (!input || input.dataset.fxMention) return;
  input.dataset.fxMention = '1';
  const box = el('div', 'fx-mention-pop');
  box.hidden = true;
  if (input.parentElement) {
    input.parentElement.style.position = 'relative';
    input.parentElement.append(box);
  }
  const close = () => { box.hidden = true };
  const pick = nick => {
    const at = input.value.lastIndexOf('@');
    input.value = input.value.slice(0, at) + '@' + nick + ' ';
    close();
    input.focus();
  };
  input.addEventListener('input', () => {
    const v = input.value.slice(0, input.selectionStart ?? input.value.length);
    const m = v.match(/@([a-zA-Z0-9_]{0,32})$/);
    if (!m) return close();
    const q = m[1].toLowerCase();
    const list = [...people].filter(p => p.toLowerCase().startsWith(q) && p.toLowerCase() !== me.toLowerCase()).slice(0, 6);
    if (!list.length) return close();
    box.innerHTML = list.map(p => `<button type="button" data-nick="${esc(p)}">@${esc(p)}</button>`).join('');
    box.hidden = false;
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
  box.addEventListener('mousedown', e => {
    const b = e.target.closest('button[data-nick]');
    if (b) { e.preventDefault(); pick(b.dataset.nick) }
  });
}

/* ---------- 3. Напоминание о важных новостях ---------- */
const warned = new Set();
let events = [];

const isHigh = e => {
  const v = String(e.impact ?? e.importance ?? '').toLowerCase();
  return v.includes('high') || v.includes('высок') || v === '3';
};
const eventTime = e => {
  const t = Date.parse(e.date || e.time || e.datetime || e.when || '');
  return Number.isFinite(t) ? t : null;
};

async function loadCalendar() {
  try {
    const r = await fetch('/api/calendar', {credentials: 'same-origin'});
    if (!r.ok) return;
    const d = await r.json();
    const items = d.items || d.events || d.calendar || [];
    events = items.filter(isHigh);
    renderNewsBar();
  } catch {}
}

function renderNewsBar() {
  const host = $('#workspace');
  if (!host || host.hidden) return;
  const next = events
    .map(e => ({e, t: eventTime(e)}))
    .filter(x => x.t && x.t > Date.now())
    .sort((a, b) => a.t - b.t)[0];
  let bar = $('#fxNewsBar');
  if (!next) { if (bar) bar.remove(); return }

  const mins = Math.round((next.t - Date.now()) / 60000);
  if (!bar) {
    bar = el('div', 'fx-newsbar');
    bar.id = 'fxNewsBar';
    const tabs = host.querySelector('.workspace-tabs');
    if (tabs) tabs.after(bar); else host.prepend(bar);
  }
  const soon = mins <= 15;
  bar.classList.toggle('is-soon', soon);
  const title = esc(next.e.title || next.e.event || next.e.name || 'Важная новость');
  const cur = esc(next.e.currency || next.e.country || '');
  const when = mins >= 60 ? Math.round(mins / 60) + ' ч' : mins + ' мин';
  bar.innerHTML = `<span class="fx-newsbar-dot"></span>
    <b>${soon ? 'Через ' + mins + ' мин — важная новость' : 'Ближайшая важная новость через ' + when}</b>
    <span>${cur ? cur + ' · ' : ''}${title}</span>
    ${soon ? '<span class="fx-newsbar-hint">Спреды расширяются — лучше не открывать новых позиций.</span>' : ''}`;

  const key = title + next.t;
  if (soon && !warned.has(key)) {
    warned.add(key);
    notice(`Через ${mins} мин — ${next.e.title || next.e.event || 'важная новость'}. Проверьте открытые позиции и стопы.`);
  }
}

/* ---------- запуск ---------- */
async function boot() {
  injectTheme();
  wireMentionInput();
  try {
    const r = await fetch('/api/me', {credentials: 'same-origin'});
    if (r.ok) {
      const d = await r.json();
      me = d.username || (d.user && d.user.username) || '';
    }
  } catch {}
  if (me) people.add(me);

  const log = $('#chatLog');
  if (log) new MutationObserver(() => { highlightChat(); wireMentionInput() }).observe(log, {childList: true, subtree: true});
  highlightChat();

  loadCalendar();
  setInterval(() => { if (!document.hidden) renderNewsBar() }, 60000);
  setInterval(() => { if (!document.hidden) loadCalendar() }, 1800000);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

new MutationObserver(() => {
  injectTheme();
  wireMentionInput();
  renderNewsBar();
}).observe(document.documentElement, {childList: true, subtree: true, attributes: true, attributeFilter: ['hidden']});
