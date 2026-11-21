// כניסה: אימייל+סיסמה -> (החלפת סיסמה בכניסה ראשונה) -> אימות דו-שלבי חובה (TOTP) -> aal2
import { h, clear, field } from './ui.js';

const strongPw = (p) => p.length >= 12 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p) && /[^A-Za-z0-9]/.test(p);

function card(root, title, sub, ...kids) {
  clear(root).append(h('div', { class: 'auth-wrap' }, h('div', { class: 'auth-card' },
    h('h1', { text: title }), sub ? h('div', { class: 'sub', text: sub }) : null, ...kids)));
}
const msgBox = () => h('div', { class: 'note err', hidden: true });
function showErr(box, m) { box.textContent = m; box.hidden = false; }

function loginScreen(root, sb) {
  return new Promise((resolve) => {
    const em = h('input', { type: 'email', autocomplete: 'username', required: true, dir: 'ltr' });
    const pw = h('input', { type: 'password', autocomplete: 'current-password', required: true, dir: 'ltr' });
    const err = msgBox();
    const btn = h('button', { class: 'btn primary', type: 'submit', text: 'כניסה' });
    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault(); btn.disabled = true; err.hidden = true;
        const { error } = await sb.auth.signInWithPassword({ email: em.value.trim(), password: pw.value });
        btn.disabled = false;
        if (error) return showErr(err, 'האימייל או הסיסמה שגויים.');
        resolve();
      },
    }, field('אימייל', em), field('סיסמה', pw), err, btn);
    card(root, 'הנהלת חשבונות', 'כניסה מאובטחת', form);
    em.focus();
  });
}

function changePwScreen(root, sb) {
  return new Promise((resolve) => {
    const p1 = h('input', { type: 'password', autocomplete: 'new-password', dir: 'ltr' });
    const p2 = h('input', { type: 'password', autocomplete: 'new-password', dir: 'ltr' });
    const err = msgBox();
    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault(); err.hidden = true;
        if (!strongPw(p1.value)) return showErr(err, 'הסיסמה חייבת להכיל לפחות 12 תווים: אות גדולה, אות קטנה, ספרה וסימן.');
        if (p1.value !== p2.value) return showErr(err, 'שתי הסיסמאות אינן זהות.');
        const { error } = await sb.auth.updateUser({ password: p1.value, data: { must_change_pw: false } });
        if (error) return showErr(err, 'לא ניתן להחליף סיסמה: ' + error.message);
        resolve();
      },
    }, h('div', { class: 'note info', text: 'זו הכניסה הראשונה. יש לבחור סיסמה אישית חדשה.' }),
      field('סיסמה חדשה', p1), field('הקלד שוב', p2), err, h('button', { class: 'btn primary', type: 'submit', text: 'שמירת סיסמה' }));
    card(root, 'החלפת סיסמה', null, form);
    p1.focus();
  });
}

function totpInput() {
  return h('input', { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, pattern: '[0-9]{6}', dir: 'ltr', required: true });
}

async function enrollScreen(root, sb) {
  // מנקה גורמים שלא אומתו (הרשמה שנקטעה)
  const { data: fl } = await sb.auth.mfa.listFactors();
  for (const f of (fl?.all || []).filter((x) => x.status === 'unverified')) await sb.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'אפליקציית אימות ' + new Date().toISOString().slice(0, 10) });
  if (error) { card(root, 'שגיאה', null, h('div', { class: 'note err', text: 'לא ניתן להתחיל רישום אימות: ' + error.message })); return new Promise(() => {}); }
  return new Promise((resolve) => {
    const code = totpInput(); const err = msgBox();
    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault(); err.hidden = true;
        const ch = await sb.auth.mfa.challenge({ factorId: data.id });
        if (ch.error) return showErr(err, ch.error.message);
        const v = await sb.auth.mfa.verify({ factorId: data.id, challengeId: ch.data.id, code: code.value.trim() });
        if (v.error) return showErr(err, 'הקוד שגוי או פג תוקף. נסו שוב עם הקוד הנוכחי.');
        resolve();
      },
    }, h('div', { class: 'note info', text: 'לפני הכניסה לנתונים יש לרשום אפליקציית אימות (Google Authenticator, Microsoft Authenticator או דומה). סרקו את הקוד:' }),
      h('img', { class: 'qr', src: data.totp.qr_code, alt: 'קוד QR לרישום' }),
      h('div', { class: 'hint', text: 'או הקלידו ידנית את המפתח:' }), h('div', { class: 'secret', text: data.totp.secret }),
      field('הקוד בן 6 הספרות מהאפליקציה', code), err, h('button', { class: 'btn primary', type: 'submit', text: 'אימות והמשך' }));
    card(root, 'אימות דו-שלבי', 'שלב חובה לאבטחת הנתונים', form);
    code.focus();
  });
}

function challengeScreen(root, sb, factorId) {
  return new Promise((resolve) => {
    const code = totpInput(); const err = msgBox();
    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault(); err.hidden = true;
        const ch = await sb.auth.mfa.challenge({ factorId });
        if (ch.error) return showErr(err, ch.error.message);
        const v = await sb.auth.mfa.verify({ factorId, challengeId: ch.data.id, code: code.value.trim() });
        if (v.error) return showErr(err, 'הקוד שגוי. נסו שוב.');
        resolve();
      },
    }, field('הקוד מאפליקציית האימות', code), err, h('button', { class: 'btn primary', type: 'submit', text: 'אימות' }),
      h('button', { class: 'btn', type: 'button', text: 'חזרה', onclick: async () => { await sb.auth.signOut(); location.reload(); } }));
    card(root, 'אימות דו-שלבי', 'הקלידו את הקוד הנוכחי', form);
    code.focus();
  });
}

// מחזיר כשהמשתמש ב-aal2 וללא דרישת החלפת סיסמה
export async function authFlow(root, sb) {
  for (let guard = 0; guard < 8; guard++) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { await loginScreen(root, sb); continue; }
    const user = session.user;
    const { data: fl } = await sb.auth.mfa.listFactors();
    const verified = (fl?.totp || []).find((f) => f.status === 'verified');
    const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    const mustChange = user.user_metadata?.must_change_pw === true;
    if (aal?.currentLevel === 'aal2' && !mustChange) return user;
    if (verified && aal?.currentLevel !== 'aal2') { await challengeScreen(root, sb, verified.id); continue; }
    if (mustChange) { await changePwScreen(root, sb); continue; }
    if (!verified) { await enrollScreen(root, sb); await sb.auth.refreshSession(); continue; }
  }
  throw new Error('auth loop');
}
