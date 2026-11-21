import { h, clear, topbar, field, table, select } from '../ui.js';
import { q, ctx, bid } from '../api.js';
import { fmtMoney, today, fmtDate } from '../il.js';

function period(freq, offset = 0) {
  const d = new Date(); let m = d.getMonth(), y = d.getFullYear();
  const span = freq === 'monthly' ? 1 : 2;
  let start = freq === 'monthly' ? m : m - (m % 2);
  start += offset * span;
  const s = new Date(Date.UTC(y, start, 1)), e = new Date(Date.UTC(y, start + span, 0));
  return [s.toISOString().slice(0, 10), e.toISOString().slice(0, 10)];
}

export async function render(main, _n, params) {
  let tab = params[0] || 'vat';
  const [d0, d1] = period(ctx.biz.report_freq, 0);
  let from = d0, to = d1;
  const body = h('div');
  const tabs = h('div', { class: 'chips' });
  const row = (a, b, bold) => h('tr', null, h('td', { text: a }), h('td', { class: 'num', text: b }));
  const sum = (rows) => h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('tbody', null, rows.map(([a, b, c]) => h('tr', { class: c ? 'tag-row' : '' }, h('td', null, c ? h('strong', { text: a }) : a), h('td', { class: 'num' }, c ? h('strong', { text: b }) : b))))));

  async function draw() {
    clear(tabs).append(...[['vat', 'דוח מע"מ'], ['pnl', 'רווח והפסד'], ['adv', 'מקדמות מס הכנסה'], ['aging', 'גיל חובות']].map(([k, n]) => h('span', { class: 'chip' + (tab === k ? ' on' : ''), text: n, onclick: () => { tab = k; draw(); } })));
    clear(body);
    if (tab === 'aging') return aging();
    const pr = h('div', { class: 'row no-print' },
      field('מתאריך', h('input', { type: 'date', value: from, onchange: (e) => { from = e.target.value; draw(); } })),
      field('עד תאריך', h('input', { type: 'date', value: to, onchange: (e) => { to = e.target.value; draw(); } })),
      h('button', { class: 'btn small', text: 'תקופה קודמת', onclick: () => { [from, to] = period(ctx.biz.report_freq, -1); draw(); } }),
      h('button', { class: 'btn small', text: 'תקופה נוכחית', onclick: () => { [from, to] = period(ctx.biz.report_freq, 0); draw(); } }),
      h('button', { class: 'btn small', text: 'שנה נוכחית', onclick: () => { from = new Date().getFullYear() + '-01-01'; to = new Date().getFullYear() + '-12-31'; draw(); } }));
    body.append(pr);
    if (tab === 'vat') {
      const v = await q.rpc('report_vat', { bid: bid(), d1: from, d2: to });
      body.append(h('div', { class: 'card' }, h('h2', { text: `דוח מע"מ ${fmtDate(from)} – ${fmtDate(to)}` }), h('div', { class: 'hint', text: `תדירות דיווח: ${ctx.biz.report_freq === 'monthly' ? 'חד-חודשית' : 'דו-חודשית'} · עסקאות: חשבוניות מס, חשבוניות מס/קבלה, קבלות עצמאיות, בניכוי זיכויים` }),
        sum([['עסקאות חייבות (לפני מע"מ)', fmtMoney(v.sales_net)], ['מע"מ עסקאות', fmtMoney(v.output_vat)], ['תשומות (הוצאות לפני מע"מ)', fmtMoney(v.inputs_net)], ['מע"מ תשומות מוכר', fmtMoney(v.input_vat)],
          [v.payable >= 0 ? 'מע"מ לתשלום' : 'מע"מ להחזר', fmtMoney(Math.abs(v.payable)), true]]),
        h('div', { class: 'hint', text: `${v.sales_docs} מסמכי הכנסה · ${v.expense_count} הוצאות בתקופה` })));
    } else if (tab === 'pnl') {
      const p = await q.rpc('report_pnl', { bid: bid(), d1: from, d2: to });
      body.append(h('div', { class: 'card' }, h('h2', { text: `רווח והפסד ${fmtDate(from)} – ${fmtDate(to)}` }),
        sum([['הכנסות (לפני מע"מ, נטו מזיכויים)', fmtMoney(p.income)], ['הוצאות (כולל מע"מ שאינו מוכר)', fmtMoney(p.expenses)], ['רווח (הפסד) לפני מס', fmtMoney(p.income - p.expenses), true]]),
        h('h3', { text: 'הוצאות לפי קטגוריה' }), table([{ label: 'קטגוריה', key: 'category' }, { label: 'סכום', num: true, render: (r) => fmtMoney(r.amount) }, { label: '% מההוצאות', num: true, render: (r) => (p.expenses ? Math.round((r.amount / p.expenses) * 100) + '%' : '') }], p.by_category)));
    } else if (tab === 'adv') {
      const p = await q.rpc('report_pnl', { bid: bid(), d1: from, d2: to });
      const pct = Number(ctx.biz.advance_pct);
      body.append(h('div', { class: 'card' }, h('h2', { text: 'מקדמות מס הכנסה' }),
        pct ? null : h('div', { class: 'note', text: 'לא הוגדר אחוז מקדמות. אחוז המקדמות נקבע על ידי פקיד השומה — עדכנו אותו בהגדרות העסק.' }),
        sum([['מחזור לתקופה (לפני מע"מ)', fmtMoney(p.income)], ['אחוז מקדמות (מהגדרות)', pct + '%'], ['מקדמה לתשלום', fmtMoney(p.income * pct / 100), true]]),
        h('div', { class: 'hint', text: 'חישוב משוער בלבד. יש לפעול לפי השומה ולהתייעץ עם רואה החשבון.' })));
    }
  }
  async function aging() {
    const docs = (await q.docs({ type: 'tax_invoice', limit: 3000 })).filter((d) => d.status === 'issued' && d.payment_status !== 'paid');
    const B = ['עדיין לא באיחור', '1–30 ימים', '31–60 ימים', '61–90 ימים', 'מעל 90 ימים'];
    const by = {};
    for (const d of docs) {
      const late = Math.floor((Date.parse(today()) - Date.parse(d.due_date || d.issue_date)) / 86400000);
      const b = late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4;
      const r = (by[d.customer_name] ||= [0, 0, 0, 0, 0]); r[b] += Number(d.total) - Number(d.paid_amount);
    }
    const rows = Object.entries(by).map(([name, r]) => ({ name, r, tot: r.reduce((a, b) => a + b, 0) })).sort((a, b) => b.tot - a.tot);
    const totals = [0, 1, 2, 3, 4].map((i) => rows.reduce((a, x) => a + x.r[i], 0));
    body.append(h('div', { class: 'card' }, h('h2', { text: 'גיל חובות (חשבוניות מס פתוחות)' }),
      table([{ label: 'לקוח', key: 'name' }, ...B.map((b, i) => ({ label: b, num: true, render: (x) => (x.r[i] ? fmtMoney(x.r[i]) : '') })), { label: 'סה"כ', num: true, render: (x) => fmtMoney(x.tot) }],
        [...rows, { name: 'סה"כ', r: totals, tot: totals.reduce((a, b) => a + b, 0) }], { empty: 'אין חובות פתוחים.' })));
  }
  main.append(topbar('דוחות', h('button', { class: 'btn no-print', text: '🖨 הדפס', onclick: () => window.print() })), h('div', { class: 'card no-print' }, tabs), body);
  await draw();
}
