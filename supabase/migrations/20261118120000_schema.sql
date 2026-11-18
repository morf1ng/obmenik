-- VALORA: внутренняя система обменной компании.
-- Денежные суммы — только numeric. Баланс кассы не хранится отдельным полем:
-- он всегда равен сумме проведённых записей финансового журнала.

create extension if not exists pgcrypto;

create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Справочники и доступ
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  full_name text not null check (char_length(full_name) between 2 and 160),
  email text,
  role text not null check (role in ('ADMIN', 'ACCOUNTANT', 'MANAGER', 'EMPLOYEE')),
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 2 and 120),
  address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.currencies (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{3,8}$'),
  name text not null,
  symbol text not null,
  precision integer not null default 2 check (precision between 0 and 8),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.cashboxes (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations (id),
  currency_id uuid not null references public.currencies (id),
  name text not null check (char_length(name) between 2 and 160),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (location_id, currency_id)
);

create table public.transit_accounts (
  id uuid primary key default gen_random_uuid(),
  currency_id uuid not null unique references public.currencies (id),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.employee_locations (
  user_id uuid not null references public.profiles (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  primary key (user_id, location_id)
);

create table public.role_permissions (
  role text not null check (role in ('ADMIN', 'ACCOUNTANT', 'MANAGER', 'EMPLOYEE')),
  action text not null,
  primary key (role, action)
);

create table public.user_permission_overrides (
  user_id uuid not null references public.profiles (id) on delete cascade,
  action text not null,
  allowed boolean not null,
  primary key (user_id, action)
);

create table public.counterparties (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 200),
  phone text,
  comment text,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.exchange_rates (
  id uuid primary key default gen_random_uuid(),
  base_currency_id uuid not null references public.currencies (id),
  quote_currency_id uuid not null references public.currencies (id),
  buy_rate numeric(20, 8) not null check (buy_rate > 0),
  sell_rate numeric(20, 8) not null check (sell_rate > 0),
  effective_at timestamptz not null default now(),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  check (base_currency_id <> quote_currency_id)
);

create index exchange_rates_lookup_idx
  on public.exchange_rates (base_currency_id, quote_currency_id, effective_at desc);

-- ---------------------------------------------------------------------------
-- Документы
-- ---------------------------------------------------------------------------

create sequence public.operation_number_seq;
create sequence public.transfer_number_seq;
create sequence public.debt_number_seq;

create table public.operations (
  id uuid primary key default gen_random_uuid(),
  operation_number text not null unique,
  type text not null check (type in ('exchange', 'cash_in', 'cash_out', 'adjustment')),
  location_id uuid not null references public.locations (id),
  counterparty_id uuid references public.counterparties (id),
  status text not null default 'draft' check (status in ('draft', 'posted', 'cancelled')),
  cashbox_in_id uuid references public.cashboxes (id),
  cashbox_out_id uuid references public.cashboxes (id),
  currency_from uuid references public.currencies (id),
  currency_to uuid references public.currencies (id),
  amount_from numeric(20, 8),
  amount_to numeric(20, 8),
  exchange_rate numeric(20, 8),
  commission numeric(20, 8) not null default 0 check (commission >= 0),
  commission_currency_id uuid references public.currencies (id),
  volume_rub numeric(20, 8),
  category text,
  comment text,
  cancel_reason text,
  idempotency_key text unique,
  created_by uuid not null references public.profiles (id),
  posted_by uuid references public.profiles (id),
  cancelled_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  posted_at timestamptz,
  cancelled_at timestamptz,
  check (char_length(coalesce(comment, '')) <= 2000),
  check (char_length(coalesce(cancel_reason, '')) <= 2000)
);

create index operations_list_idx
  on public.operations (created_at desc, location_id, status);

create table public.transfers (
  id uuid primary key default gen_random_uuid(),
  transfer_number text not null unique,
  from_location_id uuid not null references public.locations (id),
  to_location_id uuid not null references public.locations (id),
  currency_id uuid not null references public.currencies (id),
  amount numeric(20, 8) not null check (amount > 0),
  commission numeric(20, 8) not null default 0 check (commission >= 0),
  net_amount numeric(20, 8) not null check (net_amount > 0),
  status text not null check (status in ('created', 'sent', 'received', 'cancelled')),
  comment text,
  cancel_reason text,
  created_by uuid not null references public.profiles (id),
  sent_by uuid references public.profiles (id),
  received_by uuid references public.profiles (id),
  cancelled_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  received_at timestamptz,
  cancelled_at timestamptz,
  check (from_location_id <> to_location_id),
  check (net_amount = amount - commission),
  check (char_length(coalesce(comment, '')) <= 2000)
);

create table public.transfer_events (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.transfers (id),
  status text not null,
  actor_id uuid not null references public.profiles (id),
  comment text,
  created_at timestamptz not null default now()
);

create index transfer_events_idx on public.transfer_events (transfer_id, created_at);

create table public.debts (
  id uuid primary key default gen_random_uuid(),
  debt_number text not null unique,
  counterparty_id uuid not null references public.counterparties (id),
  currency_id uuid not null references public.currencies (id),
  location_id uuid not null references public.locations (id),
  -- receivable: контрагент должен компании (положительная позиция)
  -- payable: компания должна контрагенту (отрицательная позиция)
  direction text not null check (direction in ('receivable', 'payable')),
  amount numeric(20, 8) not null check (amount > 0),
  remaining_amount numeric(20, 8) not null check (remaining_amount >= 0),
  status text not null check (status in ('open', 'partial', 'settled', 'cancelled')),
  comment text,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  check (remaining_amount <= amount)
);

create table public.debt_payments (
  id uuid primary key default gen_random_uuid(),
  debt_id uuid not null references public.debts (id),
  amount numeric(20, 8) not null check (amount > 0),
  cashbox_id uuid not null references public.cashboxes (id),
  comment text,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  ledger_transaction_id uuid
);

-- ---------------------------------------------------------------------------
-- Журнал. Проведённые строки не удаляются. Отмена — обратные записи.
-- ---------------------------------------------------------------------------

create table public.idempotency_keys (
  key text primary key,
  user_id uuid not null references public.profiles (id),
  entity_type text not null,
  entity_id uuid not null,
  created_at timestamptz not null default now()
);

create table public.ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  operation_id uuid references public.operations (id),
  transfer_id uuid references public.transfers (id),
  debt_id uuid references public.debts (id),
  location_id uuid references public.locations (id),
  description text,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.financial_entries (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.ledger_transactions (id),
  operation_id uuid references public.operations (id),
  transfer_id uuid references public.transfers (id),
  debt_id uuid references public.debts (id),
  cashbox_id uuid references public.cashboxes (id),
  transit_account_id uuid references public.transit_accounts (id),
  currency_id uuid not null references public.currencies (id),
  counterparty_id uuid references public.counterparties (id),
  direction text not null check (direction in ('in', 'out')),
  amount numeric(20, 8) not null check (amount > 0),
  entry_type text not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles (id),
  check (
    (cashbox_id is not null and transit_account_id is null)
    or (cashbox_id is null and transit_account_id is not null)
    or (
      cashbox_id is null
      and transit_account_id is null
      and entry_type in ('commission', 'reversal')
    )
  )
);

create index financial_entries_cashbox_idx
  on public.financial_entries (cashbox_id, created_at, id);
create index financial_entries_operation_idx
  on public.financial_entries (operation_id);
create index financial_entries_transfer_idx
  on public.financial_entries (transfer_id);
create index financial_entries_created_idx
  on public.financial_entries (created_at);

alter table public.debt_payments
  add constraint debt_payments_ledger_fk
  foreign key (ledger_transaction_id) references public.ledger_transactions (id);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_created_idx on public.audit_logs (created_at desc);

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Демо-справочник точек и валют. Финансовые движения загружает seed.
-- ---------------------------------------------------------------------------

insert into public.locations (id, name, address) values
  ('11111111-1111-4111-8111-111111111111', 'Махачкала', 'DEMO · ул. Ярагского, 40'),
  ('22222222-2222-4222-8222-222222222222', 'Москва', 'DEMO · Пресненская наб., 12');

insert into public.currencies (id, code, name, symbol, precision) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'RUB', 'Российский рубль', '₽', 2),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'USD', 'Доллар США', '$', 2),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'EUR', 'Евро', '€', 2),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', 'USDT', 'Tether', '₮', 2);

insert into public.cashboxes (id, location_id, currency_id, name) values
  ('c1000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Касса RUB · Махачкала'),
  ('c1000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'Касса USD · Махачкала'),
  ('c1000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'Касса EUR · Махачкала'),
  ('c1000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', 'Касса USDT · Махачкала'),
  ('c2000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Касса RUB · Москва'),
  ('c2000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'Касса USD · Москва'),
  ('c2000000-0000-4000-8000-000000000003', '22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'Касса EUR · Москва'),
  ('c2000000-0000-4000-8000-000000000004', '22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', 'Касса USDT · Москва');

insert into public.transit_accounts (id, currency_id, name) values
  ('d0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Транзит RUB'),
  ('d0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'Транзит USD'),
  ('d0000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'Транзит EUR'),
  ('d0000000-0000-4000-8000-000000000004', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', 'Транзит USDT');

insert into public.app_settings (key, value) values
  ('company_name', '"VALORA"'::jsonb),
  ('legal_name', '"DEMO · внутренняя система обменной компании"'::jsonb),
  ('demo_seeded', 'false'::jsonb);

insert into public.role_permissions (role, action) values
  ('ADMIN', 'dashboard.view'),
  ('ADMIN', 'operations.view'),
  ('ADMIN', 'operations.create'),
  ('ADMIN', 'operations.post'),
  ('ADMIN', 'operations.cancel'),
  ('ADMIN', 'cashboxes.view'),
  ('ADMIN', 'cashboxes.move'),
  ('ADMIN', 'cashboxes.adjust'),
  ('ADMIN', 'counterparties.view'),
  ('ADMIN', 'counterparties.manage'),
  ('ADMIN', 'debts.view'),
  ('ADMIN', 'debts.manage'),
  ('ADMIN', 'transfers.view'),
  ('ADMIN', 'transfers.create'),
  ('ADMIN', 'transfers.send'),
  ('ADMIN', 'transfers.receive'),
  ('ADMIN', 'transfers.cancel'),
  ('ADMIN', 'accounting.view'),
  ('ADMIN', 'accounting.export'),
  ('ADMIN', 'rates.view'),
  ('ADMIN', 'rates.manage'),
  ('ADMIN', 'locations.view'),
  ('ADMIN', 'locations.manage'),
  ('ADMIN', 'employees.view'),
  ('ADMIN', 'employees.manage'),
  ('ADMIN', 'audit.view'),
  ('ADMIN', 'settings.manage'),
  ('ACCOUNTANT', 'dashboard.view'),
  ('ACCOUNTANT', 'operations.view'),
  ('ACCOUNTANT', 'cashboxes.view'),
  ('ACCOUNTANT', 'cashboxes.adjust'),
  ('ACCOUNTANT', 'counterparties.view'),
  ('ACCOUNTANT', 'counterparties.manage'),
  ('ACCOUNTANT', 'debts.view'),
  ('ACCOUNTANT', 'debts.manage'),
  ('ACCOUNTANT', 'transfers.view'),
  ('ACCOUNTANT', 'accounting.view'),
  ('ACCOUNTANT', 'accounting.export'),
  ('ACCOUNTANT', 'rates.view'),
  ('ACCOUNTANT', 'rates.manage'),
  ('ACCOUNTANT', 'locations.view'),
  ('ACCOUNTANT', 'employees.view'),
  ('ACCOUNTANT', 'audit.view'),
  ('MANAGER', 'dashboard.view'),
  ('MANAGER', 'operations.view'),
  ('MANAGER', 'operations.create'),
  ('MANAGER', 'operations.post'),
  ('MANAGER', 'operations.cancel'),
  ('MANAGER', 'cashboxes.view'),
  ('MANAGER', 'cashboxes.move'),
  ('MANAGER', 'counterparties.view'),
  ('MANAGER', 'counterparties.manage'),
  ('MANAGER', 'debts.view'),
  ('MANAGER', 'debts.manage'),
  ('MANAGER', 'transfers.view'),
  ('MANAGER', 'transfers.create'),
  ('MANAGER', 'transfers.send'),
  ('MANAGER', 'transfers.receive'),
  ('MANAGER', 'transfers.cancel'),
  ('MANAGER', 'rates.view'),
  ('MANAGER', 'locations.view'),
  ('EMPLOYEE', 'dashboard.view'),
  ('EMPLOYEE', 'operations.view'),
  ('EMPLOYEE', 'operations.create'),
  ('EMPLOYEE', 'cashboxes.view'),
  ('EMPLOYEE', 'counterparties.view'),
  ('EMPLOYEE', 'debts.view'),
  ('EMPLOYEE', 'transfers.view'),
  ('EMPLOYEE', 'rates.view'),
  ('EMPLOYEE', 'locations.view');

-- Новый пользователь auth не получает доступ, пока администратор его не активирует.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, role, is_active)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    new.email,
    'EMPLOYEE',
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();
