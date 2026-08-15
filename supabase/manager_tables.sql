-- =============================================================================
-- Manager tab support: dynamic staff management + configurable website discount
-- Run this in the Supabase SQL editor (or via the CLI) before using the
-- Manager tab. It is idempotent and safe to re-run.
-- =============================================================================

-- 1) STAFF ------------------------------------------------------------------
-- Dynamic staff roster that powers every "Staff Member" dropdown across LodgeOS.
-- Deactivating a member (is_active = false) instantly removes them from future
-- dropdown options while preserving the historical record on past folios.
create table if not exists public.staff (
  staff_id    uuid primary key default gen_random_uuid(),
  first_name  text        not null,
  last_name   text        not null default '',
  role        text        not null default 'Front Desk',
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now()
);

-- Seed with the existing hard-coded roster (only inserts the first time).
insert into public.staff (first_name, last_name, role)
select split_part(name, ' ', 1),
       trim(substring(name from position(' ' in name) + 1)),
       'Front Desk'
from (values
  ('Roxanne Gueutal'),
  ('Sydney Fulop-Gueutal'),
  ('Jadeyn JF Fulop-Gueutal'),
  ('Wynonna Wanyandie'),
  ('Lauren Blair'),
  ('Carmi Punzalan'),
  ('Nicholas Aki-Akpotha')
) as seed(name)
where not exists (select 1 from public.staff);

-- 2) HOTEL SETTINGS ---------------------------------------------------------
-- Single-row key store for lodge-wide configuration. website_discount is a
-- whole-number percentage (0–100) applied to the total taxed room price for
-- reservations booked through the Grande Mountain Lodge website.
create table if not exists public.hotel_settings (
  id               integer primary key default 1,
  website_discount numeric(5,2) not null default 0,
  updated_at       timestamptz  not null default now(),
  constraint hotel_settings_singleton check (id = 1)
);

insert into public.hotel_settings (id, website_discount)
values (1, 0)
on conflict (id) do nothing;

-- NOTE ----------------------------------------------------------------------
-- If your transactions.staff_member / folio_entries.staff_member columns are a
-- Postgres ENUM, adding a brand-new staff member here will fail on insert of a
-- transaction/charge that references that new name. To fully support arbitrary
-- new staff, convert those columns to text, e.g.:
--   alter table public.transactions  alter column staff_member type text;
--   alter table public.folio_entries alter column staff_member type text;
-- =============================================================================
