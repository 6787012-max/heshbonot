import { h, clear, topbar, toast, field, select, table, modal, confirmBox } from '../ui.js';
import { q, sb, bid, canWrite, unwrap, friendly, ctx } from '../api.js';
import { fmtMoney, fmtDate, today, r2 } from '../il.js';

const CATS = ['כללי', 'רכב', 'דלק', 'תקשורת וטלפון', 'שכירות', 'משרד וציוד', 'שיווק ופרסום', 'שירותים מקצועיים', 'ביטוח', 'ארנונה ומים וחשמל', 'מזון וכיבוד', 'נסיעות', 'ביגוד', 'עמלות בנק', 'אחר'];
const RECOG = [['100', 'מלא (100%)'], ['66.67', 'רכב פרטי (2/3)'], ['25', 'רבע (25%)'], ['0', 'ללא הכרה (0%)']];

export async function render(main) {
  const [exps, contacts] = await Promise.all([q.expenses(), q.contacts()]);
  const suppliers = contacts.filter((c) => c.kind !== 'customer');
  let text = '';
  const body = h('div');
  const draw = () => {
    const rows = exps.filter((e) => !text || e.supplier_name.includes(text) || (e.category || '').includes(text) || (e.description || '').includes(text));
    clear(body).append(table([
      { label: 'תאריך', render: (e) => fmtDate(e.expense_date) }, { label: 'ספק', key: 'supplier_name' }, { label: 'קטגוריה', key: 'category' },
      { label: 'לפני מע"מ', num: true, render: (e) => fmtMoney(e.amount_net) }, { label: 'מע"מ', num: true, render: (e) => fmtMoney(e.vat_amount) },
      { label: 'מע"מ מוכר', num: true, render: (e) => fmtMoney(e.vat_recognized) }, { label: 'סה"כ', num: true, render: (e) => fmtMoney(e.total) },
      { label: '', render: (e) => e.attachment_path ? h('span', { class: 'tag', text: '📎' }) : null },
    ], rows, { onRow: (e) => edit(e), empty: 'עוד לא הוזנו הוצאות.' }));
  };
  const again = () => { clear(main); return render(main); };

  function edit(e) {
    const S = { supplier_id: '', supplier_name: '', expense_date: today(), category: 'כללי', description: '', amount_net: '', vat_amount: '', vat_recognized_pct: '100', doc_ref: '', attachment_path: null, ...(e || {}) };
    S.vat_recognized_pct = String(S.vat_recognized_pct);
    const err = h('div', { class: 'note err', hidden: true });
    const net = h('input', { type: 'number', step: '0.01', min: '0', value: S.amount_net, oninput: (x) => { S.amount_net = x.target.value; if (auto.checked) { vat.value = S.vat_amount = r2(Number(S.amount_net || 0) * Number(ctx.biz.vat_rate) / 100); } tot(); } });
    const vat = h('input', { type: 'number', step: '0.01', min: '0', value: S.vat_amount, oninput: (x) => { S.vat_amount = x.target.value; tot(); } });
    const auto = h('input', { type: 'checkbox', checked: !e });
    const totBox = h('div', { class: 'hint' });
    const tot = () => { totBox.textContent = `סה"כ כולל מע"מ: ${fmtMoney(Number(S.amount_net || 0) + Number(S.vat_amount || 0))} · מע"מ מוכר: ${fmtMoney(Number(S.vat_amount || 0) * Number(S.vat_recognized_pct) / 100)}`; };
    const file = h('input', { type: 'file', accept: '.pdf,.jpg,.jpeg,.png,.heic,.webp' });
    const supSel = select([['', 'ספק חופשי / לא קיים'], ...suppliers.map((c) => [c.id, c.name])], S.supplier_id, { onchange: (x) => { S.supplier_id = x.target.value; const c = suppliers.find((y) => y.id === x.target.value); if (c) { S.supplier_name = c.name; nameIn.value = c.name; } } });
    const recog = select(RECOG, S.vat_recognized_pct, { onchange: (x) => { S.vat_recognized_pct = x.target.value; tot(); } });
    const nameIn = h('input', { value: S.supplier_name, oninput: (x) => { S.supplier_name = x.target.value; } });
    modal(e ? 'עריכת הוצאה' : 'הוצאה חדשה', h('div', null,
      h('div', { class: 'cols2' }, field('ספק', supSel), field('שם ספק', nameIn)),
      h('div', { class: 'cols3' }, field('תאריך', h('input', { type: 'date', value: S.expense_date, oninput: (x) => { S.expense_date = x.target.value; } })),
        field('קטגוריה', select(CATS.map((c) => [c, c]), S.category, { onchange: (x) => { S.category = x.target.value; if (x.target.value === 'רכב') { S.vat_recognized_pct = '66.67'; recog.value = '66.67'; tot(); } } })),
        field('אסמכתא / מס\' חשבונית ספק', h('input', { value: S.doc_ref || '', oninput: (x) => { S.doc_ref = x.target.value; } }))),
      h('div', { class: 'cols3' }, field('סכום לפני מע"מ', net), field('מע"מ', vat, 'ברירת מחדל: לפי אחוז המע"מ בהגדרות'), field('הכרה במע"מ תשומות', recog)),
      h('label', { class: 'row' }, auto, h('span', { text: 'חשב מע"מ אוטומטית' })), totBox,
      field('תיאור', h('input', { value: S.description || '', oninput: (x) => { S.description = x.target.value; } })),
      field('קובץ מצורף (חשבונית / קבלה)', file, S.attachment_path ? 'קיים קובץ מצורף. בחירת קובץ חדש תחליף אותו.' : 'עד 10MB'), err),
    [{ text: 'שמירה', class: 'primary', onclick: async (cl) => {
      if (!S.supplier_name.trim()) { err.textContent = 'חסר שם ספק.'; err.hidden = false; return; }
      if (S.amount_net === '' || Number(S.amount_net) < 0) { err.textContent = 'חסר סכום.'; err.hidden = false; return; }
      try {
        let path = S.attachment_path;
        if (file.files[0]) {
          const f = file.files[0];
          if (f.size > 10 * 1024 * 1024) throw new Error('הקובץ גדול מ-10MB');
          path = `${bid()}/${crypto.randomUUID()}-${f.name.replace(/[^\w.\-א-ת]/g, '_')}`;
          const up = await sb.storage.from('heshbonot-attachments').upload(path, f, { contentType: f.type || 'application/octet-stream' });
          if (up.error) throw new Error('העלאת הקובץ נכשלה: ' + up.error.message);
        }
        const row = { supplier_id: S.supplier_id || null, supplier_name: S.supplier_name.trim(), expense_date: S.expense_date, category: S.category, description: S.description || null,
          amount_net: Number(S.amount_net), vat_amount: Number(S.vat_amount || 0), vat_recognized_pct: Number(S.vat_recognized_pct), doc_ref: S.doc_ref || null, attachment_path: path };
        if (e) unwrap(await sb.from('expenses').update(row).eq('id', e.id)); else unwrap(await sb.from('expenses').insert({ ...row, business_id: bid() }));
        cl(); toast('ההוצאה נשמרה'); again();
      } catch (x) { err.textContent = friendly(x); err.hidden = false; }
    } },
    e && e.attachment_path ? { text: 'פתח קובץ', onclick: async () => { const { data } = await sb.storage.from('heshbonot-attachments').createSignedUrl(e.attachment_path, 60); if (data) window.open(data.signedUrl, '_blank', 'noopener'); } } : null,
    e ? { text: 'מחיקה', class: 'danger', onclick: async (cl) => { cl(); if (await confirmBox('מחיקת הוצאה', 'למחוק את ההוצאה?')) { try { unwrap(await sb.from('expenses').delete().eq('id', e.id)); toast('נמחקה'); again(); } catch (x) { toast(friendly(x), 'err'); } } } } : null,
    { text: 'ביטול', onclick: (cl) => cl() }].filter(Boolean));
    tot();
  }
  main.append(topbar('הוצאות', h('input', { class: 'search', placeholder: 'חיפוש… ( / )', oninput: (x) => { text = x.target.value.trim(); draw(); } }),
    canWrite() ? h('button', { class: 'btn primary', text: '＋ הוצאה חדשה', onclick: () => edit(null) }) : null), h('div', { class: 'card' }, body));
  draw();
}
