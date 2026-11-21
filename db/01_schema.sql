-- ═══════════════════════════════════════════════════════════════════
-- heshbonot — הנהלת חשבונות לעסק קטן
-- schema נפרד בפרויקט Supabase המשותף. לא נוגעים ב-public/minyan/אחרים.
-- מודל הרשאות: כל טבלה מוגנת RLS. גישה רק עם aal2 (TOTP) + חברות ב-members.
-- anon: אפס. authenticated: select בלבד (כתיבה לפי תפקיד owner, ומסמכים רק דרך RPC).
-- ═══════════════════════════════════════════════════════════════════
create schema if not exists heshbonot;

-- ── עסקים וחברים ───────────────────────────────────────────────────
create table if not exists heshbonot.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  vat_type text not null default 'authorized' check (vat_type in ('authorized','exempt','company')),
  vat_number text,
  address text,
  phone text,
  email text,
  logo text,                                  -- data URL קטן
  vat_rate numeric(5,2) not null default 18,
  advance_pct numeric(5,2) not null default 0,
  allocation_threshold numeric(12,2) not null default 5000,
  report_freq text not null default 'bimonthly' check (report_freq in ('monthly','bimonthly')),
  created_at timestamptz not null default now()
);

create table if not exists heshbonot.members (
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null references heshbonot.businesses(id) on delete cascade,
  role text not null check (role in ('owner','accountant','viewer')),
  created_at timestamptz not null default now(),
  primary key (user_id, business_id)
);

-- הרשאה: aal2 + חברות בעסק + תפקיד מינימלי
create or replace function heshbonot.has_role(bid uuid, min_role text)
returns boolean language sql stable security definer
set search_path = heshbonot, public as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and exists (
       select 1 from heshbonot.members m
       where m.user_id = auth.uid() and m.business_id = bid
         and case min_role
               when 'viewer' then true
               when 'accountant' then m.role in ('owner','accountant')
               else m.role = 'owner' end);
$$;

-- ── רצפי מספור ─────────────────────────────────────────────────────
create table if not exists heshbonot.doc_sequences (
  business_id uuid not null references heshbonot.businesses(id) on delete cascade,
  doc_type text not null,
  next_number integer not null default 1 check (next_number >= 1),
  primary key (business_id, doc_type)
);

create or replace function heshbonot.init_sequences() returns trigger
language plpgsql security definer set search_path = heshbonot, public as $$
begin
  insert into heshbonot.doc_sequences(business_id, doc_type)
  select new.id, t from unnest(array['tax_invoice','receipt','invoice_receipt','quote',
         'delivery_note','credit_note','deal_invoice']) t
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists trg_init_seq on heshbonot.businesses;
create trigger trg_init_seq after insert on heshbonot.businesses
  for each row execute function heshbonot.init_sequences();

-- ── לקוחות וספקים ──────────────────────────────────────────────────
create table if not exists heshbonot.contacts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references heshbonot.businesses(id) on delete cascade,
  kind text not null default 'customer' check (kind in ('customer','supplier','both')),
  name text not null,
  tax_id text,
  phone text,
  email text,
  address text,
  payment_terms integer not null default 30 check (payment_terms between 0 and 365),
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists contacts_biz on heshbonot.contacts(business_id);

-- בדיקת ספרת ביקורת (ת.ז / ח.פ / ע.מ — אותו אלגוריתם, 9 ספרות)
create or replace function heshbonot.valid_il_id(s text) returns boolean
language plpgsql immutable as $$
declare d text; i int; sum int := 0; v int;
begin
  if s is null or s !~ '^[0-9]{5,9}$' then return false; end if;
  d := lpad(s, 9, '0');
  for i in 1..9 loop
    v := substr(d, i, 1)::int * (case when i % 2 = 1 then 1 else 2 end);
    if v > 9 then v := v - 9; end if;
    sum := sum + v;
  end loop;
  return sum % 10 = 0;
end $$;

-- ── מסמכים ─────────────────────────────────────────────────────────
create table if not exists heshbonot.documents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references heshbonot.businesses(id) on delete cascade,
  doc_type text not null check (doc_type in ('tax_invoice','receipt','invoice_receipt','quote',
            'delivery_note','credit_note','deal_invoice')),
  number integer not null,
  status text not null default 'issued' check (status in ('issued','cancelled')),
  contact_id uuid references heshbonot.contacts(id),
  customer_name text not null,
  customer_tax_id text,
  customer_address text,
  issue_date date not null default current_date,
  due_date date,
  vat_rate numeric(5,2) not null default 18,
  subtotal numeric(14,2) not null default 0,
  vat_amount numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  allocation_number text,
  notes text,
  related_doc_id uuid references heshbonot.documents(id),
  payment_status text not null default 'n/a' check (payment_status in ('n/a','unpaid','partial','paid')),
  paid_amount numeric(14,2) not null default 0,
  print_count integer not null default 0,
  cancelled_by_doc_id uuid,
  created_by uuid,
  issued_at timestamptz not null default now(),
  unique (business_id, doc_type, number)
);
create index if not exists documents_biz_date on heshbonot.documents(business_id, issue_date);

create table if not exists heshbonot.document_items (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references heshbonot.documents(id) on delete cascade,
  business_id uuid not null,
  line_no integer not null,
  description text not null,
  qty numeric(12,3) not null default 1,
  unit_price numeric(14,2) not null default 0,
  discount_pct numeric(5,2) not null default 0,
  line_total numeric(14,2) not null default 0
);
create index if not exists items_doc on heshbonot.document_items(document_id);

create table if not exists heshbonot.document_payments (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references heshbonot.documents(id) on delete cascade,
  business_id uuid not null,
  method text not null check (method in ('cash','check','transfer','credit','bit')),
  amount numeric(14,2) not null check (amount > 0),
  check_no text, bank text, check_date date, reference text
);
create index if not exists pays_doc on heshbonot.document_payments(document_id);

-- הגנת אי-שינוי: מסמך שהופק לא נערך ולא נמחק. מותר רק שדות סטטוס תשלום/ביטול/הדפסה.
create or replace function heshbonot.documents_guard() returns trigger
language plpgsql as $$
declare skip text[] := array['paid_amount','payment_status','status','cancelled_by_doc_id','print_count'];
begin
  if tg_op = 'DELETE' then
    raise exception 'מסמך שהופק לא ניתן למחיקה. לביטול יש להפיק חשבונית זיכוי.' using errcode = 'P0001';
  end if;
  if (to_jsonb(new) - skip) is distinct from (to_jsonb(old) - skip) then
    raise exception 'מסמך שהופק לא ניתן לעריכה.' using errcode = 'P0001';
  end if;
  if old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception 'מסמך שבוטל לא ניתן להחייאה.' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_docs_guard on heshbonot.documents;
create trigger trg_docs_guard before update or delete on heshbonot.documents
  for each row execute function heshbonot.documents_guard();

create or replace function heshbonot.children_guard() returns trigger
language plpgsql as $$
begin
  raise exception 'שורות מסמך שהופק אינן ניתנות לשינוי.' using errcode = 'P0001';
end $$;
drop trigger if exists trg_items_guard on heshbonot.document_items;
create trigger trg_items_guard before update or delete on heshbonot.document_items
  for each row execute function heshbonot.children_guard();
drop trigger if exists trg_pays_guard on heshbonot.document_payments;
create trigger trg_pays_guard before update or delete on heshbonot.document_payments
  for each row execute function heshbonot.children_guard();

-- ── הוצאות ─────────────────────────────────────────────────────────
create table if not exists heshbonot.expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references heshbonot.businesses(id) on delete cascade,
  supplier_id uuid references heshbonot.contacts(id),
  supplier_name text not null,
  expense_date date not null default current_date,
  category text not null default 'כללי',
  description text,
  amount_net numeric(14,2) not null check (amount_net >= 0),
  vat_amount numeric(14,2) not null default 0 check (vat_amount >= 0),
  vat_recognized_pct numeric(5,2) not null default 100 check (vat_recognized_pct between 0 and 100),
  vat_recognized numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  doc_ref text,
  attachment_path text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists expenses_biz_date on heshbonot.expenses(business_id, expense_date);

create or replace function heshbonot.expenses_calc() returns trigger
language plpgsql as $$
begin
  new.vat_recognized := round(new.vat_amount * new.vat_recognized_pct / 100, 2);
  new.total := new.amount_net + new.vat_amount;
  if new.created_by is null then new.created_by := auth.uid(); end if;
  return new;
end $$;
drop trigger if exists trg_exp_calc on heshbonot.expenses;
create trigger trg_exp_calc before insert or update on heshbonot.expenses
  for each row execute function heshbonot.expenses_calc();

-- ── תנועות בנק ─────────────────────────────────────────────────────
create table if not exists heshbonot.bank_txns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references heshbonot.businesses(id) on delete cascade,
  txn_date date not null,
  description text not null default '',
  credit numeric(14,2) not null default 0,
  debit numeric(14,2) not null default 0,
  balance numeric(14,2),
  hash text not null,
  match_type text check (match_type in ('document','expense')),
  match_id uuid,
  match_confidence integer,
  match_status text not null default 'none' check (match_status in ('none','suggested','confirmed','rejected')),
  batch text,
  created_at timestamptz not null default now(),
  unique (business_id, hash)
);
create index if not exists txns_biz_date on heshbonot.bank_txns(business_id, txn_date);

-- ── יומן ביקורת ────────────────────────────────────────────────────
create table if not exists heshbonot.audit_log (
  id bigserial primary key,
  ts timestamptz not null default now(),
  user_id uuid,
  business_id uuid,
  table_name text not null,
  row_id text,
  action text not null,
  old_row jsonb,
  new_row jsonb
);
create index if not exists audit_biz_ts on heshbonot.audit_log(business_id, ts desc);

create or replace function heshbonot.audit_trig() returns trigger
language plpgsql security definer set search_path = heshbonot, public as $$
declare r jsonb; o jsonb;
begin
  r := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  o := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  if tg_table_name = 'businesses' and r is not null then r := r - 'logo'; end if;
  if tg_table_name = 'businesses' and o is not null then o := o - 'logo'; end if;
  insert into heshbonot.audit_log(user_id, business_id, table_name, row_id, action, old_row, new_row)
  values (auth.uid(),
          coalesce((coalesce(r, o)->>'business_id')::uuid,
                   case when tg_table_name = 'businesses' then (coalesce(r, o)->>'id')::uuid end),
          tg_table_name, coalesce(r, o)->>'id', tg_op, o, r);
  return coalesce(new, old);
end $$;

do $$ declare t text; begin
  foreach t in array array['businesses','contacts','documents','document_payments','expenses','bank_txns','members'] loop
    execute format('drop trigger if exists trg_audit on heshbonot.%I', t);
    execute format('create trigger trg_audit after insert or update or delete on heshbonot.%I
                    for each row execute function heshbonot.audit_trig()', t);
  end loop;
end $$;
-- members אין לה business_id בשם id; audit מטפל (row_id ריק). בסדר.

-- ── הפקת מסמך (RPC, מספור רציף עם נעילה) ─────────────────────────
create or replace function heshbonot.issue_document(p jsonb)
returns jsonb language plpgsql security definer
set search_path = heshbonot, public as $$
declare
  bid uuid := (p->>'business_id')::uuid;
  dtype text := p->>'doc_type';
  b heshbonot.businesses;
  seq int; did uuid := gen_random_uuid();
  it jsonb; pay jsonb; n int := 0;
  lt numeric; sub numeric := 0; vat numeric := 0; tot numeric := 0; vr numeric;
  paysum numeric := 0; pstat text := 'n/a';
  rel heshbonot.documents; tid text := nullif(trim(coalesce(p->>'customer_tax_id','')), '');
  cname text := nullif(trim(coalesce(p->>'customer_name','')), '');
  alloc text := nullif(trim(coalesce(p->>'allocation_number','')), '');
  idate date := coalesce(nullif(p->>'issue_date','')::date, current_date);
begin
  if not heshbonot.has_role(bid, 'owner') then
    raise exception 'אין הרשאה להפקת מסמכים (נדרש תפקיד בעלים והתחברות עם אימות דו-שלבי).' using errcode = '42501';
  end if;
  if dtype not in ('tax_invoice','receipt','invoice_receipt','quote','delivery_note','credit_note','deal_invoice') then
    raise exception 'סוג מסמך לא מוכר.';
  end if;
  select * into b from heshbonot.businesses where id = bid;
  if cname is null then raise exception 'חסר שם לקוח.'; end if;
  if tid is not null and not heshbonot.valid_il_id(tid) then
    raise exception 'מספר ח.פ/ת.ז/ע.מ של הלקוח אינו תקין (ספרת ביקורת).';
  end if;
  vr := case when b.vat_type = 'exempt' then 0 else b.vat_rate end;

  -- חישוב שורות
  if jsonb_typeof(p->'items') = 'array' then
    for it in select * from jsonb_array_elements(p->'items') loop
      if coalesce(trim(it->>'description'), '') = '' then continue; end if;
      lt := round(coalesce((it->>'qty')::numeric, 1) * coalesce((it->>'unit_price')::numeric, 0)
                  * (1 - coalesce((it->>'discount_pct')::numeric, 0) / 100), 2);
      sub := sub + lt;
    end loop;
  end if;
  -- תשלומים (קבלה / חשבונית מס-קבלה)
  if jsonb_typeof(p->'payments') = 'array' then
    for pay in select * from jsonb_array_elements(p->'payments') loop
      paysum := paysum + coalesce((pay->>'amount')::numeric, 0);
    end loop;
  end if;

  if dtype = 'receipt' then
    if paysum <= 0 then raise exception 'קבלה חייבת לכלול לפחות תשלום אחד.'; end if;
    sub := paysum; vat := 0; tot := paysum;
  else
    if sub < 0 or (sub = 0 and dtype <> 'delivery_note') then
      raise exception 'סכום המסמך חייב להיות חיובי.';
    end if;
    vat := round(sub * vr / 100, 2);
    tot := sub + vat;
    if dtype = 'invoice_receipt' and abs(paysum - tot) > 0.009 then
      raise exception 'סכום התשלומים (%) חייב להיות שווה לסכום החשבונית (%).', paysum, tot;
    end if;
  end if;

  -- מספר הקצאה (רשות המסים)
  if dtype in ('tax_invoice','invoice_receipt') and tid is not null and b.vat_type <> 'exempt'
     and sub > b.allocation_threshold and alloc is null then
    raise exception 'נדרש מספר הקצאה מרשות המסים: חשבונית מעל % ₪ לפני מע"מ ללקוח עוסק מורשה.', b.allocation_threshold;
  end if;

  -- מסמך קשור
  if nullif(p->>'related_doc_id','') is not null then
    select * into rel from heshbonot.documents
      where id = (p->>'related_doc_id')::uuid and business_id = bid for update;
    if not found then raise exception 'המסמך הקשור לא נמצא.'; end if;
    if dtype = 'receipt' and rel.doc_type not in ('tax_invoice','deal_invoice') then
      raise exception 'קבלה אפשר לקשר רק לחשבונית מס או לחשבון עסקה.';
    end if;
    if dtype = 'receipt' and rel.status = 'cancelled' then raise exception 'החשבונית בוטלה.'; end if;
    if dtype = 'receipt' and rel.doc_type = 'tax_invoice' and paysum > rel.total - rel.paid_amount + 0.009 then
      raise exception 'סכום הקבלה גבוה מיתרת החוב (%).', rel.total - rel.paid_amount;
    end if;
    if dtype = 'credit_note' and rel.doc_type not in ('tax_invoice','invoice_receipt') then
      raise exception 'חשבונית זיכוי מקושרת רק לחשבונית מס או חשבונית מס-קבלה.';
    end if;
    if dtype = 'credit_note' and tot > rel.total + 0.009 then
      raise exception 'סכום הזיכוי גבוה מסכום החשבונית.';
    end if;
  elsif dtype = 'credit_note' then
    -- זיכוי ללא קישור מותר (למשל זיכוי על חשבונית מתוכנה קודמת)
    null;
  end if;

  -- נעילה ומספור
  insert into heshbonot.doc_sequences(business_id, doc_type) values (bid, dtype) on conflict do nothing;
  select next_number into seq from heshbonot.doc_sequences
    where business_id = bid and doc_type = dtype for update;
  update heshbonot.doc_sequences set next_number = seq + 1 where business_id = bid and doc_type = dtype;

  pstat := case dtype when 'tax_invoice' then 'unpaid' when 'invoice_receipt' then 'paid'
                      else 'n/a' end;

  insert into heshbonot.documents(id, business_id, doc_type, number, contact_id, customer_name,
      customer_tax_id, customer_address, issue_date, due_date, vat_rate, subtotal, vat_amount, total,
      allocation_number, notes, related_doc_id, payment_status, paid_amount, created_by)
  values (did, bid, dtype, seq, nullif(p->>'contact_id','')::uuid, cname, tid,
      nullif(p->>'customer_address',''), idate, nullif(p->>'due_date','')::date, vr, sub, vat, tot,
      alloc, nullif(p->>'notes',''), nullif(p->>'related_doc_id','')::uuid, pstat,
      case when dtype = 'invoice_receipt' then tot else 0 end, auth.uid());

  if jsonb_typeof(p->'items') = 'array' then
    for it in select * from jsonb_array_elements(p->'items') loop
      if coalesce(trim(it->>'description'), '') = '' then continue; end if;
      n := n + 1;
      insert into heshbonot.document_items(document_id, business_id, line_no, description, qty,
         unit_price, discount_pct, line_total)
      values (did, bid, n, trim(it->>'description'), coalesce((it->>'qty')::numeric, 1),
         coalesce((it->>'unit_price')::numeric, 0), coalesce((it->>'discount_pct')::numeric, 0),
         round(coalesce((it->>'qty')::numeric, 1) * coalesce((it->>'unit_price')::numeric, 0)
               * (1 - coalesce((it->>'discount_pct')::numeric, 0) / 100), 2));
    end loop;
  end if;
  if dtype = 'receipt' and n = 0 then
    insert into heshbonot.document_items(document_id, business_id, line_no, description, qty, unit_price, line_total)
    values (did, bid, 1, case when rel.id is not null
              then 'תשלום עבור חשבונית מס מספר ' || rel.number else 'תשלום שהתקבל' end, 1, paysum, paysum);
  end if;
  if jsonb_typeof(p->'payments') = 'array' then
    for pay in select * from jsonb_array_elements(p->'payments') loop
      insert into heshbonot.document_payments(document_id, business_id, method, amount, check_no, bank, check_date, reference)
      values (did, bid, pay->>'method', (pay->>'amount')::numeric, nullif(pay->>'check_no',''),
              nullif(pay->>'bank',''), nullif(pay->>'check_date','')::date, nullif(pay->>'reference',''));
    end loop;
  end if;

  -- השפעה על המסמך הקשור
  if rel.id is not null and dtype = 'receipt' then
    update heshbonot.documents set
      paid_amount = rel.paid_amount + paysum,
      payment_status = case when rel.paid_amount + paysum >= rel.total - 0.009 then 'paid' else 'partial' end
    where id = rel.id;
  elsif rel.id is not null and dtype = 'credit_note' and tot >= rel.total - 0.009 then
    update heshbonot.documents set status = 'cancelled', cancelled_by_doc_id = did where id = rel.id;
  end if;

  return jsonb_build_object('id', did, 'number', seq, 'doc_type', dtype);
end $$;

-- סימון תשלום ידני (אישור התאמת בנק לחשבונית פתוחה)
create or replace function heshbonot.mark_paid(doc uuid, amt numeric)
returns void language plpgsql security definer set search_path = heshbonot, public as $$
declare d heshbonot.documents;
begin
  select * into d from heshbonot.documents where id = doc for update;
  if not found or not heshbonot.has_role(d.business_id, 'owner') then
    raise exception 'אין הרשאה.' using errcode = '42501';
  end if;
  if d.doc_type <> 'tax_invoice' then raise exception 'רק חשבונית מס נסגרת בתשלום.'; end if;
  update heshbonot.documents set paid_amount = least(d.total, d.paid_amount + amt),
    payment_status = case when d.paid_amount + amt >= d.total - 0.009 then 'paid' else 'partial' end
  where id = doc;
end $$;

-- ספירת הדפסות: ההדפסה הראשונה "מקור", הבאות "העתק נאמן למקור"
create or replace function heshbonot.mark_printed(doc uuid)
returns integer language plpgsql security definer set search_path = heshbonot, public as $$
declare d heshbonot.documents; c int;
begin
  select * into d from heshbonot.documents where id = doc for update;
  if not found or not heshbonot.has_role(d.business_id, 'viewer') then
    raise exception 'אין הרשאה.' using errcode = '42501';
  end if;
  update heshbonot.documents set print_count = print_count + 1 where id = doc returning print_count into c;
  return c;
end $$;

-- מספר התחלתי (למי שעובר מתוכנה אחרת): רק כלפי מעלה
create or replace function heshbonot.set_start_number(bid uuid, dtype text, n integer)
returns void language plpgsql security definer set search_path = heshbonot, public as $$
declare cur int;
begin
  if not heshbonot.has_role(bid, 'owner') then raise exception 'אין הרשאה.' using errcode = '42501'; end if;
  select next_number into cur from heshbonot.doc_sequences where business_id = bid and doc_type = dtype for update;
  if cur is null then raise exception 'סוג מסמך לא מוכר.'; end if;
  if n < cur then raise exception 'אפשר רק להגדיל את המספר הבא (נוכחי: %). מספור רציף אינו מאפשר חזרה אחורה.', cur; end if;
  update heshbonot.doc_sequences set next_number = n where business_id = bid and doc_type = dtype;
end $$;

-- ── דוחות (security invoker: RLS נאכף) ────────────────────────────
-- מסמכי הכנסה: חשבונית מס, חשבונית מס/קבלה, קבלה עצמאית (+) וזיכוי (-)
create or replace view heshbonot.income_docs with (security_invoker = true) as
  select d.*, case when d.doc_type = 'credit_note' then -1 else 1 end as sign
  from heshbonot.documents d
  where d.doc_type in ('tax_invoice','invoice_receipt','credit_note')
     or (d.doc_type = 'receipt' and d.related_doc_id is null);

create or replace function heshbonot.report_vat(bid uuid, d1 date, d2 date)
returns jsonb language sql stable set search_path = heshbonot, public as $$
  with s as (
    select coalesce(sum(sign * subtotal), 0) as net, coalesce(sum(sign * vat_amount), 0) as vat, count(*) as n
    from heshbonot.income_docs where business_id = bid and issue_date between d1 and d2),
  e as (
    select coalesce(sum(amount_net), 0) as net, coalesce(sum(vat_recognized), 0) as vat, count(*) as n
    from heshbonot.expenses where business_id = bid and expense_date between d1 and d2)
  select jsonb_build_object('sales_net', s.net, 'output_vat', s.vat, 'sales_docs', s.n,
     'inputs_net', e.net, 'input_vat', e.vat, 'expense_count', e.n, 'payable', s.vat - e.vat)
  from s, e;
$$;

create or replace function heshbonot.report_pnl(bid uuid, d1 date, d2 date)
returns jsonb language sql stable set search_path = heshbonot, public as $$
  select jsonb_build_object(
    'income', (select coalesce(sum(sign * subtotal), 0) from heshbonot.income_docs
               where business_id = bid and issue_date between d1 and d2),
    'expenses', (select coalesce(sum(amount_net + vat_amount - vat_recognized), 0) from heshbonot.expenses
               where business_id = bid and expense_date between d1 and d2),
    'by_category', (select coalesce(jsonb_agg(jsonb_build_object('category', c, 'amount', a) order by a desc), '[]'::jsonb)
       from (select category c, sum(amount_net + vat_amount - vat_recognized) a from heshbonot.expenses
             where business_id = bid and expense_date between d1 and d2 group by category) q));
$$;

create or replace function heshbonot.report_dashboard(bid uuid)
returns jsonb language sql stable set search_path = heshbonot, public as $$
  with m as (select date_trunc('month', current_date) - (i || ' month')::interval as ms from generate_series(0, 11) i),
  inc as (select m.ms, coalesce((select sum(sign * subtotal) from heshbonot.income_docs
            where business_id = bid and issue_date >= m.ms and issue_date < m.ms + interval '1 month'), 0) v from m),
  ex as (select m.ms, coalesce((select sum(amount_net + vat_amount - vat_recognized) from heshbonot.expenses
            where business_id = bid and expense_date >= m.ms and expense_date < m.ms + interval '1 month'), 0) v from m)
  select jsonb_build_object(
    'months', (select jsonb_agg(jsonb_build_object('month', to_char(inc.ms, 'YYYY-MM'), 'income', inc.v, 'expenses', ex.v)
               order by inc.ms) from inc join ex using (ms)),
    'open_debt', (select coalesce(sum(total - paid_amount), 0) from heshbonot.documents
                  where business_id = bid and doc_type = 'tax_invoice' and status = 'issued' and payment_status <> 'paid'),
    'overdue_count', (select count(*) from heshbonot.documents
                  where business_id = bid and doc_type = 'tax_invoice' and status = 'issued' and payment_status <> 'paid'
                    and coalesce(due_date, issue_date) < current_date),
    'open_count', (select count(*) from heshbonot.documents
                  where business_id = bid and doc_type = 'tax_invoice' and status = 'issued' and payment_status <> 'paid'));
$$;

-- ── הרשאות ─────────────────────────────────────────────────────────
revoke all on all tables in schema heshbonot from anon, authenticated, public;
revoke all on all functions in schema heshbonot from anon, public;
revoke all on all sequences in schema heshbonot from anon, authenticated;
grant usage on schema heshbonot to authenticated, service_role;
grant all on all tables in schema heshbonot to service_role;
grant all on all sequences in schema heshbonot to service_role;
grant all on all functions in schema heshbonot to service_role;

grant select on all tables in schema heshbonot to authenticated;
revoke select on heshbonot.audit_log from authenticated;     -- דרך policy מצומצמת למטה
grant select on heshbonot.audit_log to authenticated;
grant insert, update, delete on heshbonot.contacts, heshbonot.expenses, heshbonot.bank_txns to authenticated;
grant update on heshbonot.businesses to authenticated;
grant usage, select on all sequences in schema heshbonot to authenticated;
grant execute on function heshbonot.has_role(uuid, text), heshbonot.issue_document(jsonb),
  heshbonot.mark_paid(uuid, numeric), heshbonot.mark_printed(uuid), heshbonot.set_start_number(uuid, text, integer),
  heshbonot.report_vat(uuid, date, date), heshbonot.report_pnl(uuid, date, date), heshbonot.report_dashboard(uuid),
  heshbonot.valid_il_id(text) to authenticated;
-- פונקציות העזר לטריגרים לא נחשפות
alter default privileges in schema heshbonot grant all on tables to service_role;
alter default privileges in schema heshbonot grant all on functions to service_role;

-- ── RLS ───────────────────────────────────────────────────────────
do $$ declare t text; begin
  foreach t in array array['businesses','members','doc_sequences','contacts','documents','document_items',
                           'document_payments','expenses','bank_txns','audit_log'] loop
    execute format('alter table heshbonot.%I enable row level security', t);
    execute format('alter table heshbonot.%I force row level security', t);
  end loop;
end $$;

drop policy if exists p_biz_sel on heshbonot.businesses;
create policy p_biz_sel on heshbonot.businesses for select to authenticated using (heshbonot.has_role(id, 'viewer'));
drop policy if exists p_biz_upd on heshbonot.businesses;
create policy p_biz_upd on heshbonot.businesses for update to authenticated
  using (heshbonot.has_role(id, 'owner')) with check (heshbonot.has_role(id, 'owner'));

drop policy if exists p_mem_sel on heshbonot.members;
create policy p_mem_sel on heshbonot.members for select to authenticated
  using (user_id = auth.uid() and coalesce(auth.jwt() ->> 'aal', '') = 'aal2');

drop policy if exists p_seq_sel on heshbonot.doc_sequences;
create policy p_seq_sel on heshbonot.doc_sequences for select to authenticated using (heshbonot.has_role(business_id, 'viewer'));

do $$ declare t text; begin
  foreach t in array array['contacts','expenses','bank_txns'] loop
    execute format('drop policy if exists p_sel on heshbonot.%I', t);
    execute format('create policy p_sel on heshbonot.%I for select to authenticated using (heshbonot.has_role(business_id, ''viewer''))', t);
    execute format('drop policy if exists p_ins on heshbonot.%I', t);
    execute format('create policy p_ins on heshbonot.%I for insert to authenticated with check (heshbonot.has_role(business_id, ''owner''))', t);
    execute format('drop policy if exists p_upd on heshbonot.%I', t);
    execute format('create policy p_upd on heshbonot.%I for update to authenticated using (heshbonot.has_role(business_id, ''owner'')) with check (heshbonot.has_role(business_id, ''owner''))', t);
    execute format('drop policy if exists p_del on heshbonot.%I', t);
    execute format('create policy p_del on heshbonot.%I for delete to authenticated using (heshbonot.has_role(business_id, ''owner''))', t);
  end loop;
  foreach t in array array['documents','document_items','document_payments'] loop
    execute format('drop policy if exists p_sel on heshbonot.%I', t);
    execute format('create policy p_sel on heshbonot.%I for select to authenticated using (heshbonot.has_role(business_id, ''viewer''))', t);
  end loop;
end $$;

drop policy if exists p_audit_sel on heshbonot.audit_log;
create policy p_audit_sel on heshbonot.audit_log for select to authenticated using (heshbonot.has_role(business_id, 'accountant'));

-- ── Storage: קבצים מצורפים להוצאות (פרטי) ─────────────────────────
create or replace function heshbonot.att_ok(obj text, min_role text) returns boolean
language plpgsql stable security definer set search_path = heshbonot, public as $$
begin
  if obj !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' then return false; end if;
  return heshbonot.has_role(split_part(obj, '/', 1)::uuid, min_role);
end $$;
revoke all on function heshbonot.att_ok(text, text) from anon, public;
grant execute on function heshbonot.att_ok(text, text) to authenticated, service_role;

insert into storage.buckets (id, name, public, file_size_limit)
values ('heshbonot-attachments', 'heshbonot-attachments', false, 10485760)
on conflict (id) do update set public = false;

drop policy if exists heshbonot_att_sel on storage.objects;
create policy heshbonot_att_sel on storage.objects for select to authenticated
  using (case when bucket_id = 'heshbonot-attachments' then heshbonot.att_ok(name, 'viewer') else false end);
drop policy if exists heshbonot_att_ins on storage.objects;
create policy heshbonot_att_ins on storage.objects for insert to authenticated
  with check (case when bucket_id = 'heshbonot-attachments' then heshbonot.att_ok(name, 'owner') else false end);
drop policy if exists heshbonot_att_del on storage.objects;
create policy heshbonot_att_del on storage.objects for delete to authenticated
  using (case when bucket_id = 'heshbonot-attachments' then heshbonot.att_ok(name, 'owner') else false end);
