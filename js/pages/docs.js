import { h, clear, topbar, toast, field, select, table, confirmBox } from '../ui.js';
import { q, ctx, bid, canWrite, sb, friendly } from '../api.js';
import { DOC_TYPES, PAY_METHODS, fmtMoney, fmtDate, today, addDays, calcTotals, validId, r2 } from '../il.js';
import { renderPaper } from '../docview.js';

export async function render(main, name, params) {
  if (name === 'docs') return list(main);
  if (name === 'doc') return view(main, params[0]);
  return form(main, params[0] || 'tax_invoice', params[1]);
}

function statusTag(d) {
  if (d.status === 'cancelled') return h('span', { class: 'tag mute', text: 'מבוטל' });
  if (d.doc_type === 'tax_invoice') {
    if (d.payment_status === 'paid') return h('span', { class: 'tag', text: 'שולם' });
    const late = (d.due_date || d.issue_date) < today();
    return h('span', { class: 'tag ' + (late ? 'bad' : 'warn'), text: (d.payment_status === 'partial' ? 'שולם חלקית' : 'פתוח') + (late ? ' · באיחור' : '') });
  }
  if (d.doc_type === 'invoice_receipt') return h('span', { class: 'tag', text: 'שולם' });
  return null;
}

async function list(main) {
  const docs = await q.docs();
  let type = '', text = '', st = '';
  const body = h('div');
  const search = h('input', { class: 'search', placeholder: 'חיפוש לפי לקוח או מספר… ( / )', oninput: (e) => { text = e.target.value.trim(); draw(); } });
  const chips = h('div', { class: 'chips' });
  const draw = () => {
    clear(chips).append(...[['', 'הכול'], ...Object.entries(DOC_TYPES).map(([k, v]) => [k, v.name])].map(([k, n]) =>
      h('span', { class: 'chip' + (type === k ? ' on' : ''), text: n, onclick: () => { type = k; draw(); } })),
      h('span', { class: 'chip' + (st === 'open' ? ' on' : ''), text: 'חובות פתוחים', onclick: () => { st = st === 'open' ? '' : 'open'; draw(); } }));
    const rows = docs.filter((d) => (!type || d.doc_type === type) && (!st || (d.doc_type === 'tax_invoice' && d.status === 'issued' && d.payment_status !== 'paid')) &&
      (!text || d.customer_name.includes(text) || String(d.number) === text));
    clear(body).append(table([
      { label: 'סוג', render: (d) => DOC_TYPES[d.doc_type]?.name },
      { label: 'מספר', num: true, render: (d) => d.number },
      { label: 'תאריך', render: (d) => fmtDate(d.issue_date) },
      { label: 'לקוח', key: 'customer_name' },
      { label: 'סכום', num: true, render: (d) => fmtMoney(d.total) },
      { label: 'סטטוס', render: statusTag },
    ], rows, { onRow: (d) => { location.hash = '#/doc/' + d.id; }, empty: 'עוד לא הופקו מסמכים. לחצו "מסמך חדש".' }));
  };
  main.append(topbar('מסמכים', search, canWrite() ? h('a', { class: 'btn primary', href: '#/doc-new', text: '＋ מסמך חדש' }) : null), h('div', { class: 'card' }, chips, body));
  draw();
}

async function view(main, id) {
  const { d, items, pays } = await q.doc(id);
  const holder = h('div', { class: 'preview-wrap' });
  let paper = renderPaper(d, items, pays, ctx.biz);
  holder.append(paper);
  const t = DOC_TYPES[d.doc_type];
  const printBtn = h('button', { class: 'btn primary', text: '🖨 הדפס / שמור PDF', onclick: async () => {
    try {
      const c = await q.rpc('mark_printed', { doc: d.id });
      d.print_count = c;
      paper.replaceWith(paper = renderPaper(d, items, pays, ctx.biz));
      setTimeout(() => window.print(), 50);
    } catch (e) { toast(friendly(e), 'err'); }
  } });
  const acts = [printBtn];
  if (canWrite() && d.status === 'issued') {
    if (d.doc_type === 'quote') acts.push(h('a', { class: 'btn', href: `#/doc-new/tax_invoice/${d.id}`, text: 'המר לחשבונית מס' }), h('a', { class: 'btn', href: `#/doc-new/deal_invoice/${d.id}`, text: 'המר לחשבון עסקה' }));
    if (d.doc_type === 'deal_invoice') acts.push(h('a', { class: 'btn', href: `#/doc-new/tax_invoice/${d.id}`, text: 'הפק חשבונית מס' }));
    if (d.doc_type === 'tax_invoice' && d.payment_status !== 'paid') acts.push(h('a', { class: 'btn', href: `#/doc-new/receipt/${d.id}`, text: 'הפק קבלה (סגירת חוב)' }));
    if (['tax_invoice', 'invoice_receipt'].includes(d.doc_type)) acts.push(h('a', { class: 'btn danger', href: `#/doc-new/credit_note/${d.id}`, text: 'ביטול / זיכוי' }));
  }
  const info = h('div', { class: 'card no-print' },
    h('div', { class: 'row' }, h('strong', { text: `${t.name} מספר ${d.number}` }), statusTag(d),
      d.doc_type === 'tax_invoice' ? h('span', { text: `שולם ${fmtMoney(d.paid_amount)} מתוך ${fmtMoney(d.total)}` }) : null,
      d.cancelled_by_doc_id ? h('a', { href: '#/doc/' + d.cancelled_by_doc_id, text: 'נסגר בחשבונית זיכוי' }) : null,
      d.related_doc_id ? h('a', { href: '#/doc/' + d.related_doc_id, text: 'מסמך מקור' }) : null),
    h('div', { class: 'hint', text: 'מסמך שהופק אינו ניתן לעריכה או למחיקה. ההדפסה הראשונה מסומנת "מקור" והבאות "העתק נאמן למקור".' }));
  main.append(topbar(`${t.name} #${d.number}`, ...acts), info, holder);
}

async function form(main, type, relId) {
  if (!canWrite()) { main.append(h('div', { class: 'note err', text: 'אין לך הרשאה להפיק מסמכים.' })); return; }
  const contacts = (await q.contacts()).filter((c) => c.kind !== 'supplier');
  const openInv = (await q.docs({ type: 'tax_invoice' })).filter((d) => d.status === 'issued' && d.payment_status !== 'paid');
  const biz = ctx.biz;
  const S = { type, contact_id: '', customer_name: '', customer_tax_id: '', customer_address: '', issue_date: today(), due_date: addDays(today(), 30),
    items: [{ description: '', qty: 1, unit_price: '', discount_pct: 0 }], payments: [{ method: 'transfer', amount: '' }], allocation_number: '', notes: '', related_doc_id: '' };
  if (relId) {
    const { d, items } = await q.doc(relId);
    Object.assign(S, { contact_id: d.contact_id || '', customer_name: d.customer_name, customer_tax_id: d.customer_tax_id || '', customer_address: d.customer_address || '', related_doc_id: d.id });
    if (['tax_invoice', 'deal_invoice'].includes(type) || type === 'credit_note') S.items = items.map((i) => ({ description: i.description, qty: i.qty, unit_price: i.unit_price, discount_pct: i.discount_pct }));
    if (type === 'receipt') S.payments = [{ method: 'transfer', amount: r2(d.total - d.paid_amount) }];
    if (type === 'credit_note') S.notes = `זיכוי עבור חשבונית מס מספר ${d.number}`;
    if (type !== 'receipt' && type !== 'credit_note') S.related_doc_id = '';
  }
  const T = () => DOC_TYPES[S.type];
  const holder = h('div', { class: 'preview-wrap' });
  const formBox = h('div', { class: 'doc-form' });
  const err = h('div', { class: 'note err', hidden: true });
  const refresh = () => {
    const cfg = T();
    const tot = calcTotals(S.items, biz.vat_type === 'exempt' ? 0 : biz.vat_rate, S.type === 'receipt', S.payments);
    const doc = { doc_type: S.type, number: 0, customer_name: S.customer_name, customer_tax_id: S.customer_tax_id, customer_address: S.customer_address, issue_date: S.issue_date,
      due_date: S.due_date, vat_rate: biz.vat_type === 'exempt' ? 0 : biz.vat_rate, subtotal: tot.subtotal, vat_amount: tot.vat, total: tot.total, allocation_number: S.allocation_number, notes: S.notes, status: 'issued' };
    const its = S.items.map((i) => ({ ...i }));
    clear(holder).append(renderPaper(doc, cfg.items ? its : [], cfg.pays ? S.payments.filter((p) => Number(p.amount) > 0) : [], biz, { label: '' }));
    const totBox = document.getElementById('totbox');
    if (totBox) { clear(totBox).append(h('div', null, h('span', { text: 'לפני מע"מ' }), h('span', { text: fmtMoney(tot.subtotal) })), h('div', null, h('span', { text: 'מע"מ' }), h('span', { text: fmtMoney(tot.vat) })), h('div', { class: 'big' }, h('span', { text: 'סה"כ' }), h('span', { text: fmtMoney(tot.total) }))); }
    const al = document.getElementById('allocbox');
    if (al) al.hidden = !needAlloc(tot);
    return tot;
  };
  const needAlloc = (tot) => ['tax_invoice', 'invoice_receipt'].includes(S.type) && biz.vat_type !== 'exempt' && S.customer_tax_id && tot.subtotal > Number(biz.allocation_threshold);

  const bind = (k, extra) => (e) => { S[k] = e.target.value; if (extra) extra(); refresh(); };
  const itemRows = h('tbody');
  const drawItems = () => {
    clear(itemRows).append(...S.items.map((it, n) => h('tr', null,
      h('td', null, h('input', { value: it.description, placeholder: 'תיאור', oninput: (e) => { it.description = e.target.value; refresh(); } })),
      h('td', null, h('input', { type: 'number', step: 'any', min: '0', value: it.qty, oninput: (e) => { it.qty = e.target.value; refresh(); } })),
      h('td', null, h('input', { type: 'number', step: '0.01', min: '0', value: it.unit_price, placeholder: '0.00', oninput: (e) => { it.unit_price = e.target.value; refresh(); } })),
      h('td', null, h('input', { type: 'number', step: '0.1', min: '0', max: '100', value: it.discount_pct, oninput: (e) => { it.discount_pct = e.target.value; refresh(); } })),
      h('td', null, h('button', { class: 'btn small', type: 'button', text: '✕', 'aria-label': 'הסר שורה', onclick: () => { if (S.items.length > 1) { S.items.splice(n, 1); drawItems(); refresh(); } } })))));
  };
  const payRows = h('tbody');
  const drawPays = () => {
    clear(payRows).append(...S.payments.map((p, n) => h('tr', null,
      h('td', null, select(Object.entries(PAY_METHODS), p.method, { onchange: (e) => { p.method = e.target.value; drawPays(); refresh(); } })),
      h('td', null, h('input', { type: 'number', step: '0.01', min: '0', value: p.amount, placeholder: 'סכום', oninput: (e) => { p.amount = e.target.value; refresh(); } })),
      h('td', null, p.method === 'check' ? h('div', { class: 'row' }, h('input', { placeholder: "מס' צ'ק", value: p.check_no || '', oninput: (e) => { p.check_no = e.target.value; refresh(); } }),
        h('input', { placeholder: 'בנק', value: p.bank || '', oninput: (e) => { p.bank = e.target.value; } }), h('input', { type: 'date', value: p.check_date || '', oninput: (e) => { p.check_date = e.target.value; } })) :
        h('input', { placeholder: 'אסמכתא / הערה', value: p.reference || '', oninput: (e) => { p.reference = e.target.value; } })),
      h('td', null, h('button', { class: 'btn small', type: 'button', text: '✕', onclick: () => { if (S.payments.length > 1) { S.payments.splice(n, 1); drawPays(); refresh(); } } })))));
  };
  const itemsCard = h('div', { class: 'card', id: 'itemsCard' }, h('h3', { text: 'פריטים' }),
    h('table', { class: 'items tbl' }, h('thead', null, h('tr', null, ['תיאור', 'כמות', 'מחיר (לפני מע"מ)', 'הנחה %', ''].map((x) => h('th', { text: x })))), itemRows),
    h('button', { class: 'btn small', type: 'button', text: '＋ הוספת שורה', onclick: () => { S.items.push({ description: '', qty: 1, unit_price: '', discount_pct: 0 }); drawItems(); } }),
    h('div', { class: 'totals', id: 'totbox' }));
  const paysCard = h('div', { class: 'card', id: 'paysCard' }, h('h3', { text: 'תשלומים' }),
    h('table', { class: 'items tbl' }, h('thead', null, h('tr', null, ['אמצעי', 'סכום', 'פרטים', ''].map((x) => h('th', { text: x })))), payRows),
    h('button', { class: 'btn small', type: 'button', text: '＋ אמצעי תשלום נוסף', onclick: () => { S.payments.push({ method: 'cash', amount: '' }); drawPays(); } }));

  const custSel = select([['', 'לקוח מזדמן / הקלדה חופשית'], ...contacts.map((c) => [c.id, c.name])], S.contact_id, { onchange: (e) => {
    const c = contacts.find((x) => x.id === e.target.value);
    S.contact_id = e.target.value;
    if (c) { Object.assign(S, { customer_name: c.name, customer_tax_id: c.tax_id || '', customer_address: c.address || '', due_date: addDays(S.issue_date, c.payment_terms) }); }
    draw();
  } });
  const typeSel = select(Object.entries(DOC_TYPES).map(([k, v]) => [k, v.name]), S.type, { onchange: (e) => { S.type = e.target.value; draw(); } });
  const relSel = () => select([['', '— ללא —'], ...openInv.filter((d) => !S.customer_name || d.customer_name === S.customer_name || d.id === S.related_doc_id).map((d) => [d.id, `חשבונית ${d.number} · ${d.customer_name} · יתרה ${fmtMoney(d.total - d.paid_amount)}`])], S.related_doc_id, {
    onchange: (e) => { S.related_doc_id = e.target.value; const d = openInv.find((x) => x.id === e.target.value); if (d) { Object.assign(S, { contact_id: d.contact_id || '', customer_name: d.customer_name, customer_tax_id: d.customer_tax_id || '', customer_address: d.customer_address || '' }); S.payments[0].amount = r2(d.total - d.paid_amount); draw(); } } });

  const submit = async () => {
    err.hidden = true;
    const cfg = T(), tot = refresh();
    const fail = (m) => { err.textContent = m; err.hidden = false; err.scrollIntoView({ block: 'center' }); };
    if (!S.customer_name.trim()) return fail('יש להזין שם לקוח.');
    if (S.customer_tax_id && !validId(S.customer_tax_id)) return fail('מספר ח.פ / ת.ז / ע.מ אינו תקין (ספרת ביקורת).');
    if (cfg.items && !tot.total) return fail('יש להזין לפחות שורה אחת עם סכום.');
    if (cfg.pays && !S.payments.some((p) => Number(p.amount) > 0)) return fail('יש להזין תשלום.');
    if (S.type === 'invoice_receipt' && Math.abs(S.payments.reduce((a, p) => a + Number(p.amount || 0), 0) - tot.total) > 0.009) return fail(`סכום התשלומים חייב להיות שווה לסכום החשבונית (${fmtMoney(tot.total)}).`);
    if (needAlloc(tot) && !S.allocation_number.trim()) return fail(`חשבונית מעל ${fmtMoney(biz.allocation_threshold)} לפני מע"מ ללקוח עוסק מורשה חייבת מספר הקצאה מרשות המסים.`);
    const ok = await confirmBox('הפקת מסמך', `להפיק ${cfg.name} ל"${S.customer_name}" על סך ${fmtMoney(tot.total)}? לאחר ההפקה לא ניתן לערוך את המסמך.`);
    if (!ok) return;
    btn.disabled = true;
    try {
      const res = await q.rpc('issue_document', { p: { business_id: bid(), doc_type: S.type, contact_id: S.contact_id || null, customer_name: S.customer_name, customer_tax_id: S.customer_tax_id,
        customer_address: S.customer_address, issue_date: S.issue_date, due_date: S.due_date || null,
        items: cfg.items ? S.items.filter((i) => i.description.trim()).map((i) => ({ description: i.description, qty: Number(i.qty || 1), unit_price: Number(i.unit_price || 0), discount_pct: Number(i.discount_pct || 0) })) : [],
        payments: cfg.pays ? S.payments.filter((p) => Number(p.amount) > 0).map((p) => ({ method: p.method, amount: Number(p.amount), check_no: p.check_no || '', bank: p.bank || '', check_date: p.check_date || '', reference: p.reference || '' })) : [],
        allocation_number: S.allocation_number, notes: S.notes, related_doc_id: ['receipt', 'credit_note'].includes(S.type) ? S.related_doc_id || null : null } });
      toast(`${cfg.name} מספר ${res.number} הופקה`);
      location.hash = '#/doc/' + res.id;
    } catch (e) { fail(friendly(e)); btn.disabled = false; }
  };
  const btn = h('button', { class: 'btn primary', type: 'button', text: 'הפקת מסמך (Ctrl+Enter)', onclick: submit });

  function draw() {
    const cfg = T();
    clear(formBox).append(
      h('div', { class: 'card' }, h('div', { class: 'cols2' }, field('סוג מסמך', typeSel), field('תאריך', h('input', { type: 'date', value: S.issue_date, oninput: bind('issue_date') }))),
        h('div', { class: 'cols2' }, field('לקוח', custSel), field('שם לקוח', h('input', { value: S.customer_name, oninput: bind('customer_name') }))),
        h('div', { class: 'cols3' }, field('ח.פ / ע.מ / ת.ז', h('input', { value: S.customer_tax_id, dir: 'ltr', oninput: bind('customer_tax_id') })),
          field('כתובת', h('input', { value: S.customer_address, oninput: bind('customer_address') })),
          cfg.pays && !cfg.items ? null : field('לתשלום עד', h('input', { type: 'date', value: S.due_date, oninput: bind('due_date') }))),
        S.type === 'receipt' || S.type === 'credit_note' ? field(S.type === 'receipt' ? 'חשבונית לסגירה' : 'חשבונית לזיכוי', relSel()) : null),
      cfg.items ? itemsCard : null, cfg.pays ? paysCard : null,
      h('div', { class: 'card', id: 'allocbox', hidden: true },
        h('div', { class: 'note', text: `חשבונית מס מעל ${fmtMoney(biz.allocation_threshold)} לפני מע"מ ללקוח עוסק מורשה דורשת מספר הקצאה מרשות המסים (מודל חשבוניות ישראל).` }),
        h('a', { href: 'https://www.gov.il/he/departments/israel_tax_authority', target: '_blank', rel: 'noopener noreferrer', text: 'לאזור האישי ברשות המסים (בקשת מספר הקצאה)' }),
        field('מספר הקצאה', h('input', { value: S.allocation_number, dir: 'ltr', oninput: bind('allocation_number') }))),
      h('div', { class: 'card' }, field('הערות', h('textarea', { rows: 2, value: S.notes, oninput: bind('notes') })), err, btn));
    drawItems(); drawPays(); refresh();
  }
  main.append(topbar('מסמך חדש'), h('div', { class: 'doc-layout' }, formBox, holder));
  draw();
  const key = (e) => { if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); submit(); } };
  document.addEventListener('keydown', key);
  window.addEventListener('hashchange', () => document.removeEventListener('keydown', key), { once: true });
}
