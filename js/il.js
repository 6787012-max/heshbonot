// לוגיקה ישראלית טהורה (ניתנת לבדיקה ב-node): ספרת ביקורת, סכום במילים, עיצוב
export function validId(s) {
  s = String(s || '').trim();
  if (!/^\d{5,9}$/.test(s)) return false;
  s = s.padStart(9, '0');
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let v = Number(s[i]) * (i % 2 === 0 ? 1 : 2);
    if (v > 9) v -= 9;
    sum += v;
  }
  return sum % 10 === 0;
}

export const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function fmtMoney(n) {
  const v = Number(n || 0);
  return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 2 }).format(v);
}
export function fmtNum(n, d = 2) {
  return new Intl.NumberFormat('he-IL', { minimumFractionDigits: d, maximumFractionDigits: d }).format(Number(n || 0));
}
export function fmtDate(s) {
  if (!s) return '';
  const [y, m, d] = String(s).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
export const today = () => new Date().toISOString().slice(0, 10);
export function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const ONES_M = ['', 'אחד', 'שניים', 'שלושה', 'ארבעה', 'חמישה', 'שישה', 'שבעה', 'שמונה', 'תשעה'];
const ONES_F = ['', 'אחת', 'שתיים', 'שלוש', 'ארבע', 'חמש', 'שש', 'שבע', 'שמונה', 'תשע'];
const TEENS_M = ['עשרה', 'אחד עשר', 'שנים עשר', 'שלושה עשר', 'ארבעה עשר', 'חמישה עשר', 'שישה עשר', 'שבעה עשר', 'שמונה עשר', 'תשעה עשר'];
const TEENS_F = ['עשר', 'אחת עשרה', 'שתים עשרה', 'שלוש עשרה', 'ארבע עשרה', 'חמש עשרה', 'שש עשרה', 'שבע עשרה', 'שמונה עשרה', 'תשע עשרה'];
const TENS = ['', '', 'עשרים', 'שלושים', 'ארבעים', 'חמישים', 'שישים', 'שבעים', 'שמונים', 'תשעים'];
const HUND = ['', 'מאה', 'מאתיים', 'שלוש מאות', 'ארבע מאות', 'חמש מאות', 'שש מאות', 'שבע מאות', 'שמונה מאות', 'תשע מאות'];

function below1000(n, fem) {
  const parts = [];
  const h = Math.floor(n / 100), rest = n % 100;
  if (h) parts.push(HUND[h]);
  if (rest) {
    if (rest < 10) parts.push((fem ? ONES_F : ONES_M)[rest]);
    else if (rest < 20) parts.push((fem ? TEENS_F : TEENS_M)[rest - 10]);
    else {
      parts.push(TENS[Math.floor(rest / 10)]);
      if (rest % 10) parts.push((fem ? ONES_F : ONES_M)[rest % 10]);
    }
  }
  if (parts.length > 1) parts.push('ו' + parts.pop());
  return parts.join(' ');
}

export function numberWords(n, fem = false) {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'אפס';
  const out = [];
  const millions = Math.floor(n / 1e6), thousands = Math.floor((n % 1e6) / 1000), rest = n % 1000;
  if (millions) out.push(millions === 1 ? 'מיליון' : millions === 2 ? 'שני מיליון' : numberWords(millions, false) + ' מיליון');
  if (thousands) {
    if (thousands === 1) out.push('אלף');
    else if (thousands === 2) out.push('אלפיים');
    else if (thousands <= 10) out.push(below1000(thousands, false) + ' אלפים');
    else out.push(below1000(thousands, false) + ' אלף');
  }
  if (rest) out.push(below1000(rest, fem));
  // הוספת ו' לפני החלק האחרון
  if (out.length > 1) {
    const last = out.pop();
    out.push(last.startsWith('ו') ? last : 'ו' + last);
  }
  return out.join(' ');
}

export function amountInWords(total) {
  const v = r2(total);
  const sh = Math.floor(v), ag = Math.round((v - sh) * 100);
  let s = '';
  if (sh === 0 && ag === 0) return 'אפס שקלים';
  if (sh === 1) s = 'שקל אחד';
  else if (sh === 2) s = 'שני שקלים';
  else if (sh > 0) s = numberWords(sh, false) + ' שקלים';
  if (ag) {
    const a = ag === 1 ? 'אגורה אחת' : numberWords(ag, true) + ' אגורות';
    s = s ? s + ' ו' + a : a;
  }
  return s;
}

export const DOC_TYPES = {
  tax_invoice: { name: 'חשבונית מס', code: 305, income: true, items: true },
  invoice_receipt: { name: 'חשבונית מס / קבלה', code: 320, income: true, items: true, pays: true },
  receipt: { name: 'קבלה', code: 400, pays: true },
  credit_note: { name: 'חשבונית זיכוי', code: 330, income: true, items: true },
  quote: { name: 'הצעת מחיר', code: 0, items: true },
  deal_invoice: { name: 'חשבון עסקה', code: 300, items: true },
  delivery_note: { name: 'תעודת משלוח', code: 200, items: true },
};
export const PAY_METHODS = { cash: 'מזומן', check: "צ'ק", transfer: 'העברה בנקאית', credit: 'כרטיס אשראי', bit: 'ביט' };
export const VAT_TYPES = { authorized: 'עוסק מורשה', exempt: 'עוסק פטור', company: 'חברה בע"מ' };

// חישוב סכומי מסמך (תואם לשרת)
export function calcTotals(items, vatRate, isReceipt, payments) {
  if (isReceipt) {
    const t = r2((payments || []).reduce((a, p) => a + Number(p.amount || 0), 0));
    return { subtotal: t, vat: 0, total: t, lines: [] };
  }
  const lines = (items || []).filter((i) => String(i.description || '').trim() !== '').map((i) =>
    r2(Number(i.qty ?? 1) * Number(i.unit_price || 0) * (1 - Number(i.discount_pct || 0) / 100)));
  const subtotal = r2(lines.reduce((a, b) => a + b, 0));
  const vat = r2(subtotal * Number(vatRate || 0) / 100);
  return { subtotal, vat, total: r2(subtotal + vat), lines };
}
