// גישה לנתונים. הכול מול schema heshbonot דרך PostgREST (RLS + aal2 נאכפים בשרת).
import { SUPABASE_URL, SUPABASE_ANON } from './config.js';

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { storage: window.sessionStorage, storageKey: 'heshbonot-auth', persistSession: true, autoRefreshToken: true },
  db: { schema: 'heshbonot' },
});
export const ctx = { user: null, biz: null, role: null };

const unwrap = ({ data, error }) => { if (error) throw new Error(friendly(error)); return data; };
export function friendly(e) {
  const m = e.message || String(e);
  if (/row-level security|permission denied/i.test(m)) return 'אין הרשאה לפעולה זו.';
  if (/duplicate key/i.test(m)) return 'הרשומה כבר קיימת.';
  return m;
}

export const bid = () => ctx.biz.id;
export const canWrite = () => ctx.role === 'owner';
export const canExport = () => ctx.role === 'owner' || ctx.role === 'accountant';

export async function loadContext() {
  const m = unwrap(await sb.from('members').select('business_id, role').limit(1));
  if (!m.length) return false;
  ctx.role = m[0].role;
  ctx.biz = unwrap(await sb.from('businesses').select('*').eq('id', m[0].business_id).single());
  return true;
}
export async function reloadBiz() { ctx.biz = unwrap(await sb.from('businesses').select('*').eq('id', bid()).single()); }

export const q = {
  docs: async (filter = {}) => {
    let r = sb.from('documents').select('*').eq('business_id', bid()).order('issue_date', { ascending: false }).order('number', { ascending: false });
    if (filter.type) r = r.eq('doc_type', filter.type);
    if (filter.contact) r = r.eq('contact_id', filter.contact);
    if (filter.from) r = r.gte('issue_date', filter.from);
    if (filter.to) r = r.lte('issue_date', filter.to);
    return unwrap(await r.limit(filter.limit || 2000));
  },
  doc: async (id) => {
    const d = unwrap(await sb.from('documents').select('*').eq('id', id).single());
    const items = unwrap(await sb.from('document_items').select('*').eq('document_id', id).order('line_no'));
    const pays = unwrap(await sb.from('document_payments').select('*').eq('document_id', id));
    return { d, items, pays };
  },
  contacts: async () => unwrap(await sb.from('contacts').select('*').eq('business_id', bid()).order('name')),
  expenses: async (f = {}) => {
    let r = sb.from('expenses').select('*').eq('business_id', bid()).order('expense_date', { ascending: false });
    if (f.from) r = r.gte('expense_date', f.from);
    if (f.to) r = r.lte('expense_date', f.to);
    return unwrap(await r.limit(3000));
  },
  txns: async (f = {}) => {
    let r = sb.from('bank_txns').select('*').eq('business_id', bid()).order('txn_date', { ascending: false });
    if (f.from) r = r.gte('txn_date', f.from);
    if (f.to) r = r.lte('txn_date', f.to);
    return unwrap(await r.limit(5000));
  },
  items: async (docIds) => {
    if (!docIds.length) return [];
    const out = [];
    for (let i = 0; i < docIds.length; i += 100) out.push(...unwrap(await sb.from('document_items').select('*').in('document_id', docIds.slice(i, i + 100))));
    return out;
  },
  pays: async (docIds) => {
    if (!docIds.length) return [];
    const out = [];
    for (let i = 0; i < docIds.length; i += 100) out.push(...unwrap(await sb.from('document_payments').select('*').in('document_id', docIds.slice(i, i + 100))));
    return out;
  },
  seqs: async () => unwrap(await sb.from('doc_sequences').select('*').eq('business_id', bid())),
  rpc: async (fn, args) => unwrap(await sb.rpc(fn, args)),
};
export { unwrap };
