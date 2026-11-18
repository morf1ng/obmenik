-- RLS закрывает чтение. Запись денежных таблиц есть только у security definer функций.

alter table public.profiles enable row level security;
alter table public.locations enable row level security;
alter table public.currencies enable row level security;
alter table public.cashboxes enable row level security;
alter table public.transit_accounts enable row level security;
alter table public.employee_locations enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_permission_overrides enable row level security;
alter table public.counterparties enable row level security;
alter table public.exchange_rates enable row level security;
alter table public.operations enable row level security;
alter table public.transfers enable row level security;
alter table public.transfer_events enable row level security;
alter table public.debts enable row level security;
alter table public.debt_payments enable row level security;
alter table public.idempotency_keys enable row level security;
alter table public.ledger_transactions enable row level security;
alter table public.financial_entries enable row level security;
alter table public.audit_logs enable row level security;
alter table public.app_settings enable row level security;

create policy profiles_select on public.profiles
  for select to authenticated using (public.is_active_member());

create policy locations_select on public.locations
  for select to authenticated using (public.can_access_location(id));

create policy currencies_select on public.currencies
  for select to authenticated using (public.is_active_member());

create policy cashboxes_select on public.cashboxes
  for select to authenticated using (public.can_access_location(location_id));

create policy transit_select on public.transit_accounts
  for select to authenticated using (
    public.has_action('transfers.view')
    or public.has_action('accounting.view')
    or public.has_action('dashboard.view')
  );

create policy employee_locations_select on public.employee_locations
  for select to authenticated using (
    user_id = auth.uid()
    or public.has_action('employees.view')
    or public.has_action('employees.manage')
  );

create policy role_permissions_select on public.role_permissions
  for select to authenticated using (public.is_active_member());

create policy overrides_select on public.user_permission_overrides
  for select to authenticated using (
    user_id = auth.uid() or public.has_action('employees.manage')
  );

create policy counterparties_select on public.counterparties
  for select to authenticated using (public.has_action('counterparties.view'));

create policy rates_select on public.exchange_rates
  for select to authenticated using (public.has_action('rates.view'));

create policy operations_select on public.operations
  for select to authenticated using (
    public.has_action('operations.view') and public.can_access_location(location_id)
  );

create policy transfers_select on public.transfers
  for select to authenticated using (
    public.has_action('transfers.view')
    and (public.can_access_location(from_location_id) or public.can_access_location(to_location_id))
  );

create policy transfer_events_select on public.transfer_events
  for select to authenticated using (
    exists (
      select 1 from public.transfers t
      where t.id = transfer_id
        and public.has_action('transfers.view')
        and (public.can_access_location(t.from_location_id) or public.can_access_location(t.to_location_id))
    )
  );

create policy debts_select on public.debts
  for select to authenticated using (
    public.has_action('debts.view') and public.can_access_location(location_id)
  );

create policy debt_payments_select on public.debt_payments
  for select to authenticated using (
    exists (
      select 1 from public.debts d
      where d.id = debt_id
        and public.has_action('debts.view')
        and public.can_access_location(d.location_id)
    )
  );

create policy ledger_select on public.ledger_transactions
  for select to authenticated using (
    public.has_action('accounting.view')
    or (
      public.has_action('operations.view')
      and (location_id is null or public.can_access_location(location_id))
    )
  );

create policy entries_select on public.financial_entries
  for select to authenticated using (
    (
      cashbox_id is not null
      and public.has_action('cashboxes.view')
      and exists (
        select 1 from public.cashboxes c
        where c.id = cashbox_id and public.can_access_location(c.location_id)
      )
    )
    or (transit_account_id is not null and public.has_action('transfers.view'))
    or (
      cashbox_id is null and transit_account_id is null and public.has_action('accounting.view')
    )
  );

create policy audit_select on public.audit_logs
  for select to authenticated using (public.has_action('audit.view'));

create policy settings_select on public.app_settings
  for select to authenticated using (public.is_active_member());

revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;
revoke select on public.idempotency_keys from authenticated;

grant select on public.operations_list to authenticated;
grant select on public.cashbox_balances to authenticated;
grant select on public.transfers_list to authenticated;
grant select on public.debts_list to authenticated;
grant select on public.counterparty_balances to authenticated;
grant select on public.rates_current to authenticated;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;

  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.prokind = 'f'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

revoke all on function public.seed_demo_data() from public, anon, authenticated;
grant execute on function public.seed_demo_data() to service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema private to supabase_auth_admin;
    grant execute on function private.handle_new_user() to supabase_auth_admin;
  end if;
end $$;
