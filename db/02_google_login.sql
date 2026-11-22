-- ═══════════════════════════════════════════════════════════════════
-- heshbonot — מעבר לכניסה עם גוגל (בטא): בלי aal2/TOTP. idempotent.
-- ההרשאה: חברות ב-heshbonot.members + תפקיד. חברות נוצרת מהזמנה לפי מייל (claim_invites).
-- ═══════════════════════════════════════════════════════════════════

-- הרשאה: חברות בעסק + תפקיד מינימלי (ללא דרישת aal2)
create or replace function heshbonot.has_role(bid uuid, min_role text)
returns boolean language sql stable security definer
set search_path = heshbonot, public as $$
  select exists (
    select 1 from heshbonot.members m
    where m.user_id = auth.uid() and m.business_id = bid
      and case min_role
            when 'viewer' then true
            when 'accountant' then m.role in ('owner','accountant')
            else m.role = 'owner' end);
$$;

drop policy if exists p_mem_sel on heshbonot.members;
create policy p_mem_sel on heshbonot.members for select to authenticated
  using (user_id = auth.uid());

-- הזמנות לפי מייל. נגישה רק דרך claim_invites (RLS מופעל, בלי policies, בלי grants)
create table if not exists heshbonot.invites (
  email text primary key,
  business_id uuid not null references heshbonot.businesses(id) on delete cascade,
  role text not null check (role in ('owner','accountant','viewer'))
);
alter table heshbonot.invites enable row level security;
alter table heshbonot.invites force row level security;
revoke all on heshbonot.invites from anon, authenticated, public;

create or replace function heshbonot.claim_invites() returns void
language plpgsql security definer set search_path = heshbonot, public as $$
begin
  if auth.uid() is null then return; end if;
  insert into heshbonot.members (user_id, business_id, role)
  select auth.uid(), i.business_id, i.role from heshbonot.invites i
  where lower(i.email) = lower(auth.jwt() ->> 'email')
  on conflict do nothing;
end $$;
revoke all on function heshbonot.claim_invites() from public, anon;
grant execute on function heshbonot.claim_invites() to authenticated, service_role;

-- הזמנת הבעלים לעסק הקיים
insert into heshbonot.invites (email, business_id, role)
select '6742853@gmail.com', coalesce(
  (select m.business_id from heshbonot.members m where m.role = 'owner' order by m.created_at limit 1),
  (select b.id from heshbonot.businesses b order by b.created_at limit 1)), 'owner'
where exists (select 1 from heshbonot.businesses)
on conflict (email) do nothing;
