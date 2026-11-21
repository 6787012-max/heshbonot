import { h, topbar, field, toast, downloadBlob, toCSV } from '../ui.js';
import { q, ctx, bid, canExport, canWrite, friendly, sb, unwrap } from '../api.js';
import { DOC_TYPES, PAY_METHODS, fmtDate, today } from '../il.js';
import { buildUniform, encode8859_8 } from '../uniform.js';
import { makeZip } from '../zip.js';

const safe = (v) => (typeof v === 'string' && /^[=+\-@]/.test(v) && isNaN(Number(v)) ? "'" + v : v);

export async function render(main) {
  if (!canExport()) { main.append(topbar('יצוא'), h('div', { class: 'note err', text: 'היצוא זמין לבעלים ולרואה חשבון בלבד.' })); return; }
  const y = new Date().getFullYear();
  let from = `${y}-01-01`, to = today();
  const msg = h('div', { class: 'note info', hidden: true });
  const say = (t) => { msg.textContent = t; msg.hidden = false; };

  async function data() {
    const docs = (await q.docs({ from, to, limit: 20000 })).slice().reverse();
    const ids = docs.map((d) => d.id);
    const [items, pays, exps, txns] = await Promise.all([q.items(ids), q.pays(ids), q.expenses({ from, to }), q.txns({ from, to })]);
    return { docs, items, pays, exps, txns };
  }
  const sheets = (d) => ({
    'מסמכים': [['סוג', 'מספר', 'תאריך', 'לקוח', 'ח.פ/ת.ז', 'לפני מע"מ', 'מע"מ', 'סה"כ', 'שולם', 'סטטוס', 'מספר הקצאה'],
      ...d.docs.map((x) => [DOC_TYPES[x.doc_type].name, x.number, x.issue_date, x.customer_name, x.customer_tax_id || '', Number(x.subtotal), Number(x.vat_amount), Number(x.total), Number(x.paid_amount), x.status === 'cancelled' ? 'מבוטל' : x.payment_status, x.allocation_number || ''])],
    'הוצאות': [['תאריך', 'ספק', 'קטגוריה', 'תיאור', 'אסמכתא', 'לפני מע"מ', 'מע"מ', 'מע"מ מוכר', 'סה"כ'],
      ...d.exps.map((e) => [e.expense_date, e.supplier_name, e.category, e.description || '', e.doc_ref || '', Number(e.amount_net), Number(e.vat_amount), Number(e.vat_recognized), Number(e.total)])],
    'תנועות בנק': [['תאריך', 'תיאור', 'זכות', 'חובה', 'סטטוס התאמה'], ...d.txns.map((t) => [t.txn_date, t.description, Number(t.credit), Number(t.debit), t.match_status])],
  });
  const run = (fn) => async () => { try { msg.hidden = true; await fn(); } catch (e) { toast(friendly(e), 'err'); console.error(e); } };

  const xlsx = run(async () => {
    const d = await data(), S = sheets(d), wb = window.XLSX.utils.book_new();
    for (const [n, rows] of Object.entries(S)) { const ws = window.XLSX.utils.aoa_to_sheet(rows.map((r) => r.map(safe))); ws['!views'] = [{ rightToLeft: true }]; window.XLSX.utils.book_append_sheet(wb, ws, n); }
    wb.Workbook = { Views: [{ RTL: true }] };
    downloadBlob(`heshbonot-${from}-${to}.xlsx`, window.XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), 'application/octet-stream');
    say(`יוצאו ${d.docs.length} מסמכים, ${d.exps.length} הוצאות, ${d.txns.length} תנועות.`);
  });
  const csv = run(async () => {
    const d = await data();
    for (const [n, rows] of Object.entries(sheets(d))) downloadBlob(`${n}-${from}-${to}.csv`, toCSV(rows[0], rows.slice(1)), 'text/csv;charset=utf-8');
    say('הורדו שלושה קבצי CSV (נפתחים באקסל בעברית תקינה).');
  });
  const uniform = run(async () => {
    if (!ctx.biz.vat_number) throw new Error('חסר מספר עוסק בהגדרות העסק.');
    const d = await data();
    const u = buildUniform({ business: ctx.biz, docs: d.docs, items: d.items, payments: d.pays, from, to });
    const zip = makeZip([{ name: 'INI.TXT', data: encode8859_8(u.ini) }, { name: 'BKMVDATA.TXT', data: encode8859_8(u.bkmv) }]);
    downloadBlob(`uniform-${from}-${to}.zip`, zip, 'application/zip');
    say(`נוצר קובץ מבנה אחיד: ${u.records} רשומות (${u.counts.C100} מסמכים, ${u.counts.D110} שורות, ${u.counts.D120} תשלומים). נבנה לפי המפרט כמיטב היכולת ולא אומת מול סימולטור רשות המסים — מומלץ לבדוק אותו בסימולטור לפני הגשה.`);
  });
  const backup = run(async () => {
    const t = ['contacts', 'documents', 'document_items', 'document_payments', 'expenses', 'bank_txns', 'doc_sequences'];
    const out = { exported_at: new Date().toISOString(), business: ctx.biz };
    for (const n of t) {
      const rows = [];
      for (let i = 0; ; i += 1000) {
        const r = unwrap(await sb.from(n).select('*').eq('business_id', bid()).range(i, i + 999));
        rows.push(...r); if (r.length < 1000) break;
      }
      out[n] = rows;
    }
    downloadBlob(`heshbonot-backup-${today()}.json`, JSON.stringify(out, null, 1), 'application/json');
    say('הגיבוי ירד כקובץ JSON. הקובץ אינו מוצפן — שמרו אותו במקום בטוח.');
  });

  main.append(topbar('יצוא לרואה חשבון'), msg,
    h('div', { class: 'card' }, h('div', { class: 'cols2' }, field('מתאריך', h('input', { type: 'date', value: from, onchange: (e) => { from = e.target.value; } })), field('עד תאריך', h('input', { type: 'date', value: to, onchange: (e) => { to = e.target.value; } })))),
    h('div', { class: 'grid g2' },
      h('div', { class: 'card' }, h('h3', { text: 'Excel / CSV' }), h('p', { class: 'hint', text: 'מסמכים, הוצאות ותנועות בנק לתקופה.' }), h('div', { class: 'row' }, h('button', { class: 'btn primary', text: 'הורד Excel', onclick: xlsx }), h('button', { class: 'btn', text: 'הורד CSV', onclick: csv }))),
      h('div', { class: 'card' }, h('h3', { text: 'מבנה אחיד (רשות המסים)' }), h('p', { class: 'hint', text: 'קבצי INI.TXT ו-BKMVDATA.TXT בקידוד ISO-8859-8, ארוזים ב-ZIP. נבנה לפי המפרט, לא אומת בסימולטור.' }), h('button', { class: 'btn primary', text: 'הורד קובץ מבנה אחיד', onclick: uniform })),
      canWrite() ? h('div', { class: 'card' }, h('h3', { text: 'גיבוי מלא' }), h('p', { class: 'hint', text: 'כל נתוני העסק כקובץ JSON להורדה.' }), h('button', { class: 'btn', text: 'ייצוא גיבוי', onclick: backup })) : null));
}
