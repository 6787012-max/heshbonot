import { h, clear, topbar, toast, field, select, table, modal } from '../ui.js';
import { q, sb, bid, canWrite, unwrap, friendly } from '../api.js';
import { fmtMoney, fmtDate, DOC_TYPES } from '../il.js';
import { decodeBytes, parseCSV, findHeaderRow, guessMapping, normalizeRows } from '../bankparse.js';
import { suggestMatches } from '../match.js';

export async function render(main) {
  const [txns, docs, exps] = await Promise.all([q.txns(), q.docs({ limit: 3000 }), q.expenses()]);
  const again = () => { clear(main); return render(main); };
  const taken = new Set(txns.filter((t) => t.match_status === 'confirmed').map((t) => t.match_id));
  const pending = txns.filter((t) => t.match_status === 'none').map((t) => ({ ...t, hash: t.id }));
  const sugg = suggestMatches(pending, docs, exps, taken);
  const docMap = new Map(docs.map((d) => [d.id, d])), expMap = new Map(exps.map((e) => [e.id, e]));
  const label = (type, id) => {
    if (type === 'document') { const d = docMap.get(id); return d ? `${DOC_TYPES[d.doc_type].name} ${d.number} · ${d.customer_name} · ${fmtMoney(d.total)}` : '—'; }
    const e = expMap.get(id); return e ? `הוצאה: ${e.supplier_name} · ${fmtMoney(e.total)} · ${fmtDate(e.expense_date)}` : '—';
  };

  async function confirm(txn, type, id, score) {
    try {
      if (type === 'document') {
        const d = docMap.get(id);
        if (d && d.doc_type === 'tax_invoice' && d.payment_status !== 'paid') await q.rpc('mark_paid', { doc: id, amt: Math.min(Number(txn.credit), Number(d.total) - Number(d.paid_amount)) });
      }
      unwrap(await sb.from('bank_txns').update({ match_type: type, match_id: id, match_confidence: score ?? null, match_status: 'confirmed' }).eq('id', txn.id));
      toast('ההתאמה אושרה'); again();
    } catch (e) { toast(friendly(e), 'err'); }
  }
  async function reject(txn) {
    try { unwrap(await sb.from('bank_txns').update({ match_status: 'rejected', match_type: null, match_id: null }).eq('id', txn.id)); again(); } catch (e) { toast(friendly(e), 'err'); }
  }
  function manual(txn) {
    let opts;
    if (txn.credit > 0) opts = docs.filter((d) => d.status === 'issued' && !taken.has(d.id) && (d.doc_type === 'receipt' || d.doc_type === 'invoice_receipt' || (d.doc_type === 'tax_invoice' && d.payment_status !== 'paid'))).map((d) => ['document|' + d.id, label('document', d.id)]);
    else opts = exps.filter((e) => !taken.has(e.id)).map((e) => ['expense|' + e.id, label('expense', e.id)]);
    const sel = select([['', '— בחרו —'], ...opts], '');
    modal('התאמה ידנית', h('div', null, h('p', { text: `${fmtDate(txn.txn_date)} · ${txn.description} · ${fmtMoney(txn.credit || txn.debit)}` }), field('התאם ל', sel)),
      [{ text: 'אישור', class: 'primary', onclick: (cl) => { if (!sel.value) return; const [t, id] = sel.value.split('|'); cl(); confirm(txn, t, id, null); } }, { text: 'ביטול', onclick: (cl) => cl() }]);
  }
  async function unmatch(txn) {
    try { unwrap(await sb.from('bank_txns').update({ match_status: 'none', match_type: null, match_id: null, match_confidence: null }).eq('id', txn.id)); toast('ההתאמה בוטלה (סטטוס התשלום בחשבונית לא שונה אוטומטית)'); again(); } catch (e) { toast(friendly(e), 'err'); }
  }

  // ── ייבוא ──
  const importCard = h('div', { class: 'card' }, h('h2', { text: 'ייבוא תנועות מהבנק' }),
    h('div', { class: 'hint', text: 'קובץ CSV או Excel מהאתר של הבנק (הפועלים, לאומי, דיסקונט ועוד). קידוד עברי (windows-1255 / UTF-8) מזוהה אוטומטית. תנועות שכבר יובאו לא יוכפלו.' }));
  const fileIn = h('input', { type: 'file', accept: '.csv,.txt,.xlsx,.xls', onchange: async (e) => { if (e.target.files[0]) await loadFile(e.target.files[0]); } });
  const stage = h('div');
  importCard.append(canWrite() ? field('קובץ תנועות', fileIn) : h('div', { class: 'note', text: 'ייבוא זמין לבעלים בלבד.' }), stage);

  async function loadFile(f) {
    try {
      let rows;
      if (/\.xlsx?$/i.test(f.name)) {
        const wb = window.XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true });
        rows = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '', blankrows: false });
      } else rows = parseCSV(decodeBytes(new Uint8Array(await f.arrayBuffer())).text);
      if (rows.length < 2) throw new Error('הקובץ ריק או בפורמט שלא זוהה.');
      const hi = findHeaderRow(rows), heads = rows[hi].map((x) => String(x ?? '').trim());
      const map = guessMapping(heads);
      const body = rows.slice(hi + 1);
      const colOpts = [['-1', '— ללא —'], ...heads.map((x, i) => [String(i), `${i + 1}. ${x || '(ריק)'}`])];
      const sels = {};
      const mk = (k, l) => { sels[k] = select(colOpts, String(map[k]), { onchange: preview }); return field(l, sels[k]); };
      const prev = h('div');
      const cur = () => Object.fromEntries(Object.keys(sels).map((k) => [k, Number(sels[k].value)]));
      let parsed = null;
      async function preview() {
        const m = cur();
        parsed = await normalizeRows(body, m);
        clear(prev).append(h('div', { class: 'note info', text: `זוהו ${parsed.txns.length} תנועות. ${parsed.skipped.length} שורות דולגו (ללא תאריך/סכום).` }),
          table([{ label: 'תאריך', render: (t) => fmtDate(t.txn_date) }, { label: 'תיאור', key: 'description' }, { label: 'זכות', num: true, render: (t) => (t.credit ? fmtMoney(t.credit) : '') }, { label: 'חובה', num: true, render: (t) => (t.debit ? fmtMoney(t.debit) : '') }], parsed.txns.slice(0, 8)),
          parsed.txns.length ? h('button', { class: 'btn primary', text: `ייבוא ${parsed.txns.length} תנועות`, onclick: doImport }) : null);
      }
      async function doImport() {
        let added = 0;
        const batch = 'imp-' + new Date().toISOString().slice(0, 16);
        for (let i = 0; i < parsed.txns.length; i += 200) {
          const chunk = parsed.txns.slice(i, i + 200).map((t) => ({ ...t, business_id: bid(), batch }));
          const res = unwrap(await sb.from('bank_txns').upsert(chunk, { onConflict: 'business_id,hash', ignoreDuplicates: true }).select('id'));
          added += res.length;
        }
        toast(`יובאו ${added} תנועות חדשות. ${parsed.txns.length - added} כבר היו קיימות.`);
        again();
      }
      clear(stage).append(h('div', { class: 'note', text: `קידוד/שורת כותרת זוהו (שורה ${hi + 1}). אפשר לתקן את מיפוי העמודות:` }),
        h('div', { class: 'cols3' }, mk('date', 'תאריך'), mk('desc', 'תיאור'), mk('credit', 'זכות'), mk('debit', 'חובה'), mk('amount', 'סכום (אם עמודה אחת)'), mk('balance', 'יתרה')), prev);
      await preview();
    } catch (e) { clear(stage).append(h('div', { class: 'note err', text: friendly(e) })); }
  }

  // ── הצעות התאמה ──
  const suggCard = h('div', { class: 'card' }, h('h2', { text: `הצעות התאמה (${sugg.length})` }),
    table([
      { label: 'תנועת בנק', render: (s) => h('div', null, h('div', { text: s.txn.description }), h('small', { class: 'hint', text: fmtDate(s.txn.txn_date) })) },
      { label: 'סכום', num: true, render: (s) => fmtMoney(s.txn.credit || -s.txn.debit) },
      { label: 'מתאים ל', render: (s) => label(s.type, s.id) },
      { label: 'ביטחון', render: (s) => h('span', { class: 'tag ' + (s.score >= 85 ? '' : 'warn'), text: s.score + '%' }) },
      { label: '', render: (s) => canWrite() ? h('div', { class: 'row' }, h('button', { class: 'btn small primary', text: 'אישור', onclick: () => confirm(txns.find((t) => t.id === s.txn.id), s.type, s.id, s.score) }),
        h('button', { class: 'btn small', text: 'דחייה', onclick: () => reject(txns.find((t) => t.id === s.txn.id)) })) : null },
    ], sugg, { empty: 'אין הצעות. ייבאו תנועות או הפיקו חשבוניות/קבלות להתאמה.' }));

  let f = 'none';
  const listBody = h('div');
  const STAT = { none: 'לא הותאם', rejected: 'נדחה', confirmed: 'הותאם', suggested: 'הצעה' };
  const drawList = () => {
    clear(listBody).append(table([
      { label: 'תאריך', render: (t) => fmtDate(t.txn_date) }, { label: 'תיאור', key: 'description' },
      { label: 'זכות', num: true, render: (t) => (Number(t.credit) ? fmtMoney(t.credit) : '') }, { label: 'חובה', num: true, render: (t) => (Number(t.debit) ? fmtMoney(t.debit) : '') },
      { label: 'סטטוס', render: (t) => h('span', { class: 'tag ' + (t.match_status === 'confirmed' ? '' : 'mute'), text: STAT[t.match_status] }) },
      { label: 'התאמה', render: (t) => t.match_status === 'confirmed' ? label(t.match_type, t.match_id) : '' },
      { label: '', render: (t) => canWrite() ? (t.match_status === 'confirmed' ? h('button', { class: 'btn small', text: 'בטל', onclick: () => unmatch(t) }) : h('button', { class: 'btn small', text: 'התאם ידנית', onclick: () => manual(t) })) : null },
    ], txns.filter((t) => f === 'all' || (f === 'none' ? t.match_status !== 'confirmed' : t.match_status === 'confirmed')).slice(0, 300), { empty: 'אין תנועות.' }));
  };
  const listCard = h('div', { class: 'card' }, h('h2', { text: 'כל התנועות' }),
    h('div', { class: 'chips' }, [['none', 'לא הותאמו'], ['confirmed', 'הותאמו'], ['all', 'הכול']].map(([k, n]) => h('span', { class: 'chip' + (f === k ? ' on' : ''), text: n, onclick: (e) => { f = k; e.target.parentNode.querySelectorAll('.chip').forEach((c) => c.classList.remove('on')); e.target.classList.add('on'); drawList(); } }))), listBody);
  main.append(topbar('תנועות בנק'), importCard, suggCard, listCard);
  drawList();
}
