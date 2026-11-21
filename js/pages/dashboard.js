import { h, topbar, svgEl, table } from '../ui.js';
import { q, ctx, bid, canWrite } from '../api.js';
import { fmtMoney, fmtDate, today } from '../il.js';

function chart(months) {
  const W = 720, Hh = 220, pad = 28, max = Math.max(1, ...months.flatMap((m) => [m.income, m.expenses]));
  const bw = (W - pad * 2) / months.length;
  const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${W} ${Hh}`, role: 'img', 'aria-label': 'הכנסות והוצאות חודשיות' });
  months.forEach((m, i) => {
    const x = pad + i * bw;
    const hi = (m.income / max) * (Hh - 50), he = (m.expenses / max) * (Hh - 50);
    svg.append(svgEl('rect', { class: 'bar-in', x: x + 4, y: Hh - 24 - hi, width: bw / 2 - 5, height: hi, rx: 3 }, svgEl('title', {}, `${m.month} הכנסות ${fmtMoney(m.income)}`)));
    svg.append(svgEl('rect', { class: 'bar-ex', x: x + bw / 2, y: Hh - 24 - he, width: bw / 2 - 5, height: he, rx: 3 }, svgEl('title', {}, `${m.month} הוצאות ${fmtMoney(m.expenses)}`)));
    svg.append(svgEl('text', { class: 'axis', x: x + bw / 2, y: Hh - 8, 'text-anchor': 'middle' }, m.month.slice(5) + '/' + m.month.slice(2, 4)));
  });
  return svg;
}

export async function render(main) {
  const dash = await q.rpc('report_dashboard', { bid: bid() });
  const open = (await q.docs({ type: 'tax_invoice', limit: 500 })).filter((d) => d.status === 'issued' && d.payment_status !== 'paid')
    .sort((a, b) => (a.due_date || a.issue_date).localeCompare(b.due_date || b.issue_date)).slice(0, 8);
  const cur = dash.months[dash.months.length - 1], prev = dash.months[dash.months.length - 2];
  const kpi = (t, v, cls = '') => h('div', { class: 'card kpi ' + cls }, h('div', { class: 't', text: t }), h('div', { class: 'v', text: v }));
  main.append(topbar('לוח בקרה', canWrite() ? h('a', { class: 'btn primary', href: '#/doc-new', text: '＋ מסמך חדש  (Alt+N)' }) : null),
    h('div', { class: 'grid g4' },
      kpi('הכנסות החודש (לפני מע"מ)', fmtMoney(cur.income)),
      kpi('הוצאות החודש', fmtMoney(cur.expenses)),
      kpi('חובות פתוחים', fmtMoney(dash.open_debt)),
      kpi('חשבוניות באיחור', String(dash.overdue_count), dash.overdue_count ? 'warn' : '')),
    h('div', { class: 'card' }, h('h2', { text: 'הכנסות והוצאות — 12 חודשים' }),
      h('div', { class: 'row' }, h('span', { class: 'tag', text: '■ הכנסות' }), h('span', { class: 'tag warn', text: '■ הוצאות' }), prev ? h('span', { class: 'hint', text: `חודש קודם: הכנסות ${fmtMoney(prev.income)}` }) : null),
      chart(dash.months)),
    h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { text: 'חשבוניות פתוחות' }), h('span', { class: 'spacer' }), h('a', { href: '#/collections', text: 'תזכורות גבייה ←' })),
      table([{ label: 'מספר', num: true, key: 'number' }, { label: 'לקוח', key: 'customer_name' }, { label: 'לתשלום עד', render: (d) => fmtDate(d.due_date || d.issue_date) },
        { label: 'יתרה', num: true, render: (d) => fmtMoney(d.total - d.paid_amount) },
        { label: '', render: (d) => (d.due_date || d.issue_date) < today() ? h('span', { class: 'tag bad', text: 'באיחור' }) : null }],
      open, { onRow: (d) => { location.hash = '#/doc/' + d.id; }, empty: 'אין חובות פתוחים. כל הכבוד!' })));
}
