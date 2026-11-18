-- Перестановки, долги, справочники и публичные точки входа.
-- Каждая публичная функция сначала проверяет право, затем вызывает private.

create or replace function private.create_counterparty(
  p_actor uuid,
  p_name text,
  p_phone text,
  p_comment text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  if p_name is null or char_length(btrim(p_name)) < 2 then
    raise exception 'Укажите имя контрагента';
  end if;
  insert into public.counterparties (id, name, phone, comment, created_by)
  values (
    v_id,
    btrim(p_name),
    nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(btrim(coalesce(p_comment, '')), ''),
    p_actor
  );
  perform private.audit(p_actor, 'counterparty.create', 'counterparty', v_id, null, jsonb_build_object('name', btrim(p_name)));
  return v_id;
end;
$$;

create or replace function private.publish_rate(
  p_actor uuid,
  p_base uuid,
  p_quote uuid,
  p_buy numeric,
  p_sell numeric,
  p_effective timestamptz
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := gen_random_uuid();
  v_old jsonb;
begin
  if p_base = p_quote then
    raise exception 'Валюты курса должны различаться';
  end if;
  if p_buy is null or p_buy <= 0 or p_sell is null or p_sell <= 0 then
    raise exception 'Курс покупки и продажи должен быть больше нуля';
  end if;
  if p_effective is null then
    p_effective := now();
  end if;

  select jsonb_build_object('buy_rate', buy_rate, 'sell_rate', sell_rate, 'effective_at', effective_at)
    into v_old
  from public.exchange_rates
  where base_currency_id = p_base and quote_currency_id = p_quote and effective_at <= p_effective
  order by effective_at desc, created_at desc
  limit 1;

  insert into public.exchange_rates (
    id, base_currency_id, quote_currency_id, buy_rate, sell_rate, effective_at, created_by
  ) values (
    v_id, p_base, p_quote, round(p_buy, 8), round(p_sell, 8), p_effective, p_actor
  );
  perform private.audit(
    p_actor, 'rate.publish', 'exchange_rate', v_id, v_old,
    jsonb_build_object('buy_rate', round(p_buy, 8), 'sell_rate', round(p_sell, 8), 'effective_at', p_effective)
  );
  return v_id;
end;
$$;

create or replace function private.send_transfer(p_actor uuid, p_key text, p_transfer uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tr public.transfers%rowtype;
  v_existing uuid;
  v_source uuid;
  v_transit uuid;
  v_balance numeric;
  v_tx uuid;
begin
  select * into v_tr from public.transfers where id = p_transfer for update;
  if not found then
    raise exception 'Перестановка не найдена';
  end if;
  if v_tr.status in ('sent', 'received') then
    return v_tr.id;
  end if;
  if v_tr.status <> 'created' then
    raise exception 'Отправить можно только созданную перестановку';
  end if;

  v_existing := private.claim_key(p_key, p_actor, 'transfer_send', v_tr.id);
  if v_existing is not null then
    return v_existing;
  end if;

  select id into v_source
  from public.cashboxes
  where location_id = v_tr.from_location_id and currency_id = v_tr.currency_id and is_active;
  select id into v_transit from public.transit_accounts where currency_id = v_tr.currency_id;
  if v_source is null or v_transit is null then
    raise exception 'Не найдена касса отправителя или транзитный счёт';
  end if;

  perform 1 from public.transit_accounts where id = v_transit for update;
  perform 1 from public.cashboxes where id = v_source for update;
  v_balance := private.cashbox_balance(v_source);
  if v_balance < v_tr.amount then
    raise exception 'Недостаточно средств в кассе. Доступно %, требуется %', v_balance, v_tr.amount;
  end if;

  v_tx := private.open_tx('transfer_send', null, v_tr.id, null, v_tr.from_location_id, 'Отправка перестановки', p_actor, now());
  perform private.add_entry(v_tx, null, v_tr.id, null, v_source, null, v_tr.currency_id, null, 'out', v_tr.amount, 'transfer_out', p_actor, now());
  perform private.add_entry(v_tx, null, v_tr.id, null, null, v_transit, v_tr.currency_id, null, 'in', v_tr.net_amount, 'transit_in', p_actor, now());
  if v_tr.commission > 0 then
    perform private.add_entry(v_tx, null, v_tr.id, null, null, null, v_tr.currency_id, null, 'in', v_tr.commission, 'commission', p_actor, now());
  end if;

  update public.transfers
    set status = 'sent', sent_by = p_actor, sent_at = now()
    where id = v_tr.id;
  insert into public.transfer_events (transfer_id, status, actor_id, comment)
  values (v_tr.id, 'sent', p_actor, 'Деньги списаны и поставлены в путь');
  perform private.audit(p_actor, 'transfer.send', 'transfer', v_tr.id, jsonb_build_object('status', 'created'), jsonb_build_object('status', 'sent'));
  return v_tr.id;
end;
$$;

create or replace function private.create_transfer(
  p_actor uuid,
  p_key text,
  p_from uuid,
  p_to uuid,
  p_currency uuid,
  p_amount numeric,
  p_commission numeric,
  p_comment text,
  p_dispatch boolean,
  p_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := gen_random_uuid();
  v_existing uuid;
  v_amount numeric(20, 8);
  v_commission numeric(20, 8);
  v_number text;
begin
  if p_from = p_to then
    raise exception 'Точки отправления и получения должны различаться';
  end if;
  if not exists (select 1 from public.locations where id = p_from and is_active)
     or not exists (select 1 from public.locations where id = p_to and is_active) then
    raise exception 'Точка не найдена или отключена';
  end if;
  if not exists (select 1 from public.currencies where id = p_currency and is_active) then
    raise exception 'Валюта отключена';
  end if;

  v_amount := round(p_amount, 8);
  v_commission := round(coalesce(p_commission, 0), 8);
  if v_amount <= 0 or v_commission < 0 or v_commission >= v_amount then
    raise exception 'Сумма должна быть больше нуля, а комиссия меньше суммы';
  end if;

  v_existing := private.claim_key(p_key, p_actor, 'transfer', v_id);
  if v_existing is not null then
    return v_existing;
  end if;

  v_number := private.next_number('public.transfer_number_seq'::regclass, 'TR-');
  insert into public.transfers (
    id, transfer_number, from_location_id, to_location_id, currency_id,
    amount, commission, net_amount, status, comment, created_by, created_at
  ) values (
    v_id, v_number, p_from, p_to, p_currency,
    v_amount, v_commission, v_amount - v_commission, 'created',
    nullif(btrim(coalesce(p_comment, '')), ''), p_actor, coalesce(p_at, now())
  );
  insert into public.transfer_events (transfer_id, status, actor_id, comment, created_at)
  values (v_id, 'created', p_actor, 'Перестановка создана', coalesce(p_at, now()));
  perform private.audit(p_actor, 'transfer.create', 'transfer', v_id, null, jsonb_build_object('number', v_number, 'amount', v_amount, 'commission', v_commission));

  if p_dispatch then
    perform private.send_transfer(p_actor, p_key || ':send', v_id);
  end if;
  return v_id;
end;
$$;

create or replace function private.receive_transfer(p_actor uuid, p_key text, p_transfer uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tr public.transfers%rowtype;
  v_existing uuid;
  v_dest uuid;
  v_transit uuid;
  v_balance numeric;
  v_tx uuid;
begin
  select * into v_tr from public.transfers where id = p_transfer for update;
  if not found then
    raise exception 'Перестановка не найдена';
  end if;
  if v_tr.status = 'received' then
    return v_tr.id;
  end if;
  if v_tr.status <> 'sent' then
    raise exception 'Подтвердить можно только отправленную перестановку';
  end if;

  v_existing := private.claim_key(p_key, p_actor, 'transfer_receive', v_tr.id);
  if v_existing is not null then
    return v_existing;
  end if;

  select id into v_dest
  from public.cashboxes
  where location_id = v_tr.to_location_id and currency_id = v_tr.currency_id and is_active;
  select id into v_transit from public.transit_accounts where currency_id = v_tr.currency_id;
  if v_dest is null or v_transit is null then
    raise exception 'Не найдена касса получателя или транзитный счёт';
  end if;

  perform 1 from public.transit_accounts where id = v_transit for update;
  perform 1 from public.cashboxes where id = v_dest for update;
  v_balance := private.transit_balance(v_transit);
  if v_balance < v_tr.net_amount then
    raise exception 'На транзитном счёте недостаточно средств';
  end if;

  v_tx := private.open_tx('transfer_receive', null, v_tr.id, null, v_tr.to_location_id, 'Получение перестановки', p_actor, now());
  perform private.add_entry(v_tx, null, v_tr.id, null, null, v_transit, v_tr.currency_id, null, 'out', v_tr.net_amount, 'transit_out', p_actor, now());
  perform private.add_entry(v_tx, null, v_tr.id, null, v_dest, null, v_tr.currency_id, null, 'in', v_tr.net_amount, 'transfer_in', p_actor, now());

  update public.transfers
    set status = 'received', received_by = p_actor, received_at = now()
    where id = v_tr.id;
  insert into public.transfer_events (transfer_id, status, actor_id, comment)
  values (v_tr.id, 'received', p_actor, 'Получение подтверждено');
  perform private.audit(p_actor, 'transfer.receive', 'transfer', v_tr.id, jsonb_build_object('status', 'sent'), jsonb_build_object('status', 'received'));
  return v_tr.id;
end;
$$;

create or replace function private.cancel_transfer(
  p_actor uuid,
  p_key text,
  p_transfer uuid,
  p_reason text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tr public.transfers%rowtype;
  v_existing uuid;
  v_source uuid;
  v_transit uuid;
  v_balance numeric;
  v_tx uuid;
  v_entry record;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 5 then
    raise exception 'Укажите причину отмены';
  end if;

  select * into v_tr from public.transfers where id = p_transfer for update;
  if not found then
    raise exception 'Перестановка не найдена';
  end if;
  if v_tr.status = 'cancelled' then
    return v_tr.id;
  end if;
  if v_tr.status = 'received' then
    raise exception 'Полученную перестановку нельзя отменить. Создайте обратное перемещение';
  end if;

  v_existing := private.claim_key(p_key, p_actor, 'transfer_cancel', v_tr.id);
  if v_existing is not null then
    return v_existing;
  end if;

  if v_tr.status = 'sent' then
    select id into v_source
    from public.cashboxes
    where location_id = v_tr.from_location_id and currency_id = v_tr.currency_id;
    select id into v_transit from public.transit_accounts where currency_id = v_tr.currency_id;
    perform 1 from public.transit_accounts where id = v_transit for update;
    perform 1 from public.cashboxes where id = v_source for update;
    v_balance := private.transit_balance(v_transit);
    if v_balance < v_tr.net_amount then
      raise exception 'Транзитный остаток уже использован, отмена невозможна';
    end if;

    v_tx := private.open_tx('transfer_cancel', null, v_tr.id, null, v_tr.from_location_id, 'Отмена перестановки', p_actor, now());
    for v_entry in
      select * from public.financial_entries
      where transfer_id = v_tr.id and entry_type <> 'reversal'
    loop
      perform private.add_entry(
        v_tx, null, v_tr.id, null, v_entry.cashbox_id, v_entry.transit_account_id,
        v_entry.currency_id, null,
        case when v_entry.direction = 'in' then 'out' else 'in' end,
        v_entry.amount, 'reversal', p_actor, now()
      );
    end loop;
  end if;

  update public.transfers
    set status = 'cancelled', cancel_reason = btrim(p_reason), cancelled_by = p_actor, cancelled_at = now()
    where id = v_tr.id;
  insert into public.transfer_events (transfer_id, status, actor_id, comment)
  values (v_tr.id, 'cancelled', p_actor, btrim(p_reason));
  perform private.audit(p_actor, 'transfer.cancel', 'transfer', v_tr.id, jsonb_build_object('status', v_tr.status), jsonb_build_object('reason', btrim(p_reason)));
  return v_tr.id;
end;
$$;

create or replace function private.create_debt(
  p_actor uuid,
  p_key text,
  p_counterparty uuid,
  p_currency uuid,
  p_location uuid,
  p_direction text,
  p_amount numeric,
  p_comment text,
  p_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := gen_random_uuid();
  v_existing uuid;
  v_amount numeric(20, 8);
  v_number text;
begin
  if p_direction not in ('receivable', 'payable') then
    raise exception 'Укажите направление долга';
  end if;
  if not exists (select 1 from public.counterparties where id = p_counterparty and status = 'active') then
    raise exception 'Контрагент не найден или находится в архиве';
  end if;
  v_amount := round(p_amount, 8);
  if v_amount <= 0 then
    raise exception 'Сумма долга должна быть больше нуля';
  end if;

  v_existing := private.claim_key(p_key, p_actor, 'debt', v_id);
  if v_existing is not null then
    return v_existing;
  end if;

  v_number := private.next_number('public.debt_number_seq'::regclass, 'DB-');
  insert into public.debts (
    id, debt_number, counterparty_id, currency_id, location_id, direction,
    amount, remaining_amount, status, comment, created_by, created_at
  ) values (
    v_id, v_number, p_counterparty, p_currency, p_location, p_direction,
    v_amount, v_amount, 'open', nullif(btrim(coalesce(p_comment, '')), ''), p_actor, coalesce(p_at, now())
  );
  perform private.audit(p_actor, 'debt.create', 'debt', v_id, null, jsonb_build_object('number', v_number, 'direction', p_direction, 'amount', v_amount));
  return v_id;
end;
$$;

create or replace function private.repay_debt(
  p_actor uuid,
  p_key text,
  p_debt uuid,
  p_cashbox uuid,
  p_amount numeric,
  p_comment text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_debt public.debts%rowtype;
  v_box public.cashboxes%rowtype;
  v_existing uuid;
  v_amount numeric(20, 8);
  v_left numeric(20, 8);
  v_balance numeric;
  v_tx uuid;
  v_payment uuid := gen_random_uuid();
begin
  select * into v_debt from public.debts where id = p_debt for update;
  if not found then
    raise exception 'Долг не найден';
  end if;
  if v_debt.status = 'cancelled' then
    raise exception 'Долг отменён';
  end if;

  v_existing := private.claim_key(p_key, p_actor, 'debt_payment', v_payment);
  if v_existing is not null then
    return v_existing;
  end if;
  if v_debt.status = 'settled' then
    raise exception 'Долг уже погашен';
  end if;

  select * into v_box from public.cashboxes where id = p_cashbox;
  if not found or not v_box.is_active then
    raise exception 'Касса не найдена или отключена';
  end if;
  if v_box.currency_id <> v_debt.currency_id or v_box.location_id <> v_debt.location_id then
    raise exception 'Погашение проводится через кассу той же точки и валюты';
  end if;

  v_amount := round(p_amount, 8);
  if v_amount <= 0 then
    raise exception 'Сумма погашения должна быть больше нуля';
  end if;
  if v_amount > v_debt.remaining_amount then
    raise exception 'Сумма погашения больше остатка долга';
  end if;

  perform 1 from public.cashboxes where id = p_cashbox for update;
  if v_debt.direction = 'payable' then
    v_balance := private.cashbox_balance(p_cashbox);
    if v_balance < v_amount then
      raise exception 'Недостаточно средств в кассе. Доступно %, требуется %', v_balance, v_amount;
    end if;
  end if;

  v_tx := private.open_tx('debt_payment', null, null, v_debt.id, v_debt.location_id, 'Погашение долга', p_actor, now());
  perform private.add_entry(
    v_tx, null, null, v_debt.id, p_cashbox, null, v_debt.currency_id, v_debt.counterparty_id,
    case when v_debt.direction = 'receivable' then 'in' else 'out' end,
    v_amount,
    case when v_debt.direction = 'receivable' then 'debt_in' else 'debt_out' end,
    p_actor, now()
  );

  insert into public.debt_payments (id, debt_id, amount, cashbox_id, comment, created_by, ledger_transaction_id)
  values (v_payment, v_debt.id, v_amount, p_cashbox, nullif(btrim(coalesce(p_comment, '')), ''), p_actor, v_tx);

  v_left := v_debt.remaining_amount - v_amount;
  update public.debts
    set remaining_amount = v_left,
        status = case when v_left = 0 then 'settled' else 'partial' end
    where id = v_debt.id;

  perform private.audit(p_actor, 'debt.repay', 'debt', v_debt.id, jsonb_build_object('remaining', v_debt.remaining_amount), jsonb_build_object('payment', v_amount, 'remaining', v_left));
  return v_payment;
end;
$$;

-- ---------------------------------------------------------------------------
-- Публичный API
-- ---------------------------------------------------------------------------

create or replace function public.save_exchange_draft(
  p_idempotency_key text,
  p_location_id uuid,
  p_cashbox_in_id uuid,
  p_cashbox_out_id uuid,
  p_counterparty_id uuid,
  p_amount_in numeric,
  p_exchange_rate numeric,
  p_commission numeric,
  p_commission_currency_id uuid,
  p_comment text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
begin
  v_actor := private.assert_permission('operations.create', p_location_id);
  return private.post_exchange(
    v_actor, p_idempotency_key, p_location_id, p_cashbox_in_id, p_cashbox_out_id,
    p_counterparty_id, p_amount_in, p_exchange_rate, p_commission, p_commission_currency_id,
    p_comment, now(), null, true
  );
end;
$$;

create or replace function public.post_exchange(
  p_idempotency_key text,
  p_location_id uuid,
  p_cashbox_in_id uuid,
  p_cashbox_out_id uuid,
  p_counterparty_id uuid,
  p_amount_in numeric,
  p_exchange_rate numeric,
  p_commission numeric,
  p_commission_currency_id uuid,
  p_comment text,
  p_draft_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
begin
  v_actor := private.assert_permission('operations.post', p_location_id);
  return private.post_exchange(
    v_actor, p_idempotency_key, p_location_id, p_cashbox_in_id, p_cashbox_out_id,
    p_counterparty_id, p_amount_in, p_exchange_rate, p_commission, p_commission_currency_id,
    p_comment, now(), p_draft_id, false
  );
end;
$$;

create or replace function public.cancel_operation(
  p_operation_id uuid,
  p_reason text,
  p_idempotency_key text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_location uuid;
begin
  select location_id into v_location from public.operations where id = p_operation_id;
  v_actor := private.assert_permission('operations.cancel', v_location);
  return private.cancel_operation(v_actor, p_idempotency_key, p_operation_id, p_reason);
end;
$$;

create or replace function public.post_cash_movement(
  p_idempotency_key text,
  p_cashbox_id uuid,
  p_direction text,
  p_amount numeric,
  p_category text,
  p_comment text,
  p_counterparty_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_location uuid;
  v_action text;
begin
  select location_id into v_location from public.cashboxes where id = p_cashbox_id;
  v_action := case when p_direction = 'adjust' then 'cashboxes.adjust' else 'cashboxes.move' end;
  v_actor := private.assert_permission(v_action, v_location);
  return private.post_cash_movement(
    v_actor, p_idempotency_key, p_cashbox_id, p_direction, p_amount, p_category, p_comment, p_counterparty_id, now()
  );
end;
$$;

create or replace function public.create_counterparty(
  p_name text,
  p_phone text,
  p_comment text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := private.assert_permission('counterparties.manage', null);
begin
  return private.create_counterparty(v_actor, p_name, p_phone, p_comment);
end;
$$;

create or replace function public.update_counterparty(
  p_id uuid,
  p_name text,
  p_phone text,
  p_comment text,
  p_status text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := private.assert_permission('counterparties.manage', null);
  v_old jsonb;
begin
  if p_status not in ('active', 'archived') then
    raise exception 'Некорректный статус контрагента';
  end if;
  select jsonb_build_object('name', name, 'phone', phone, 'status', status) into v_old
  from public.counterparties where id = p_id;
  if v_old is null then
    raise exception 'Контрагент не найден';
  end if;
  update public.counterparties
    set name = btrim(p_name),
        phone = nullif(btrim(coalesce(p_phone, '')), ''),
        comment = nullif(btrim(coalesce(p_comment, '')), ''),
        status = p_status
    where id = p_id;
  perform private.audit(v_actor, 'counterparty.update', 'counterparty', p_id, v_old, jsonb_build_object('name', btrim(p_name), 'status', p_status));
end;
$$;

create or replace function public.create_transfer(
  p_idempotency_key text,
  p_from_location_id uuid,
  p_to_location_id uuid,
  p_currency_id uuid,
  p_amount numeric,
  p_commission numeric,
  p_comment text,
  p_dispatch boolean
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := private.assert_permission('transfers.create', p_from_location_id);
begin
  if p_dispatch and not public.has_action('transfers.send') then
    raise exception 'Недостаточно прав: transfers.send';
  end if;
  return private.create_transfer(
    v_actor, p_idempotency_key, p_from_location_id, p_to_location_id, p_currency_id,
    p_amount, p_commission, p_comment, p_dispatch, now()
  );
end;
$$;

create or replace function public.send_transfer(p_transfer_id uuid, p_idempotency_key text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from uuid;
  v_actor uuid;
begin
  select from_location_id into v_from from public.transfers where id = p_transfer_id;
  v_actor := private.assert_permission('transfers.send', v_from);
  return private.send_transfer(v_actor, p_idempotency_key, p_transfer_id);
end;
$$;

create or replace function public.receive_transfer(p_transfer_id uuid, p_idempotency_key text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_to uuid;
  v_actor uuid;
begin
  select to_location_id into v_to from public.transfers where id = p_transfer_id;
  v_actor := private.assert_permission('transfers.receive', v_to);
  return private.receive_transfer(v_actor, p_idempotency_key, p_transfer_id);
end;
$$;

create or replace function public.cancel_transfer(
  p_transfer_id uuid,
  p_reason text,
  p_idempotency_key text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from uuid;
  v_actor uuid;
begin
  select from_location_id into v_from from public.transfers where id = p_transfer_id;
  v_actor := private.assert_permission('transfers.cancel', v_from);
  return private.cancel_transfer(v_actor, p_idempotency_key, p_transfer_id, p_reason);
end;
$$;

create or replace function public.create_debt(
  p_idempotency_key text,
  p_counterparty_id uuid,
  p_currency_id uuid,
  p_location_id uuid,
  p_direction text,
  p_amount numeric,
  p_comment text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := private.assert_permission('debts.manage', p_location_id);
begin
  return private.create_debt(
    v_actor, p_idempotency_key, p_counterparty_id, p_currency_id, p_location_id,
    p_direction, p_amount, p_comment, now()
  );
end;
$$;

create or replace function public.repay_debt(
  p_idempotency_key text,
  p_debt_id uuid,
  p_cashbox_id uuid,
  p_amount numeric,
  p_comment text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_location uuid;
  v_actor uuid;
begin
  select location_id into v_location from public.debts where id = p_debt_id;
  v_actor := private.assert_permission('debts.manage', v_location);
  return private.repay_debt(v_actor, p_idempotency_key, p_debt_id, p_cashbox_id, p_amount, p_comment);
end;
$$;

create or replace function public.publish_rate(
  p_base_currency_id uuid,
  p_quote_currency_id uuid,
  p_buy_rate numeric,
  p_sell_rate numeric,
  p_effective_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := private.assert_permission('rates.manage', null);
begin
  return private.publish_rate(v_actor, p_base_currency_id, p_quote_currency_id, p_buy_rate, p_sell_rate, p_effective_at);
end;
$$;

create or replace function public.create_currency(
  p_code text,
  p_name text,
  p_symbol text,
  p_precision integer
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := private.assert_permission('rates.manage', null);
  v_id uuid := gen_random_uuid();
  v_code text := upper(btrim(p_code));
  v_location record;
begin
  if v_code !~ '^[A-Z0-9]{3,8}$' then
    raise exception 'Код валюты: 3–8 латинских букв или цифр';
  end if;
  if p_precision is null or p_precision < 0 or p_precision > 8 then
    raise exception 'Точность валюты от 0 до 8';
  end if;
  insert into public.currencies (id, code, name, symbol, precision)
  values (v_id, v_code, btrim(p_name), btrim(p_symbol), p_precision);
  insert into public.transit_accounts (currency_id, name)
  values (v_id, 'Транзит ' || v_code);
  for v_location in select id, name from public.locations where is_active loop
    insert into public.cashboxes (location_id, currency_id, name)
    values (v_location.id, v_id, 'Касса ' || v_code || ' · ' || v_location.name);
  end loop;
  perform private.audit(v_actor, 'currency.create', 'currency', v_id, null, jsonb_build_object('code', v_code));
  return v_id;
end;
$$;

create or replace function public.set_currency_active(p_currency_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := private.assert_permission('rates.manage', null);
begin
  if p_currency_id = (select id from public.currencies where code = 'RUB') and not p_active then
    raise exception 'Рубль нельзя отключить';
  end if;
  update public.currencies set is_active = p_active where id = p_currency_id;
  perform private.audit(v_actor, 'currency.active', 'currency', p_currency_id, null, jsonb_build_object('is_active', p_active));
end;
$$;

create or replace function public.create_location(p_name text, p_address text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := private.assert_permission('locations.manage', null);
  v_id uuid := gen_random_uuid();
  v_currency record;
begin
  insert into public.locations (id, name, address) values (v_id, btrim(p_name), nullif(btrim(coalesce(p_address, '')), ''));
  for v_currency in select id, code from public.currencies where is_active loop
    insert into public.cashboxes (location_id, currency_id, name)
    values (v_id, v_currency.id, 'Касса ' || v_currency.code || ' · ' || btrim(p_name));
  end loop;
  perform private.audit(v_actor, 'location.create', 'location', v_id, null, jsonb_build_object('name', btrim(p_name)));
  return v_id;
end;
$$;

create or replace function public.update_location(
  p_location_id uuid,
  p_name text,
  p_address text,
  p_active boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := private.assert_permission('locations.manage', null);
begin
  update public.locations
    set name = btrim(p_name), address = nullif(btrim(coalesce(p_address, '')), ''), is_active = p_active
    where id = p_location_id;
  perform private.audit(v_actor, 'location.update', 'location', p_location_id, null, jsonb_build_object('name', btrim(p_name), 'is_active', p_active));
end;
$$;

create or replace function public.update_cashbox(p_cashbox_id uuid, p_name text, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_location uuid;
  v_balance numeric;
begin
  select location_id into v_location from public.cashboxes where id = p_cashbox_id;
  v_actor := private.assert_permission('locations.manage', v_location);
  if not p_active then
    v_balance := private.cashbox_balance(p_cashbox_id);
    if v_balance <> 0 then
      raise exception 'Нельзя отключить кассу с ненулевым остатком';
    end if;
  end if;
  update public.cashboxes set name = btrim(p_name), is_active = p_active where id = p_cashbox_id;
  perform private.audit(v_actor, 'cashbox.update', 'cashbox', p_cashbox_id, null, jsonb_build_object('name', btrim(p_name), 'is_active', p_active));
end;
$$;

create or replace function public.update_setting(p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := private.assert_permission('settings.manage', null);
  v_old jsonb;
begin
  if p_key not in ('company_name', 'legal_name') then
    raise exception 'Эту настройку нельзя изменить из интерфейса';
  end if;
  if jsonb_typeof(p_value) <> 'string' or char_length(p_value #>> '{}') < 2 then
    raise exception 'Укажите значение настройки';
  end if;
  select value into v_old from public.app_settings where key = p_key;
  insert into public.app_settings (key, value, updated_by, updated_at)
  values (p_key, p_value, v_actor, now())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  perform private.audit(v_actor, 'settings.update', 'setting', null, jsonb_build_object(p_key, v_old), jsonb_build_object(p_key, p_value));
end;
$$;

create or replace function public.update_own_profile(p_full_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := private.assert_permission('dashboard.view', null);
begin
  if p_full_name is null or char_length(btrim(p_full_name)) < 2 then
    raise exception 'Укажите имя';
  end if;
  update public.profiles set full_name = btrim(p_full_name) where id = v_actor;
  perform private.audit(v_actor, 'profile.update', 'profile', v_actor, null, jsonb_build_object('full_name', btrim(p_full_name)));
end;
$$;

create or replace function public.update_employee(
  p_user_id uuid,
  p_full_name text,
  p_role text,
  p_is_active boolean,
  p_location_ids uuid[]
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := private.assert_permission('employees.manage', null);
  v_old jsonb;
begin
  if p_role not in ('ADMIN', 'ACCOUNTANT', 'MANAGER', 'EMPLOYEE') then
    raise exception 'Неизвестная роль';
  end if;
  if p_user_id = v_actor and (p_role <> 'ADMIN' or not p_is_active) then
    raise exception 'Нельзя снять с себя роль администратора или отключить свою учётную запись';
  end if;
  select jsonb_build_object('full_name', full_name, 'role', role, 'is_active', is_active)
    into v_old from public.profiles where id = p_user_id;
  if v_old is null then
    raise exception 'Сотрудник не найден';
  end if;
  update public.profiles
    set full_name = btrim(p_full_name), role = p_role, is_active = p_is_active
    where id = p_user_id;
  delete from public.employee_locations where user_id = p_user_id;
  if p_location_ids is not null then
    insert into public.employee_locations (user_id, location_id)
    select p_user_id, x from unnest(p_location_ids) as x
    where exists (select 1 from public.locations l where l.id = x);
  end if;
  perform private.audit(v_actor, 'employee.update', 'profile', p_user_id, v_old, jsonb_build_object('full_name', btrim(p_full_name), 'role', p_role, 'is_active', p_is_active, 'locations', p_location_ids));
end;
$$;

create or replace function public.set_permission_overrides(p_user_id uuid, p_overrides jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := private.assert_permission('employees.manage', null);
  v_item jsonb;
  v_action text;
  v_old jsonb;
begin
  if p_user_id = v_actor then
    raise exception 'Нельзя менять собственные дополнительные права';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('action', action, 'allowed', allowed)), '[]'::jsonb)
    into v_old from public.user_permission_overrides where user_id = p_user_id;
  delete from public.user_permission_overrides where user_id = p_user_id;
  for v_item in select value from jsonb_array_elements(coalesce(p_overrides, '[]'::jsonb)) loop
    v_action := v_item ->> 'action';
    if not exists (select 1 from public.role_permissions where action = v_action) then
      raise exception 'Неизвестное право: %', v_action;
    end if;
    insert into public.user_permission_overrides (user_id, action, allowed)
    values (p_user_id, v_action, (v_item ->> 'allowed')::boolean);
  end loop;
  perform private.audit(v_actor, 'employee.permissions', 'profile', p_user_id, v_old, p_overrides);
end;
$$;
