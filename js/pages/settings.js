import { h, topbar, field, select, toast, table } from '../ui.js';
import { q, sb, ctx, bid, canWrite, reloadBiz, unwrap, friendly } from '../api.js';
import { VAT_TYPES, DOC_TYPES, validId, fmtDate } from '../il.js';

export async function render(main) {
  const b = ctx.biz, S = { ...b };
  const seqs = await q.seqs();
  const err = h('div', { class: 'note err', hidden: true });
  const ro = !canWrite();
  const inp = (k, a = {}) => h('input', { value: S[k] ?? '', disabled: ro, oninput: (e) => { S[k] = e.target.value; }, ...a });
  const logoImg = h('img', { class: 'qr', alt: 'לוגו', hidden: !S.logo, src: S.logo || '' });
  const logoIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', disabled: ro, onchange: async (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 300 * 1024) { toast('הלוגו גדול מ-300KB. בחרו תמונה קטנה יותר.', 'err'); e.target.value = ''; return; }
    const rd = new FileReader();
    rd.onload = () => { S.logo = rd.result; logoImg.src = S.logo; logoImg.hidden = false; };
    rd.readAsDataURL(f);
  } });
  const save = async () => {
    err.hidden = true;
    const fail = (m) => { err.textContent = m; err.hidden = false; };
    if (!S.name.trim()) return fail('חסר שם עסק.');
    if (S.vat_number && !validId(S.vat_number)) return fail('מספר העוסק אינו תקין (ספרת ביקורת).');
    for (const k of ['vat_rate', 'advance_pct', 'allocation_threshold']) if (isNaN(Number(S[k])) || Number(S[k]) < 0) return fail('ערך מספרי לא תקין.');
    try {
      unwrap(await sb.from('businesses').update({ name: S.name.trim(), vat_type: S.vat_type, vat_number: S.vat_number || null, address: S.address || null, phone: S.phone || null, email: S.email || null,
        logo: S.logo || null, vat_rate: Number(S.vat_rate), advance_pct: Number(S.advance_pct), allocation_threshold: Number(S.allocation_threshold), report_freq: S.report_freq }).eq('id', bid()));
      await reloadBiz(); toast('ההגדרות נשמרו');
    } catch (e) { fail(friendly(e)); }
  };
  const seqInputs = {};
  const seqRows = Object.keys(DOC_TYPES).map((k) => {
    const cur = seqs.find((s) => s.doc_type === k)?.next_number ?? 1;
    seqInputs[k] = h('input', { type: 'number', min: cur, value: cur, disabled: ro });
    return h('div', { class: 'row' }, h('span', { text: DOC_TYPES[k].name, class: 'lbl' }), h('span', { class: 'spacer' }), seqInputs[k],
      ro ? null : h('button', { class: 'btn small', text: 'עדכן', onclick: async () => {
        try { await q.rpc('set_start_number', { bid: bid(), dtype: k, n: Number(seqInputs[k].value) }); toast('המספר הבא עודכן'); } catch (e) { toast(friendly(e), 'err'); }
      } }));
  });
  main.append(topbar('הגדרות עסק'),
    h('div', { class: 'card' }, h('h2', { text: 'פרטי העסק' }),
      h('div', { class: 'cols2' }, field('שם העסק', inp('name')), field('סוג עוסק', select(Object.entries(VAT_TYPES), S.vat_type, { disabled: ro, onchange: (e) => { S.vat_type = e.target.value; } }))),
      h('div', { class: 'cols2' }, field('מספר עוסק / ח.פ', inp('vat_number', { dir: 'ltr' })), field('טלפון', inp('phone', { dir: 'ltr' }))),
      h('div', { class: 'cols2' }, field('כתובת', inp('address')), field('אימייל', inp('email', { dir: 'ltr' }))),
      field('לוגו (עד 300KB)', logoIn), logoImg),
    h('div', { class: 'card' }, h('h2', { text: 'מיסים ודיווח' }),
      h('div', { class: 'cols3' }, field('אחוז מע"מ', inp('vat_rate', { type: 'number', step: '0.01' }), 'נשמר בכל מסמך בעת ההפקה'), field('אחוז מקדמות מס הכנסה', inp('advance_pct', { type: 'number', step: '0.01' })),
        field('סף מספר הקצאה (₪ לפני מע"מ)', inp('allocation_threshold', { type: 'number' }), 'ברירת מחדל 5,000')),
      field('תדירות דיווח מע"מ', select([['monthly', 'חד-חודשית'], ['bimonthly', 'דו-חודשית']], S.report_freq, { disabled: ro, onchange: (e) => { S.report_freq = e.target.value; } })),
      err, ro ? null : h('button', { class: 'btn primary', text: 'שמירת הגדרות', onclick: save })),
    h('div', { class: 'card' }, h('h2', { text: 'מספור מסמכים' }), h('div', { class: 'hint', text: 'המספר הבא לכל סוג מסמך. מיועד למי שעובר מתוכנה אחרת: אפשר רק להגדיל, כדי לשמור על מספור רציף.' }), ...seqRows),
    h('div', { class: 'card' }, h('h2', { text: 'מה עוד פתוח' }), h('ul', null,
      h('li', { text: 'חיבור אוטומטי לשע"מ לקבלת מספר הקצאה: דורש רישום התוכנה ברשות המסים. כרגע מספר ההקצאה מוזן ידנית.' }),
      h('li', { text: 'מבנה אחיד לא אומת מול הסימולטור של רשות המסים.' }))));
}
