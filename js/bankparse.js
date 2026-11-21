// פענוח קבצי בנק (CSV/XLSX): קידוד, מיפוי עמודות, נרמול, hash. טהור, ניתן לבדיקה ב-node.
export function decodeBytes(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let text, enc = 'utf-8';
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(u8);
  } catch (e) {
    text = new TextDecoder('windows-1255').decode(u8);
    enc = 'windows-1255';
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return { text, enc };
}

export function parseCSV(text) {
  const first = text.split(/\r?\n/).slice(0, 10).join('\n');
  const cnt = (c) => (first.match(new RegExp(c === '\t' ? '\\t' : '\\' + c, 'g')) || []).length;
  const delim = [',', ';', '\t'].map((d) => [d, cnt(d)]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => String(c).trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => String(c).trim() !== '')) rows.push(row);
  return rows;
}

const HEAD_WORDS = /תאריך|תיאור|פרטים|פעולה|זכות|חובה|סכום|יתרה|אסמכתא|date|description|credit|debit|amount|balance/i;

export function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const hits = rows[i].filter((c) => HEAD_WORDS.test(String(c))).length;
    if (hits >= 3) return i;
  }
  return 0;
}

export function guessMapping(headers) {
  const h = headers.map((x) => String(x || '').trim());
  const find = (re, not) => {
    const i = h.findIndex((x) => re.test(x) && !(not && not.test(x)));
    return i < 0 ? -1 : i;
  };
  return {
    date: find(/^תאריך$|תאריך (פעולה|עסקה|רישום)|^date/i, /ערך/) >= 0 ? find(/^תאריך$|תאריך (פעולה|עסקה|רישום)|^date/i, /ערך/) : find(/תאריך|date/i),
    desc: find(/תיאור|פרטים|פעולה|description/i),
    credit: find(/זכות|credit/i),
    debit: find(/חובה|debit/i),
    amount: find(/^סכום|amount/i),
    balance: find(/יתרה|balance/i),
  };
}

export function parseAmount(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  let s = String(v).trim().replace(/[₪\s]/g, '').replace(/‏|‎/g, '');
  if (!s) return 0;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1); }
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
  // 1,234.56 או 1.234,56
  if (/,\d{1,2}$/.test(s) && /\./.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = parseFloat(s);
  if (isNaN(n)) return 0;
  return neg ? -n : n;
}

export function parseDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    const mm = Number(m[2]), dd = Number(m[1]);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }
  return null;
}

async function sha256(s) {
  const b = new TextEncoder().encode(s);
  const d = await crypto.subtle.digest('SHA-256', b);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// rows: מערך שורות (אחרי שורת הכותרת); map: אינדקסי עמודות
export async function normalizeRows(rows, map) {
  const out = [], seen = new Map(), skipped = [];
  for (const r of rows) {
    const date = parseDate(r[map.date]);
    if (!date) { skipped.push(r); continue; }
    let credit = 0, debit = 0;
    if (map.amount >= 0 && map.credit < 0 && map.debit < 0) {
      const a = parseAmount(r[map.amount]);
      if (a >= 0) credit = a; else debit = -a;
    } else {
      credit = Math.abs(map.credit >= 0 ? parseAmount(r[map.credit]) : 0);
      debit = Math.abs(map.debit >= 0 ? parseAmount(r[map.debit]) : 0);
    }
    if (credit === 0 && debit === 0) { skipped.push(r); continue; }
    const desc = String(map.desc >= 0 ? r[map.desc] ?? '' : '').replace(/\s+/g, ' ').trim();
    const balance = map.balance >= 0 && r[map.balance] !== '' ? parseAmount(r[map.balance]) : null;
    const base = `${date}|${desc}|${credit.toFixed(2)}|${debit.toFixed(2)}|${balance === null ? '' : balance.toFixed(2)}`;
    const occ = (seen.get(base) || 0) + 1;
    seen.set(base, occ);
    out.push({ txn_date: date, description: desc, credit, debit, balance, hash: await sha256(base + '|' + occ) });
  }
  return { txns: out, skipped };
}
