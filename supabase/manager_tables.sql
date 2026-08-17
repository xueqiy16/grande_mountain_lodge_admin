-- =============================================================================
-- Manager tab support: dynamic staff management + configurable website discount
-- Run this in the Supabase SQL editor (or via the CLI) before using the
-- Manager tab. It is idempotent and safe to re-run.
-- =============================================================================

-- 1) STAFF MEMBER -----------------------------------------------------------
-- Dynamic staff roster that powers every "Staff Member" dropdown across LodgeOS.
-- Deactivating a member (is_active = false) instantly removes them from future
-- dropdown options while preserving the historical record on past folios.

-- Position ENUM. A free-text description column (other_position) captures the
-- specifics when position = 'other'.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'staff_position') then
    create type public.staff_position as enum (
      'manager',
      'assistant_manager',
      'front_desk',
      'maintenance',
      'housekeeping',
      'housekeeping_part_time',
      'other'
    );
  end if;
end$$;

create table if not exists public.staff_member (
  staff_id              uuid primary key default gen_random_uuid(),
  first_name            text not null,
  middle_name           text,
  last_name             text not null,
  hire_date             date,
  position              public.staff_position not null default 'front_desk',
  other_position        text,
  second_position       public.staff_position,
  other_second_position text,
  hourly_pay            numeric(10,2),
  staff_notes           text,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now()
);

-- Additive columns for installs created before the second-position fields existed.
alter table public.staff_member add column if not exists other_position        text;
alter table public.staff_member add column if not exists second_position       public.staff_position;
alter table public.staff_member add column if not exists other_second_position text;

-- Seed with the existing hard-coded roster (only inserts the first time).
insert into public.staff_member (first_name, last_name, position)
select split_part(name, ' ', 1),
       trim(substring(name from position(' ' in name) + 1)),
       'front_desk'
from (values
  ('Roxanne Gueutal'),
  ('Sydney Fulop-Gueutal'),
  ('Jadeyn JF Fulop-Gueutal'),
  ('Wynonna Wanyandie'),
  ('Lauren Blair'),
  ('Carmi Punzalan'),
  ('Nicholas Aki-Akpotha')
) as seed(name)
where not exists (select 1 from public.staff_member);

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
