// מבנה אחיד (הוראות 36 של רשות המסים): INI.TXT + BKMVDATA.TXT. נבנה לפי המפרט כמיטב היכולת;
// לא אומת מול סימולטור רשות המסים. קידוד: ISO-8859-8 (עברית 0xE0-0xFA), שורות CRLF.
const CONST = '&OF1.31&';

// ── עזרי שדות ─────────────────────────────────────────────
const T = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) : s.padEnd(n, ' '); };   // טקסט
const N = (v, n) => String(Math.trunc(Math.abs(Number(v) || 0))).padStart(n, '0').slice(-n);              // מספר שלם
const S = (v, n, dec = 2) => {                                                                              // מספר עם סימן
  const x = Math.round(Math.abs(Number(v) || 0) * Math.pow(10, dec));
  return ((Number(v) || 0) < 0 ? '-' : '+') + String(x).padStart(n - 1, '0').slice(-(n - 1));
};
const D = (iso) => (iso ? String(iso).slice(0, 10).replace(/-/g, '') : '00000000');
const digits = (s) => String(s || '').replace(/\D/g, '');

export const DOC_CODE = { deal_invoice: 300, tax_invoice: 305, invoice_receipt: 320, credit_note: 330, receipt: 400, delivery_note: 200 };
const PAY_CODE = { cash: 1, check: 2, credit: 3, transfer: 4, bit: 5 };

export const LEN = { A000: 466, A100: 95, Z900: 110, C100: 444, D110: 339, D120: 222 };

function rec(code, parts, total) {
  const s = parts.join('');
  if (s.length > total) throw new Error(code + ' ארוך מדי: ' + s.length);
  return s.padEnd(total, ' ');
}

export function buildUniform({ business, docs, items, payments, from, to, software = { name: 'heshbonot', version: '1.0' } }) {
  const vat = N(digits(business.vat_number), 9);
  const prim = N(Math.floor(Math.random() * 1e14) + 1, 15);   // מזהה ראשי אקראי, זהה בכל הרשומות
  const list = docs.filter((d) => DOC_CODE[d.doc_type] && d.issue_date >= from && d.issue_date <= to)
    .sort((a, b) => a.issue_date.localeCompare(b.issue_date) || a.number - b.number);
  const lines = [];
  let n = 0;
  const push = (s) => { lines.push(s); };
  n++; push(rec('A100', ['A100', N(n, 9), vat, prim, CONST], LEN.A100));
  const counts = { C100: 0, D110: 0, D120: 0 };
  for (const d of list) {
    const code = DOC_CODE[d.doc_type];
    const sign = d.doc_type === 'credit_note' ? -1 : 1;
    const addr = String(d.customer_address || '');
    n++; counts.C100++;
    push(rec('C100', [
      'C100', N(n, 9), vat, N(code, 3), T(d.number, 20), D(d.issue_date), '0000',
      T(d.customer_name, 50), T(addr, 50), T('', 10), T('', 30), T('', 8), T('ישראל', 30), 'IL', T('', 15),
      N(digits(d.customer_tax_id), 9), D(d.issue_date), S(0, 15), T('ILS', 3),
      S(sign * Number(d.subtotal), 15), S(0, 15), S(sign * Number(d.subtotal), 15), S(sign * Number(d.vat_amount), 15),
      S(sign * Number(d.total), 15), S(0, 12), T('', 15), T('', 10),
      d.status === 'cancelled' ? '1' : '0', D(d.issue_date), T('', 7), T('', 9), N(0, 7), T('', 13),
    ], LEN.C100));
    const its = items.filter((i) => i.document_id === d.id).sort((a, b) => a.line_no - b.line_no);
    for (const it of its) {
      n++; counts.D110++;
      push(rec('D110', [
        'D110', N(n, 9), vat, N(code, 3), T(d.number, 20), N(it.line_no, 4), N(0, 3), T('', 20), '1',
        T('', 20), T(it.description, 30), T('', 50), T('', 30), T('יח', 20),
        S(it.qty, 17, 4), S(it.unit_price, 15), S(Number(it.line_total) * Number(it.discount_pct || 0) / 100, 15), S(sign * Number(it.line_total), 15),
        N(Number(d.vat_rate) * 100, 4), T('', 7), D(d.issue_date), N(0, 7),
      ], LEN.D110));
    }
    const pays = payments.filter((p) => p.document_id === d.id);
    let ln = 0;
    for (const p of pays) {
      n++; counts.D120++; ln++;
      push(rec('D120', [
        'D120', N(n, 9), vat, N(code, 3), T(d.number, 20), N(ln, 4), String(PAY_CODE[p.method] || 5),
        T('', 10), T('', 10), T('', 15), T(p.check_no, 10), D(p.check_date || d.issue_date),
        S(p.amount, 15), '0', T('', 20), '0',
      ], LEN.D120));
    }
  }
  n++; push(rec('Z900', ['Z900', N(n, 9), vat, prim, CONST, N(n, 15)], LEN.Z900));
  const bkmv = lines.join('\r\n') + '\r\n';

  const bname = business.name || '';
  const ini = [
    rec('A000', ['A000', T('', 5), N(n, 15), vat, prim, CONST, N(0, 8), T(software.name, 20), T(software.version, 20),
      N(0, 9), T('', 20), '2', T('', 50), '2', '0', N(0, 9), T('', 10), T(bname, 50), T(business.address || '', 50),
      T('', 10), T('', 30), T('', 8), N(from.slice(0, 4), 4), D(from), D(to), D(new Date().toISOString()), '0000', '0', '1',
      T('zip', 20), T('ILS', 3), '0'], LEN.A000),
    ...Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => k + N(c, 15)),
    'A100' + N(1, 15), 'Z900' + N(1, 15),
  ].join('\r\n') + '\r\n';
  return { ini, bkmv, counts, records: n };
}

// קידוד ISO-8859-8: אותיות עבריות U+05D0..U+05EA -> 0xE0..0xFA
export function encode8859_8(str) {
  const out = new Uint8Array(str.length);
  let o = 0;
  for (const ch of str) {
    const c = ch.codePointAt(0);
    if (c < 0x80) out[o++] = c;
    else if (c >= 0x5d0 && c <= 0x5ea) out[o++] = c - 0x5d0 + 0xe0;
    else if (c === 0x200e) out[o++] = 0xfd;
    else if (c === 0x200f) out[o++] = 0xfe;
    else out[o++] = 0x3f;
  }
  return out.subarray(0, o);
}
