// התאמה אוטומטית: תנועת בנק <-> מסמך / הוצאה. טהור.
const dayDiff = (a, b) => Math.abs((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);

function tokens(s) {
  return String(s || '').replace(/["'׳״.,\-_/()]/g, ' ').split(/\s+/).filter((t) => t.length >= 2 &&
    !/^(בע|מ|בעמ|חברת|העברה|מאת|זיכוי|חיוב|הוראת|קבע)$/.test(t));
}
function nameScore(name, desc) {
  const nt = tokens(name);
  if (!nt.length) return 0;
  const d = String(desc || '');
  const hit = nt.filter((t) => d.includes(t)).length;
  return hit / nt.length;
}

// docs: מסמכים פתוחים/קבלות [{id, doc_type, status, customer_name, total, paid_amount, issue_date, payment_status}]
// exps: הוצאות [{id, supplier_name, total, expense_date}]
// txns: תנועות שטרם הותאמו (match_status none/rejected)
export function suggestMatches(txns, docs, exps, takenIds = new Set()) {
  const cands = [];
  for (const t of txns) {
    if (t.credit > 0) {
      for (const d of docs) {
        if (takenIds.has(d.id) || d.status !== 'issued') continue;
        let amt;
        if (d.doc_type === 'tax_invoice') {
          if (d.payment_status === 'paid') continue;
          amt = Number(d.total) - Number(d.paid_amount);
        } else if (d.doc_type === 'receipt' || d.doc_type === 'invoice_receipt') amt = Number(d.total);
        else continue;
        if (Math.abs(amt - t.credit) > 0.009) continue;
        const dd = (Date.parse(t.txn_date + 'T00:00:00Z') - Date.parse(d.issue_date + 'T00:00:00Z')) / 86400000;
        let score = 60;
        if (dd >= -3 && dd <= 90) score += Math.max(0, 20 - Math.floor(Math.max(dd, 0) / 5));
        else score -= 15;
        score += Math.round(20 * nameScore(d.customer_name, t.description));
        cands.push({ txn: t, type: 'document', id: d.id, score: Math.min(100, score), label: d });
      }
    } else if (t.debit > 0) {
      for (const e of exps) {
        if (takenIds.has(e.id)) continue;
        if (Math.abs(Number(e.total) - t.debit) > 0.009) continue;
        const dd = dayDiff(t.txn_date, e.expense_date);
        let score = 60 + (dd <= 10 ? 20 - Math.floor(dd) : -15);
        score += Math.round(20 * nameScore(e.supplier_name, t.description));
        cands.push({ txn: t, type: 'expense', id: e.id, score: Math.min(100, Math.max(0, score)), label: e });
      }
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const usedT = new Set(), usedD = new Set(), out = [];
  for (const c of cands) {
    if (c.score < 50) continue;
    if (usedT.has(c.txn.hash || c.txn.id) || usedD.has(c.id)) continue;
    usedT.add(c.txn.hash || c.txn.id); usedD.add(c.id);
    out.push(c);
  }
  return out;
}
