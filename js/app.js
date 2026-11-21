import { h, clear, $, toast, modal } from './ui.js';
import { authFlow } from './auth.js';
import { sb, ctx, loadContext, friendly } from './api.js';
import { IDLE_MS } from './config.js';
import { VAT_TYPES } from './il.js';

const root = $('#app');
const routes = {};
const NAV = [
  ['dashboard', '📊', 'לוח בקרה'],
  ['docs', '🧾', 'מסמכים'],
  ['doc-new', '➕', 'מסמך חדש'],
  ['contacts', '👥', 'לקוחות וספקים'],
  ['expenses', '💳', 'הוצאות'],
  ['bank', '🏦', 'תנועות בנק'],
  ['--', 'דוחות וגבייה'],
  ['reports', '📈', 'דוחות'],
  ['collections', '🔔', 'תזכורות גבייה'],
  ['export', '📤', 'יצוא לרואה חשבון'],
  ['--', 'ניהול'],
  ['settings', '⚙️', 'הגדרות עסק'],
];

async function loadPage(name) {
  if (!routes[name]) {
    const map = { dashboard: 'dashboard', docs: 'docs', 'doc-new': 'docs', doc: 'docs', contacts: 'contacts', expenses: 'expenses', bank: 'bank', reports: 'reports', collections: 'collections', export: 'export', settings: 'settings' };
    const mod = await import('./pages/' + (map[name] || 'dashboard') + '.js');
    routes[name] = mod;
  }
  return routes[name];
}

function shell() {
  const side = h('aside', { class: 'side', id: 'side' },
    h('div', { class: 'brand' }, h('span', { class: 'dot', text: '✓' }), h('span', { text: 'הנהלת חשבונות' })),
    h('nav', { class: 'nav' }, NAV.map((n) => n[0] === '--' ? h('div', { class: 'sec', text: n[1] }) :
      h('a', { href: '#/' + n[0], 'data-r': n[0] }, h('span', { text: n[1] }), h('span', { text: n[2] })))),
    h('div', { class: 'foot' }, h('div', { text: ctx.biz.name }), h('div', { text: ({ owner: 'בעלים', accountant: 'רואה חשבון', viewer: 'צפייה' })[ctx.role] + ' · ' + (VAT_TYPES[ctx.biz.vat_type] || '') }),
      h('button', { class: 'btn small', text: 'התנתקות', onclick: logout })));
  const main = h('main', { class: 'main', id: 'main' });
  clear(root).append(h('div', { class: 'shell' }, side, main));
  side.addEventListener('click', (e) => { if (e.target.closest('a')) side.classList.remove('open'); });
  return main;
}

async function logout() { await sb.auth.signOut(); location.reload(); }

async function route() {
  const main = $('#main');
  const hash = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [name, ...params] = hash.split('/');
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.r === name || (name === 'doc' && a.dataset.r === 'docs')));
  clear(main).append(h('div', { class: 'boot', text: 'טוען…' }));
  try {
    const mod = await loadPage(name);
    clear(main);
    await mod.render(main, name, params);
  } catch (e) {
    clear(main).append(h('div', { class: 'note err', text: 'שגיאה: ' + friendly(e) }));
    console.error(e);
  }
  window.scrollTo(0, 0);
}

// ניתוק אחרי 30 דקות חוסר פעילות
function idleGuard() {
  let t;
  const reset = () => { clearTimeout(t); t = setTimeout(async () => { await sb.auth.signOut(); location.reload(); }, IDLE_MS); };
  ['click', 'keydown', 'mousemove', 'touchstart', 'scroll'].forEach((ev) => document.addEventListener(ev, reset, { passive: true }));
  reset();
}

function shortcuts() {
  document.addEventListener('keydown', (e) => {
    const typing = /input|textarea|select/i.test(document.activeElement?.tagName || '');
    if (e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); location.hash = '#/doc-new'; }
    else if (e.key === '/' && !typing) { const s = $('.search'); if (s) { e.preventDefault(); s.focus(); } }
    else if (e.key === 'Escape') document.querySelector('.modal-back')?.remove();
  });
}

async function start() {
  try {
    await authFlow(root, sb);
    const ok = await loadContext();
    if (!ok) {
      clear(root).append(h('div', { class: 'auth-wrap' }, h('div', { class: 'auth-card' }, h('h1', { text: 'אין גישה' }),
        h('div', { class: 'note err', text: 'המשתמש שלך אינו משויך לאף עסק. פנו לבעל המערכת.' }),
        h('button', { class: 'btn', text: 'התנתקות', onclick: logout }))));
      return;
    }
    shell();
    idleGuard(); shortcuts();
    window.addEventListener('hashchange', route);
    await route();
  } catch (e) {
    console.error(e);
    clear(root).append(h('div', { class: 'auth-wrap' }, h('div', { class: 'auth-card' }, h('h1', { text: 'שגיאה' }),
      h('div', { class: 'note err', text: String(e.message || e) }), h('button', { class: 'btn', text: 'רענון', onclick: () => location.reload() }))));
  }
}
start();
