-- Отчёты, представления и демонстрационное наполнение.
-- Суммы в JSON отдаются текстом, чтобы клиент не превращал их в float.

create or replace function private.period_bounds(p_period text, p_from date, p_to date)
returns table(start_at timestamptz, end_at timestamptz, from_date date, to_date date)
language plpgsql
stable
as $$
declare
  v_today date := (now() at time zone 'Europe/Moscow')::date;
  v_from date;
  v_to date;
begin
  case p_period
    when 'today' then v_from := v_today; v_to := v_today;
    when 'yesterday' then v_from := v_today - 1; v_to := v_today - 1;
    when 'week' then v_from := v_today - 6; v_to := v_today;
    when 'month' then v_from := v_today - 29; v_to := v_today;
    when 'custom' then
      if p_from is null or p_to is null then
        raise exception 'Укажите начало и конец периода';
      end if;
      v_from := p_from;
      v_to := p_to;
    else
      raise exception 'Неизвестный период';
  end case;
  if v_to < v_from then
    raise exception 'Конец периода раньше начала';
  end if;
  if v_to - v_from > 366 then
    raise exception 'Период не длиннее 366 дней';
  end if;
  start_at := v_from::timestamp at time zone 'Europe/Moscow';
  end_at := (v_to + 1)::timestamp at time zone 'Europe/Moscow';
  from_date := v_from;
  to_date := v_to;
  return next;
end;
$$;

create or replace function public.dashboard_snapshot(
  p_period text,
  p_from date,
  p_to date,
  p_location uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := private.assert_permission('dashboard.view', p_location);
  v_bounds record;
  v_today date := (now() at time zone 'Europe/Moscow')::date;
  v_result jsonb;
begin
  select * into v_bounds from private.period_bounds(p_period, p_from, p_to);

  with accessible as (
    select c.id, c.location_id, c.name, l.name as location_name, cur.code, cur.symbol,
           private.cashbox_balance(c.id) as balance
    from public.cashboxes c
    join public.locations l on l.id = c.location_id
    join public.currencies cur on cur.id = c.currency_id
    where c.is_active and public.can_access_location(c.location_id)
  ),
  scoped_ops as (
    select o.*
    from public.operations o
    where coalesce(o.posted_at, o.created_at) >= v_bounds.start_at
      and coalesce(o.posted_at, o.created_at) < v_bounds.end_at
      and public.can_access_location(o.location_id)
      and (p_location is null or o.location_id = p_location)
  )
  select jsonb_build_object(
    'from', v_bounds.from_date,
    'to', v_bounds.to_date,
    'demo', coalesce((select value from public.app_settings where key = 'demo_seeded'), 'false'::jsonb),
    'balances', coalesce((
      select jsonb_agg(jsonb_build_object(
        'location_id', location_id, 'location_name', location_name,
        'cashbox_id', id, 'cashbox_name', name, 'code', code, 'symbol', symbol, 'balance', balance::text
      ) order by location_name, code)
      from accessible
      where p_location is null or location_id = p_location
    ), '[]'::jsonb),
    'company_balances', coalesce((
      select jsonb_agg(jsonb_build_object('code', code, 'symbol', symbol, 'balance', balance::text) order by code)
      from (
        select code, symbol, sum(balance) as balance
        from accessible
        group by code, symbol
      ) s
    ), '[]'::jsonb),
    'exchange_volume_rub', coalesce((
      select sum(volume_rub) from scoped_ops where type = 'exchange' and status = 'posted'
    ), 0)::text,
    'operation_count', (
      select count(*) from scoped_ops where status = 'posted'
    ),
    'debts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', code, 'receivable', receivable::text, 'payable', payable::text
      ) order by code)
      from (
        select cur.code,
          sum(case when d.direction = 'receivable' then d.remaining_amount else 0 end) as receivable,
          sum(case when d.direction = 'payable' then d.remaining_amount else 0 end) as payable
        from public.debts d
        join public.currencies cur on cur.id = d.currency_id
        where d.status in ('open', 'partial')
          and public.can_access_location(d.location_id)
          and (p_location is null or d.location_id = p_location)
        group by cur.code
      ) s
    ), '[]'::jsonb),
    'commissions', coalesce((
      select jsonb_agg(jsonb_build_object('code', code, 'amount', amount::text) order by code)
      from (
        select cur.code,
          sum(case when f.direction = 'in' then f.amount else -f.amount end) as amount
        from public.financial_entries f
        join public.currencies cur on cur.id = f.currency_id
        left join public.operations o on o.id = f.operation_id
        left join public.transfers t on t.id = f.transfer_id
        where f.cashbox_id is null and f.transit_account_id is null
          and f.entry_type in ('commission', 'reversal')
          and f.created_at >= v_bounds.start_at and f.created_at < v_bounds.end_at
          and (
            (o.id is not null and public.can_access_location(o.location_id) and (p_location is null or o.location_id = p_location))
            or (t.id is not null and public.can_access_location(t.from_location_id) and (p_location is null or t.from_location_id = p_location))
          )
        group by cur.code
      ) s
    ), '[]'::jsonb),
    'in_transit', coalesce((
      select jsonb_agg(jsonb_build_object('code', code, 'amount', amount::text) order by code)
      from (
        select cur.code, sum(t.net_amount) as amount
        from public.transfers t
        join public.currencies cur on cur.id = t.currency_id
        where t.status = 'sent'
          and (public.can_access_location(t.from_location_id) or public.can_access_location(t.to_location_id))
          and (p_location is null or t.from_location_id = p_location or t.to_location_id = p_location)
        group by cur.code
      ) s
    ), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'number', operation_number, 'type', type, 'status', status,
        'location', location_name, 'counterparty', counterparty_name,
        'amount_from', amount_from::text, 'code_from', code_from,
        'amount_to', amount_to::text, 'code_to', code_to,
        'created_at', created_at
      ) order by created_at desc)
      from (
        select o.id, o.operation_number, o.type, o.status, l.name as location_name,
               cp.name as counterparty_name, o.amount_from, cf.code as code_from,
               o.amount_to, ct.code as code_to, o.created_at
        from public.operations o
        join public.locations l on l.id = o.location_id
        left join public.counterparties cp on cp.id = o.counterparty_id
        left join public.currencies cf on cf.id = o.currency_from
        left join public.currencies ct on ct.id = o.currency_to
        where public.can_access_location(o.location_id)
          and (p_location is null or o.location_id = p_location)
        order by o.created_at desc
        limit 8
      ) recent_rows
    ), '[]'::jsonb),
    'week', (
      select coalesce(jsonb_agg(jsonb_build_object('day', day::text, 'volume', volume::text) order by day), '[]'::jsonb)
      from (
        select days.day, coalesce(sum(o.volume_rub), 0) as volume
        from (select (v_today - offs.n)::date as day from generate_series(0, 6) as offs(n)) days
        left join public.operations o
          on o.type = 'exchange' and o.status = 'posted'
          and (o.posted_at at time zone 'Europe/Moscow')::date = days.day
          and public.can_access_location(o.location_id)
          and (p_location is null or o.location_id = p_location)
        group by days.day
      ) w
    ),
    'month', (
      select coalesce(jsonb_agg(jsonb_build_object('day', day::text, 'volume', volume::text) order by day), '[]'::jsonb)
      from (
        select days.day, coalesce(sum(o.volume_rub), 0) as volume
        from (select (v_today - offs.n)::date as day from generate_series(0, 29) as offs(n)) days
        left join public.operations o
          on o.type = 'exchange' and o.status = 'posted'
          and (o.posted_at at time zone 'Europe/Moscow')::date = days.day
          and public.can_access_location(o.location_id)
          and (p_location is null or o.location_id = p_location)
        group by days.day
      ) m
    ),
    'by_currency', coalesce((
      select jsonb_agg(jsonb_build_object('code', code, 'amount', amount::text, 'count', count) order by amount desc)
      from (
        select cf.code, sum(o.amount_from) as amount, count(*) as count
        from scoped_ops o
        join public.currencies cf on cf.id = o.currency_from
        where o.type = 'exchange' and o.status = 'posted'
        group by cf.code
      ) s
    ), '[]'::jsonb),
    'by_location', coalesce((
      select jsonb_agg(jsonb_build_object('location', location_name, 'volume', volume::text, 'count', count) order by location_name)
      from (
        select l.name as location_name, coalesce(sum(o.volume_rub), 0) as volume, count(o.id) as count
        from public.locations l
        left join scoped_ops o on o.location_id = l.id and o.type = 'exchange' and o.status = 'posted'
        where public.can_access_location(l.id)
          and (p_location is null or l.id = p_location)
        group by l.name
      ) s
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.accounting_report(
  p_period text,
  p_from date,
  p_to date,
  p_location uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := private.assert_permission('accounting.view', p_location);
  v_bounds record;
  v_result jsonb;
begin
  select * into v_bounds from private.period_bounds(p_period, p_from, p_to);

  with commissions as (
    select cur.code,
      sum(case when f.direction = 'in' then f.amount else -f.amount end) as amount
    from public.financial_entries f
    join public.currencies cur on cur.id = f.currency_id
    left join public.operations o on o.id = f.operation_id
    left join public.transfers t on t.id = f.transfer_id
    where f.cashbox_id is null and f.transit_account_id is null
      and f.entry_type in ('commission', 'reversal')
      and f.created_at >= v_bounds.start_at and f.created_at < v_bounds.end_at
      and (
        (o.id is not null and public.can_access_location(o.location_id) and (p_location is null or o.location_id = p_location))
        or (t.id is not null and public.can_access_location(t.from_location_id) and (p_location is null or t.from_location_id = p_location))
      )
    group by cur.code
  ),
  expenses as (
    select cur.code, sum(f.amount) as amount
    from public.financial_entries f
    join public.operations o on o.id = f.operation_id
    join public.currencies cur on cur.id = f.currency_id
    where o.type = 'cash_out' and o.category = 'expense' and o.status = 'posted'
      and f.direction = 'out' and f.entry_type = 'cash_out'
      and o.posted_at >= v_bounds.start_at and o.posted_at < v_bounds.end_at
      and public.can_access_location(o.location_id)
      and (p_location is null or o.location_id = p_location)
    group by cur.code
  )
  select jsonb_build_object(
    'from', v_bounds.from_date,
    'to', v_bounds.to_date,
    'turnover_rub', coalesce((
      select sum(volume_rub) from public.operations o
      where o.type = 'exchange' and o.status = 'posted'
        and o.posted_at >= v_bounds.start_at and o.posted_at < v_bounds.end_at
        and public.can_access_location(o.location_id)
        and (p_location is null or o.location_id = p_location)
    ), 0)::text,
    'exchange_count', (
      select count(*) from public.operations o
      where o.type = 'exchange' and o.status = 'posted'
        and o.posted_at >= v_bounds.start_at and o.posted_at < v_bounds.end_at
        and public.can_access_location(o.location_id)
        and (p_location is null or o.location_id = p_location)
    ),
    'commissions', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'amount', amount::text) order by code) from commissions), '[]'::jsonb),
    'expenses', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'amount', amount::text) order by code) from expenses), '[]'::jsonb),
    'result', coalesce((
      select jsonb_agg(jsonb_build_object('code', code, 'amount', amount::text) order by code)
      from (
        select coalesce(c.code, e.code) as code, coalesce(c.amount, 0) - coalesce(e.amount, 0) as amount
        from commissions c
        full join expenses e on e.code = c.code
      ) r
    ), '[]'::jsonb),
    'cashboxes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'location', l.name, 'code', cur.code,
        'balance', private.cashbox_balance(c.id)::text,
        'inflow', coalesce(sum(case when f.direction = 'in' then f.amount end), 0)::text,
        'outflow', coalesce(sum(case when f.direction = 'out' then f.amount end), 0)::text
      ) order by l.name, cur.code)
      from public.cashboxes c
      join public.locations l on l.id = c.location_id
      join public.currencies cur on cur.id = c.currency_id
      left join public.financial_entries f
        on f.cashbox_id = c.id
        and f.created_at >= v_bounds.start_at and f.created_at < v_bounds.end_at
      where public.can_access_location(c.location_id)
        and (p_location is null or c.location_id = p_location)
      group by c.id, c.name, l.name, cur.code
    ), '[]'::jsonb),
    'locations', coalesce((
      select jsonb_agg(jsonb_build_object('location', name, 'volume', volume::text, 'count', count) order by name)
      from (
        select l.name, coalesce(sum(o.volume_rub), 0) as volume, count(o.id) as count
        from public.locations l
        left join public.operations o
          on o.location_id = l.id and o.type = 'exchange' and o.status = 'posted'
          and o.posted_at >= v_bounds.start_at and o.posted_at < v_bounds.end_at
        where public.can_access_location(l.id)
          and (p_location is null or l.id = p_location)
        group by l.name
      ) s
    ), '[]'::jsonb),
    'currencies', coalesce((
      select jsonb_agg(jsonb_build_object('code', code, 'incoming', incoming::text, 'count', count) order by code)
      from (
        select cur.code, sum(o.amount_from) as incoming, count(*) as count
        from public.operations o
        join public.currencies cur on cur.id = o.currency_from
        where o.type = 'exchange' and o.status = 'posted'
          and o.posted_at >= v_bounds.start_at and o.posted_at < v_bounds.end_at
          and public.can_access_location(o.location_id)
          and (p_location is null or o.location_id = p_location)
        group by cur.code
      ) s
    ), '[]'::jsonb),
    'movements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'at', created_at, 'type', entry_type, 'direction', direction,
        'amount', amount::text, 'code', code, 'cashbox', cashbox_name,
        'location', location_name, 'description', description, 'actor', actor
      ) order by created_at desc)
      from (
        select f.id, f.created_at, f.entry_type, f.direction, f.amount, cur.code,
               c.name as cashbox_name, l.name as location_name, tx.description, p.full_name as actor
        from public.financial_entries f
        join public.currencies cur on cur.id = f.currency_id
        left join public.cashboxes c on c.id = f.cashbox_id
        left join public.locations l on l.id = c.location_id
        left join public.ledger_transactions tx on tx.id = f.transaction_id
        left join public.profiles p on p.id = f.created_by
        where f.created_at >= v_bounds.start_at and f.created_at < v_bounds.end_at
          and (
            (c.id is not null and public.can_access_location(c.location_id) and (p_location is null or c.location_id = p_location))
            or (c.id is null and p_location is null and public.has_action('accounting.view'))
          )
        order by f.created_at desc
        limit 300
      ) rows
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.cashbox_statement(
  p_cashbox_id uuid,
  p_from date,
  p_to date
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_location uuid;
  v_actor uuid;
  v_bounds record;
  v_opening numeric;
  v_result jsonb;
begin
  select location_id into v_location from public.cashboxes where id = p_cashbox_id;
  if v_location is null then
    raise exception 'Касса не найдена';
  end if;
  v_actor := private.assert_permission('cashboxes.view', v_location);
  select * into v_bounds from private.period_bounds('custom', coalesce(p_from, (now() at time zone 'Europe/Moscow')::date - 30), coalesce(p_to, (now() at time zone 'Europe/Moscow')::date));

  select coalesce(sum(case when direction = 'in' then amount else -amount end), 0)
    into v_opening
  from public.financial_entries
  where cashbox_id = p_cashbox_id and created_at < v_bounds.start_at;

  select jsonb_build_object(
    'opening', v_opening::text,
    'closing', (
      v_opening + coalesce((
        select sum(case when direction = 'in' then amount else -amount end)
        from public.financial_entries
        where cashbox_id = p_cashbox_id
          and created_at >= v_bounds.start_at and created_at < v_bounds.end_at
      ), 0)
    )::text,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'at', created_at, 'direction', direction, 'amount', amount::text,
        'type', entry_type, 'balance_after', balance_after::text,
        'description', description, 'actor', actor, 'operation_id', operation_id, 'transfer_id', transfer_id
      ) order by created_at, id)
      from (
        select f.id, f.created_at, f.direction, f.amount, f.entry_type, f.operation_id, f.transfer_id,
               tx.description, p.full_name as actor,
               v_opening + sum(case when f.direction = 'in' then f.amount else -f.amount end)
                 over (order by f.created_at, f.id) as balance_after
        from public.financial_entries f
        left join public.ledger_transactions tx on tx.id = f.transaction_id
        left join public.profiles p on p.id = f.created_by
        where f.cashbox_id = p_cashbox_id
          and f.created_at >= v_bounds.start_at and f.created_at < v_bounds.end_at
        order by f.created_at, f.id
        limit 1000
      ) lines
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

create or replace view public.operations_list
with (security_invoker = true) as
select
  o.id, o.operation_number, o.type, o.status, o.location_id, l.name as location_name,
  o.counterparty_id, cp.name as counterparty_name,
  o.amount_from, cf.code as code_from, o.amount_to, ct.code as code_to,
  o.exchange_rate, o.commission, o.commission_currency_id, cc.code as commission_code, o.volume_rub,
  o.category, o.comment, o.cancel_reason, o.created_at, o.posted_at,
  o.created_by, author.full_name as created_by_name,
  o.cashbox_in_id, o.cashbox_out_id
from public.operations o
join public.locations l on l.id = o.location_id
left join public.counterparties cp on cp.id = o.counterparty_id
left join public.currencies cf on cf.id = o.currency_from
left join public.currencies ct on ct.id = o.currency_to
left join public.currencies cc on cc.id = o.commission_currency_id
left join public.profiles author on author.id = o.created_by;

create or replace view public.cashbox_balances
with (security_invoker = true) as
select
  c.id, c.name, c.location_id, l.name as location_name, c.currency_id,
  cur.code as currency_code, cur.symbol as currency_symbol, cur.precision as currency_precision,
  c.is_active, c.created_at,
  coalesce(sum(case when f.direction = 'in' then f.amount else -f.amount end), 0) as balance
from public.cashboxes c
join public.locations l on l.id = c.location_id
join public.currencies cur on cur.id = c.currency_id
left join public.financial_entries f on f.cashbox_id = c.id
group by c.id, l.name, cur.code, cur.symbol, cur.precision;

create or replace view public.transfers_list
with (security_invoker = true) as
select
  t.id, t.transfer_number, t.from_location_id, fl.name as from_name,
  t.to_location_id, tl.name as to_name, t.currency_id, cur.code as currency_code,
  t.amount, t.commission, t.net_amount, t.status, t.comment, t.cancel_reason,
  t.created_at, t.sent_at, t.received_at, t.created_by, a.full_name as created_by_name,
  t.received_by, r.full_name as received_by_name
from public.transfers t
join public.locations fl on fl.id = t.from_location_id
join public.locations tl on tl.id = t.to_location_id
join public.currencies cur on cur.id = t.currency_id
left join public.profiles a on a.id = t.created_by
left join public.profiles r on r.id = t.received_by;

create or replace view public.debts_list
with (security_invoker = true) as
select
  d.id, d.debt_number, d.counterparty_id, cp.name as counterparty_name,
  d.currency_id, cur.code as currency_code, d.location_id, l.name as location_name,
  d.direction, d.amount, d.remaining_amount, d.status, d.comment, d.created_at,
  d.created_by, a.full_name as created_by_name
from public.debts d
join public.counterparties cp on cp.id = d.counterparty_id
join public.currencies cur on cur.id = d.currency_id
join public.locations l on l.id = d.location_id
left join public.profiles a on a.id = d.created_by;

create or replace view public.counterparty_balances
with (security_invoker = true) as
select
  d.counterparty_id, d.currency_id, cur.code as currency_code,
  sum(case when d.direction = 'receivable' then d.remaining_amount else 0 end) as receivable,
  sum(case when d.direction = 'payable' then d.remaining_amount else 0 end) as payable,
  sum(case when d.direction = 'receivable' then d.remaining_amount else -d.remaining_amount end) as signed_balance
from public.debts d
join public.currencies cur on cur.id = d.currency_id
where d.status in ('open', 'partial')
group by d.counterparty_id, d.currency_id, cur.code;

create or replace view public.rates_current
with (security_invoker = true) as
select distinct on (r.base_currency_id, r.quote_currency_id)
  r.id, r.base_currency_id, b.code as base_code, r.quote_currency_id, q.code as quote_code,
  r.buy_rate, r.sell_rate, r.effective_at, r.created_at, r.created_by, p.full_name as created_by_name
from public.exchange_rates r
join public.currencies b on b.id = r.base_currency_id
join public.currencies q on q.id = r.quote_currency_id
left join public.profiles p on p.id = r.created_by
where r.effective_at <= now()
order by r.base_currency_id, r.quote_currency_id, r.effective_at desc, r.created_at desc;

create or replace function public.assert_financial_integrity()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bad uuid;
begin
  if auth.uid() is not null and not public.has_action('accounting.view') then
    raise exception 'Недостаточно прав';
  end if;

  if exists (
    select 1 from public.operations o
    where o.type = 'exchange' and o.status = 'posted'
      and not exists (
        select 1 from public.financial_entries f
        where f.operation_id = o.id and f.entry_type = 'exchange_in'
          and f.direction = 'in' and f.amount = o.amount_from
      )
  ) then
    raise exception 'INTEGRITY: у проведённого обмена нет прихода';
  end if;

  if exists (
    select 1 from public.operations o
    where o.type = 'exchange' and o.status = 'posted'
      and not exists (
        select 1 from public.financial_entries f
        where f.operation_id = o.id and f.entry_type = 'exchange_out'
          and f.direction = 'out' and f.amount = o.amount_to
      )
  ) then
    raise exception 'INTEGRITY: у проведённого обмена нет расхода';
  end if;

  if exists (
    select 1 from (
      select f.cashbox_id, sum(case when f.direction = 'in' then f.amount else -f.amount end) as net
      from public.financial_entries f
      join public.operations o on o.id = f.operation_id
      where o.status = 'cancelled' and f.cashbox_id is not null
      group by f.operation_id, f.cashbox_id
    ) s where s.net <> 0
  ) then
    raise exception 'INTEGRITY: отмена операции не вернула кассу';
  end if;

  if exists (
    select 1 from public.transfers t
    where t.status = 'created'
      and exists (select 1 from public.financial_entries f where f.transfer_id = t.id)
  ) then
    raise exception 'INTEGRITY: у неотправленной перестановки есть проводки';
  end if;

  if exists (
    select 1 from public.transfers t
    where t.status = 'sent'
      and (
        select coalesce(sum(case when f.direction = 'out' then f.amount else -f.amount end), 0)
        from public.financial_entries f
        join public.cashboxes c on c.id = f.cashbox_id
        where f.transfer_id = t.id and c.location_id = t.from_location_id
      ) <> t.amount
  ) then
    raise exception 'INTEGRITY: отправленная сумма не сошлась с кассой';
  end if;

  if exists (
    select 1 from public.transfers t
    where t.status in ('sent', 'received')
      and (
        select coalesce(sum(case when f.direction = 'in' then f.amount else -f.amount end), 0)
        from public.financial_entries f
        where f.transfer_id = t.id and f.cashbox_id is null and f.transit_account_id is null
      ) <> t.commission
  ) then
    raise exception 'INTEGRITY: комиссия перестановки не сошлась';
  end if;

  select t.id into v_bad
  from public.transfers t
  join public.transit_accounts ta on ta.currency_id = t.currency_id
  where t.status = 'sent'
    and (
      select coalesce(sum(case when f.direction = 'in' then f.amount else -f.amount end), 0)
      from public.financial_entries f
      where f.transfer_id = t.id and f.transit_account_id = ta.id
    ) <> t.net_amount
  limit 1;
  if v_bad is not null then
    raise exception 'INTEGRITY: транзит перестановки % не равен чистой сумме', v_bad;
  end if;

  if exists (
    select 1
    from public.transit_accounts ta
    where private.transit_balance(ta.id) <> coalesce((
      select sum(t.net_amount) from public.transfers t
      where t.currency_id = ta.currency_id and t.status = 'sent'
    ), 0)
  ) then
    raise exception 'INTEGRITY: остаток транзита не равен деньгам в пути';
  end if;

  if exists (
    select 1 from public.debts d
    where d.status <> 'cancelled'
      and d.remaining_amount <> d.amount - coalesce((
        select sum(p.amount) from public.debt_payments p where p.debt_id = d.id
      ), 0)
  ) then
    raise exception 'INTEGRITY: остаток долга не равен сумме минус погашения';
  end if;

  if exists (
    select 1 from public.cashboxes c where private.cashbox_balance(c.id) < 0
  ) then
    raise exception 'INTEGRITY: обнаружен отрицательный остаток кассы';
  end if;
end;
$$;
