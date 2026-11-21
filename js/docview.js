// תבנית מסמך A4 (משמשת גם לתצוגה חיה וגם להדפסה)
import { h } from './ui.js';
import { DOC_TYPES, PAY_METHODS, VAT_TYPES, fmtMoney, fmtNum, fmtDate, amountInWords } from './il.js';

export function paperLabel(printCount) {
  if (printCount === undefined || printCount === null) return '';
  return printCount <= 0 ? '' : printCount === 1 ? 'מקור' : 'העתק נאמן למקור';
}

export function renderPaper(doc, items, pays, biz, opts = {}) {
  const t = DOC_TYPES[doc.doc_type] || { name: '' };
  const isRec = doc.doc_type === 'receipt';
  const label = opts.label ?? paperLabel(doc.print_count);
  const bizLines = [
    VAT_TYPES[biz.vat_type] + (biz.vat_number ? ' · ' + biz.vat_number : ''),
    biz.address, [biz.phone, biz.email].filter(Boolean).join(' · '),
  ].filter(Boolean);

  const head = h('div', { class: 'ph' },
    h('div', { class: 'biz' }, biz.logo ? h('img', { src: biz.logo, alt: 'לוגו' }) : null,
      h('div', null, h('div', { class: 'bn', text: biz.name }), bizLines.map((l) => h('div', { class: 'bd', text: l })))),
    h('div', { class: 'dt' }, h('div', { class: 'tt', text: t.name }),
      h('div', { class: 'nn', text: doc.number ? '#' + doc.number : 'טיוטה' }),
      label ? h('div', { class: 'orig', text: label }) : null));

  const meta = h('div', { class: 'meta' },
    h('div', { class: 'box' }, h('h4', { text: 'לכבוד' }), h('div', { text: doc.customer_name || '—' }),
      doc.customer_tax_id ? h('div', { text: 'ח.פ/ע.מ/ת.ז: ' + doc.customer_tax_id }) : null,
      doc.customer_address ? h('div', { text: doc.customer_address }) : null),
    h('div', { class: 'box' }, h('h4', { text: 'פרטי המסמך' }), h('div', { text: 'תאריך: ' + fmtDate(doc.issue_date) }),
      doc.due_date && !isRec ? h('div', { text: 'לתשלום עד: ' + fmtDate(doc.due_date) }) : null,
      doc.allocation_number ? h('div', { text: 'מספר הקצאה: ' + doc.allocation_number }) : null));

  const rows = (items || []).filter((i) => String(i.description || '').trim());
  const itemTable = rows.length ? h('table', null,
    h('thead', null, h('tr', null, ['#', 'תיאור', 'כמות', 'מחיר ליחידה', 'הנחה', 'סה"כ'].map((x, i) => h('th', { class: i > 1 ? 'n' : '', text: x })))),
    h('tbody', null, rows.map((i, n) => {
      const lt = i.line_total !== undefined ? Number(i.line_total) : Number(i.qty ?? 1) * Number(i.unit_price || 0) * (1 - Number(i.discount_pct || 0) / 100);
      return h('tr', null, h('td', { text: n + 1 }), h('td', { text: i.description }), h('td', { class: 'n', text: fmtNum(i.qty ?? 1, 0 + (Number(i.qty) % 1 ? 2 : 0)) }),
        h('td', { class: 'n', text: fmtNum(i.unit_price) }), h('td', { class: 'n', text: Number(i.discount_pct) ? fmtNum(i.discount_pct, 0) + '%' : '' }), h('td', { class: 'n', text: fmtNum(lt) }));
    }))) : null;

  const payTable = (pays || []).length ? h('table', null,
    h('thead', null, h('tr', null, ['אמצעי תשלום', 'פרטים', 'סכום'].map((x, i) => h('th', { class: i === 2 ? 'n' : '', text: x })))),
    h('tbody', null, pays.map((p) => h('tr', null, h('td', { text: PAY_METHODS[p.method] || p.method }),
      h('td', { text: [p.bank, p.check_no ? "צ'ק " + p.check_no : '', p.check_date ? fmtDate(p.check_date) : '', p.reference].filter(Boolean).join(' · ') }),
      h('td', { class: 'n', text: fmtNum(p.amount) }))))) : null;

  const sums = h('div', { class: 'sums' },
    isRec ? null : h('div', null, h('span', { text: 'סכום לפני מע"מ' }), h('span', { class: 'n', text: fmtMoney(doc.subtotal) })),
    isRec ? null : h('div', null, h('span', { text: Number(doc.vat_rate) ? `מע"מ ${fmtNum(doc.vat_rate, 0)}%` : 'פטור ממע"מ' }), h('span', { class: 'n', text: fmtMoney(doc.vat_amount) })),
    h('div', { class: 'tot' }, h('span', { text: isRec ? 'סה"כ התקבל' : 'סה"כ לתשלום' }), h('span', { class: 'n', text: fmtMoney(doc.total) })));

  return h('div', { class: 'paper' },
    doc.status === 'cancelled' ? h('div', { class: 'cancelled', text: 'מבוטל' }) : null,
    head, meta, itemTable, payTable, sums,
    Number(doc.total) ? h('div', { class: 'words', text: 'במילים: ' + amountInWords(doc.total) }) : null,
    doc.notes ? h('div', { class: 'words', text: 'הערות: ' + doc.notes }) : null,
    h('div', { class: 'foot', text: 'הופק ממוחשב' + (doc.number ? ' · ' + t.name + ' מס\' ' + doc.number : '') + (doc.issued_at ? ' · ' + new Date(doc.issued_at).toLocaleString('he-IL') : '') }));
}
