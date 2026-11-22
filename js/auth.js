// כניסה (בטא): אימייל+סיסמה, או כניסה עם גוגל. אין אימות דו-שלבי ואין החלפת סיסמה כפויה.
// ההרשאה לנתונים נקבעת בשרת: חברות ב-heshbonot.members (נוצרת מהזמנה לפי מייל, ראו claim_invites).
import { h, clear, field } from './ui.js';

function card(root, title, sub, ...kids) {
  clear(root).append(h('div', { class: 'auth-wrap' }, h('div', { class: 'auth-card' },
    h('h1', { text: title }), sub ? h('div', { class: 'sub', text: sub }) : null, ...kids)));
}

// מנקה מהכתובת את פרמטרי החזרה מגוגל (code / error) בלי לטעון מחדש
function cleanUrl() {
  const u = new URL(location.href);
  let dirty = false;
  for (const k of ['code', 'error', 'error_code', 'error_description']) if (u.searchParams.has(k)) { u.searchParams.delete(k); dirty = true; }
  if (/(^|[#&])(access_token|error)=/.test(u.hash)) { u.hash = ''; dirty = true; }
  if (dirty) history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
}

function urlError() {
  const u = new URL(location.href);
  return u.searchParams.get('error_description') || u.searchParams.get('error') || '';
}

function loginScreen(root, sb, errText) {
  return new Promise((resolve) => {
    const err = h('div', { class: 'note err', hidden: !errText, text: errText || '' });
    const showErr = (m) => { err.textContent = m; err.hidden = false; };
    const em = h('input', { type: 'email', autocomplete: 'username', required: true, dir: 'ltr' });
    const pw = h('input', { type: 'password', autocomplete: 'current-password', required: true, dir: 'ltr' });
    const submit = h('button', { class: 'btn primary', type: 'submit', text: 'כניסה' });
    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault(); submit.disabled = true; err.hidden = true;
        const { error } = await sb.auth.signInWithPassword({ email: em.value.trim(), password: pw.value });
        submit.disabled = false;
        if (error) return showErr('האימייל או הסיסמה שגויים.');
        resolve();
      },
    }, field('אימייל', em), field('סיסמה', pw), submit);
    const g = h('button', {
      class: 'btn', type: 'button', text: 'כניסה עם גוגל',
      onclick: async () => {
        g.disabled = true; err.hidden = true;
        const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
        if (error) { g.disabled = false; showErr('לא ניתן להתחיל כניסה עם גוגל: ' + error.message); }
      },
    });
    card(root, 'הנהלת חשבונות', 'גרסת בטא', err, form, h('div', { class: 'hint', text: 'או' }), g);
    em.focus();
  });
}

// מחזיר את המשתמש ברגע שיש session. אחרת מציג מסך כניסה (שמנווט לגוגל ולכן לא חוזר).
export async function authFlow(root, sb) {
  const errText = urlError();
  let { data: { session } } = await sb.auth.getSession(); // ממתין להחלפת code ב-session (PKCE)
  cleanUrl();
  if (!session) {
    await loginScreen(root, sb, errText);
    ({ data: { session } } = await sb.auth.getSession());
  }
  try { await sb.rpc('claim_invites'); } catch (e) { console.warn('claim_invites', e); }
  return session.user;
}
