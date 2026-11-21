// תזכורות גבייה. האתר לא שולח כלום: מעתיקים, פותחים מייל או וואטסאפ, והמשתמש שולח בעצמו.
import { h, topbar, table, toast, modal, field } from '../ui.js';
import { q, ctx } from '../api.js';
import { fmtMoney, fmtDate, today } from '../il.js';

function waPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = '972' + d.slice(1);
  return d;
}

export async function render(main) {
  const [docs, contacts] = await Promise.all([q.docs({ type: 'tax_invoice', limit: 3000 }), q.contacts()]);
  const cmap = new Map(contacts.map((c) => [c.id, c]));
  const late = docs.filter((d) => d.status === 'issued' && d.payment_status !== 'paid' && (d.due_date || d.issue_date) < today())
    .sort((a, b) => (a.due_date || a.issue_date).localeCompare(b.due_date || b.issue_date));
  const days = (d) => Math.floor((Date.parse(today()) - Date.parse(d.due_date || d.issue_date)) / 86400000);

  const msg = (d) => `שלום ${d.customer_name},\nתזכורת ידידותית: חשבונית מס מספר ${d.number} מתאריך ${fmtDate(d.issue_date)} על סך ${fmtMoney(d.total - d.paid_amount)} טרם שולמה (מועד התשלום היה ${fmtDate(d.due_date || d.issue_date)}).\nנשמח אם תוכלו לסדר את התשלום בימים הקרובים. אם כבר שילמתם, אנא התעלמו מהודעה זו ותודה רבה.\nבברכה,\n${ctx.biz.name}`;

  function open(d) {
    const c = cmap.get(d.contact_id);
    const ta = h('textarea', { rows: 9, value: msg(d) });
    modal('תזכורת ל' + d.customer_name, h('div', null, h('div', { class: 'note info', text: 'האתר אינו שולח הודעות בעצמו. אפשר לערוך את הנוסח, ואז להעתיק או לפתוח במייל / בוואטסאפ ולשלוח משם.' }), field('נוסח התזכורת', ta)), [
      { text: 'העתקה ללוח', class: 'primary', onclick: async () => { try { await navigator.clipboard.writeText(ta.value); toast('הועתק'); } catch { ta.select(); toast('סמנו והעתיקו ידנית', 'info'); } } },
      c?.email ? { text: 'פתח במייל', onclick: () => { location.href = `mailto:${encodeURIComponent(c.email)}?subject=${encodeURIComponent('תזכורת תשלום — חשבונית ' + d.number)}&body=${encodeURIComponent(ta.value)}`; } } : null,
      c?.phone ? { text: 'פתח בוואטסאפ', onclick: () => { window.open(`https://wa.me/${waPhone(c.phone)}?text=${encodeURIComponent(ta.value)}`, '_blank', 'noopener'); } } : null,
      { text: 'סגירה', onclick: (cl) => cl() }].filter(Boolean));
  }
  main.append(topbar('תזכורות גבייה'), h('div', { class: 'card' }, h('div', { class: 'note', text: `${late.length} חשבוניות פתוחות שעבר מועד תשלומן. סך החוב באיחור: ${fmtMoney(late.reduce((a, d) => a + Number(d.total) - Number(d.paid_amount), 0))}` }),
    table([{ label: 'חשבונית', num: true, key: 'number' }, { label: 'לקוח', key: 'customer_name' }, { label: 'לתשלום עד', render: (d) => fmtDate(d.due_date || d.issue_date) },
      { label: 'ימי איחור', num: true, render: (d) => days(d) }, { label: 'יתרה', num: true, render: (d) => fmtMoney(d.total - d.paid_amount) },
      { label: '', render: (d) => h('button', { class: 'btn small primary', text: 'נסח תזכורת', onclick: () => open(d) }) }], late, { empty: 'אין חשבוניות באיחור.' })));
}
