import { h, clear, topbar, toast, field, select, table, modal, confirmBox } from '../ui.js';
import { q, sb, bid, canWrite, unwrap, friendly } from '../api.js';
import { fmtMoney, fmtDate, validId, DOC_TYPES } from '../il.js';

const KINDS = { customer: 'לקוח', supplier: 'ספק', both: 'לקוח וספק' };

export async function render(main) {
  const [contacts, docs, exps] = await Promise.all([q.contacts(), q.docs({ limit: 3000 }), q.expenses()]);
  const debt = (id) => docs.filter((d) => d.contact_id === id && d.doc_type === 'tax_invoice' && d.status === 'issued').reduce((a, d) => a + Number(d.total) - Number(d.paid_amount), 0);
  const spent = (id) => exps.filter((e) => e.supplier_id === id).reduce((a, e) => a + Number(e.total), 0);
  let text = '', kind = '';
  const body = h('div');
  const search = h('input', { class: 'search', placeholder: 'חיפוש שם, טלפון, ח.פ… ( / )', oninput: (e) => { text = e.target.value.trim(); draw(); } });
  const draw = () => {
    const rows = contacts.filter((c) => (!kind || c.kind === kind || c.kind === 'both') && (!text || [c.name, c.phone, c.tax_id, c.email].some((x) => (x || '').includes(text))));
    clear(body).append(table([
      { label: 'שם', key: 'name' }, { label: 'סוג', render: (c) => h('span', { class: 'tag mute', text: KINDS[c.kind] }) },
      { label: 'ח.פ / ת.ז', render: (c) => c.tax_id || '' }, { label: 'טלפון', render: (c) => c.phone || '' },
      { label: 'יתרת חוב', num: true, render: (c) => (c.kind !== 'supplier' ? fmtMoney(debt(c.id)) : '') },
      { label: 'הוצאות מול הספק', num: true, render: (c) => (c.kind !== 'customer' ? fmtMoney(spent(c.id)) : '') },
    ], rows, { onRow: (c) => card(c), empty: 'עוד אין לקוחות או ספקים.' }));
  };
  const reload = () => { location.hash = '#/contacts'; render2(); };
  const render2 = () => { clear(main); return render(main); };

  function card(c) {
    const mine = docs.filter((d) => d.contact_id === c.id);
    const close = modal(c.name, h('div', null,
      h('div', { class: 'cols2' }, h('div', { text: 'ח.פ/ת.ז: ' + (c.tax_id || '—') }), h('div', { text: 'טלפון: ' + (c.phone || '—') }), h('div', { text: 'מייל: ' + (c.email || '—') }), h('div', { text: 'תנאי תשלום: שוטף + ' + c.payment_terms })),
      c.address ? h('div', { text: 'כתובת: ' + c.address }) : null, c.notes ? h('div', { class: 'note', text: c.notes }) : null,
      c.kind !== 'supplier' ? h('p', null, h('strong', { text: 'יתרת חוב: ' + fmtMoney(debt(c.id)) })) : null,
      h('h3', { text: 'היסטוריית מסמכים' }),
      table([{ label: 'מסמך', render: (d) => `${DOC_TYPES[d.doc_type].name} ${d.number}` }, { label: 'תאריך', render: (d) => fmtDate(d.issue_date) }, { label: 'סכום', num: true, render: (d) => fmtMoney(d.total) }],
        mine.slice(0, 30), { onRow: (d) => { close(); location.hash = '#/doc/' + d.id; }, empty: 'אין מסמכים.' })),
    [canWrite() ? { text: 'עריכה', class: 'primary', onclick: (cl) => { cl(); edit(c); } } : null,
      canWrite() ? { text: 'מחיקה', class: 'danger', onclick: async (cl) => { cl(); if (await confirmBox('מחיקת איש קשר', `למחוק את ${c.name}? מסמכים קיימים נשמרים.`)) { try { unwrap(await sb.from('contacts').delete().eq('id', c.id)); toast('נמחק'); render2(); } catch (e) { toast(friendly(e), 'err'); } } } } : null,
      { text: 'סגירה', onclick: (cl) => cl() }].filter(Boolean));
  }
  function edit(c) {
    const S = { kind: 'customer', name: '', tax_id: '', phone: '', email: '', address: '', payment_terms: 30, notes: '', ...(c || {}) };
    const err = h('div', { class: 'note err', hidden: true });
    const inp = (k, attrs = {}) => h('input', { value: S[k] ?? '', oninput: (e) => { S[k] = e.target.value; }, ...attrs });
    modal(c ? 'עריכת איש קשר' : 'איש קשר חדש', h('div', null,
      h('div', { class: 'cols2' }, field('סוג', select(Object.entries(KINDS), S.kind, { onchange: (e) => { S.kind = e.target.value; } })), field('שם', inp('name'))),
      h('div', { class: 'cols2' }, field('ח.פ / ע.מ / ת.ז', inp('tax_id', { dir: 'ltr' }), 'נבדקת ספרת ביקורת'), field('טלפון', inp('phone', { dir: 'ltr' }))),
      h('div', { class: 'cols2' }, field('אימייל', inp('email', { dir: 'ltr', type: 'email' })), field('תנאי תשלום (ימים)', inp('payment_terms', { type: 'number', min: 0 }))),
      field('כתובת', inp('address')), field('הערות', h('textarea', { rows: 2, value: S.notes || '', oninput: (e) => { S.notes = e.target.value; } })), err),
    [{ text: 'שמירה', class: 'primary', onclick: async (cl) => {
      if (!S.name.trim()) { err.textContent = 'חסר שם.'; err.hidden = false; return; }
      if (S.tax_id && !validId(S.tax_id)) { err.textContent = 'מספר ח.פ/ת.ז אינו תקין (ספרת ביקורת).'; err.hidden = false; return; }
      const row = { kind: S.kind, name: S.name.trim(), tax_id: S.tax_id || null, phone: S.phone || null, email: S.email || null, address: S.address || null, payment_terms: Number(S.payment_terms) || 0, notes: S.notes || null };
      try {
        if (c) unwrap(await sb.from('contacts').update(row).eq('id', c.id)); else unwrap(await sb.from('contacts').insert({ ...row, business_id: bid() }));
        cl(); toast('נשמר'); render2();
      } catch (e) { err.textContent = friendly(e); err.hidden = false; }
    } }, { text: 'ביטול', onclick: (cl) => cl() }]);
  }
  main.append(topbar('לקוחות וספקים', search, canWrite() ? h('button', { class: 'btn primary', text: '＋ איש קשר חדש', onclick: () => edit(null) }) : null),
    h('div', { class: 'card' }, h('div', { class: 'chips' }, [['', 'הכול'], ['customer', 'לקוחות'], ['supplier', 'ספקים']].map(([k, n]) => h('span', { class: 'chip' + (kind === k ? ' on' : ''), text: n, onclick: () => { kind = k; draw(); } }))), body));
  draw();
}
