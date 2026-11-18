-- Права, журнал и атомарные финансовые операции VALORA.
-- Публичные функции проверяют роль и точку. Деньги двигает только схема private.

create or replace function public.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
  );
$$;

create or replace function public.has_action(p_action text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active
      and (
        p.role = 'ADMIN'
        or exists (
          select 1 from public.user_permission_overrides o
          where o.user_id = p.id and o.action = p_action and o.allowed
        )
        or (
          exists (
            select 1 from public.role_permissions rp
            where rp.role = p.role and rp.action = p_action
          )
          and not exists (
            select 1 from public.user_permission_overrides o
            where o.user_id = p.id and o.action = p_action and not o.allowed
          )
        )
      )
  );
$$;

create or replace function public.can_access_location(p_location uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active
      and (
        p.role in ('ADMIN', 'ACCOUNTANT')
        or exists (
          select 1 from public.employee_locations el
          where el.user_id = p.id and el.location_id = p_location
        )
      )
  );
$$;

create or replace function private.assert_permission(p_action text, p_location uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := auth.uid();
begin
  if v_id is null or not public.is_active_member() then
    raise exception 'Требуется авторизация';
  end if;
  if not public.has_action(p_action) then
    raise exception 'Недостаточно прав: %', p_action;
  end if;
  if p_location is not null and not public.can_access_location(p_location) then
    raise exception 'Нет доступа к выбранной точке';
  end if;
  return v_id;
end;
$$;

create or replace function private.audit(
  p_actor uuid,
  p_action text,
  p_entity text,
  p_id uuid,
  p_old jsonb,
  p_new jsonb
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.audit_logs (user_id, action, entity_type, entity_id, old_values, new_values)
  values (p_actor, p_action, p_entity, p_id, p_old, p_new);
$$;

create or replace function private.next_number(p_seq regclass, p_prefix text)
returns text
language sql
security definer
set search_path = public
as $$
  select p_prefix || lpad(nextval(p_seq)::text, 6, '0');
$$;

create or replace function private.cashbox_balance(p_cashbox_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(
    case when direction = 'in' then amount else -amount end
  ), 0)
  from public.financial_entries
  where cashbox_id = p_cashbox_id;
$$;

create or replace function private.transit_balance(p_transit_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(
    case when direction = 'in' then amount else -amount end
  ), 0)
  from public.financial_entries
  where transit_account_id = p_transit_id;
$$;

-- null result means this request owns the key. Otherwise return the previous entity.
create or replace function private.claim_key(
  p_key text,
  p_actor uuid,
  p_type text,
  p_entity uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted uuid;
  v_existing uuid;
  v_owner uuid;
begin
  if p_key is null or char_length(btrim(p_key)) < 8 or char_length(p_key) > 120 then
    raise exception 'Некорректный ключ идемпотентности';
  end if;

  v_inserted := null;
  insert into public.idempotency_keys (key, user_id, entity_type, entity_id)
  values (p_key, p_actor, p_type, p_entity)
  on conflict (key) do nothing
  returning entity_id into v_inserted;

  if v_inserted is not null then
    return null;
  end if;

  select entity_id, user_id into v_existing, v_owner
  from public.idempotency_keys
  where key = p_key;

  if v_owner is distinct from p_actor then
    raise exception 'Ключ идемпотентности уже использован другим сотрудником';
  end if;
  return v_existing;
end;
$$;

create or replace function private.open_tx(
  p_kind text,
  p_operation uuid,
  p_transfer uuid,
  p_debt uuid,
  p_location uuid,
  p_description text,
  p_actor uuid,
  p_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.ledger_transactions (
    id, kind, operation_id, transfer_id, debt_id, location_id, description, created_by, created_at
  ) values (
    v_id, p_kind, p_operation, p_transfer, p_debt, p_location, p_description, p_actor, p_at
  );
  return v_id;
end;
$$;

create or replace function private.add_entry(
  p_tx uuid,
  p_operation uuid,
  p_transfer uuid,
  p_debt uuid,
  p_cashbox uuid,
  p_transit uuid,
  p_currency uuid,
  p_counterparty uuid,
  p_direction text,
  p_amount numeric,
  p_type text,
  p_actor uuid,
  p_at timestamptz
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_amount is null or p_amount <= 0 or p_amount = 'NaN'::numeric then
    raise exception 'Сумма проводки должна быть больше нуля';
  end if;
  insert into public.financial_entries (
    transaction_id, operation_id, transfer_id, debt_id, cashbox_id, transit_account_id,
    currency_id, counterparty_id, direction, amount, entry_type, created_by, created_at
  ) values (
    p_tx, p_operation, p_transfer, p_debt, p_cashbox, p_transit,
    p_currency, p_counterparty, p_direction, p_amount, p_type, p_actor, p_at
  );
end;
$$;

create or replace function private.quote_amount(
  p_amount_in numeric,
  p_rate numeric,
  p_in_code text,
  p_out_code text,
  p_out_precision integer
) returns numeric
language plpgsql
immutable
as $$
declare
  v_raw numeric;
begin
  if p_in_code = 'RUB' and p_out_code <> 'RUB' then
    v_raw := p_amount_in / p_rate;
  else
    v_raw := p_amount_in * p_rate;
  end if;
  return round(v_raw, p_out_precision);
end;
$$;

create or replace function private.post_exchange(
  p_actor uuid,
  p_key text,
  p_location uuid,
  p_cashbox_in uuid,
  p_cashbox_out uuid,
  p_counterparty uuid,
  p_amount_in numeric,
  p_rate numeric,
  p_commission numeric,
  p_commission_currency uuid,
  p_comment text,
  p_at timestamptz,
  p_draft_id uuid,
  p_as_draft boolean
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
  v_id uuid;
  v_in_currency uuid;
  v_out_currency uuid;
  v_in_code text;
  v_out_code text;
  v_out_precision integer;
  v_in_location uuid;
  v_out_location uuid;
  v_in_active boolean;
  v_out_active boolean;
  v_cur_in_active boolean;
  v_cur_out_active boolean;
  v_amount_in numeric(20, 8);
  v_amount_out numeric(20, 8);
  v_rate numeric(20, 8);
  v_commission numeric(20, 8);
  v_balance numeric;
  v_volume numeric(20, 8);
  v_rub uuid;
  v_rub_rate numeric;
  v_tx uuid;
  v_status text;
  v_number text;
begin
  if p_at is null then
    p_at := now();
  end if;
  if p_comment is not null and char_length(p_comment) > 2000 then
    raise exception 'Комментарий слишком длинный';
  end if;

  v_amount_in := round(p_amount_in, 8);
  v_rate := round(p_rate, 8);
  v_commission := round(coalesce(p_commission, 0), 8);

  if v_amount_in is null or v_amount_in <= 0 or v_amount_in = 'NaN'::numeric then
    raise exception 'Сумма, которую отдаёт клиент, должна быть больше нуля';
  end if;
  if v_rate is null or v_rate <= 0 or v_rate = 'NaN'::numeric then
    raise exception 'Курс должен быть больше нуля';
  end if;
  if v_commission < 0 or v_commission = 'NaN'::numeric then
    raise exception 'Комиссия не может быть отрицательной';
  end if;
  if v_commission > 0 and p_commission_currency is null then
    raise exception 'Укажите валюту комиссии';
  end if;
  if p_cashbox_in = p_cashbox_out then
    raise exception 'Касса прихода и касса расхода должны различаться';
  end if;
  if not exists (
    select 1 from public.counterparties
    where id = p_counterparty and status = 'active'
  ) then
    raise exception 'Контрагент не найден или находится в архиве';
  end if;

  select c.currency_id, c.location_id, c.is_active, cur.code, cur.is_active
    into v_in_currency, v_in_location, v_in_active, v_in_code, v_cur_in_active
  from public.cashboxes c
  join public.currencies cur on cur.id = c.currency_id
  where c.id = p_cashbox_in;

  select c.currency_id, c.location_id, c.is_active, cur.code, cur.precision, cur.is_active
    into v_out_currency, v_out_location, v_out_active, v_out_code, v_out_precision, v_cur_out_active
  from public.cashboxes c
  join public.currencies cur on cur.id = c.currency_id
  where c.id = p_cashbox_out;

  if v_in_currency is null or v_out_currency is null then
    raise exception 'Касса не найдена';
  end if;
  if v_in_location <> p_location or v_out_location <> p_location then
    raise exception 'Обе кассы должны принадлежать выбранной точке';
  end if;
  if not v_in_active or not v_out_active or not v_cur_in_active or not v_cur_out_active then
    raise exception 'Касса или валюта отключена';
  end if;
  if v_in_currency = v_out_currency then
    raise exception 'Для обмена выберите разные валюты';
  end if;

  v_amount_out := private.quote_amount(v_amount_in, v_rate, v_in_code, v_out_code, v_out_precision);
  if v_amount_out <= 0 then
    raise exception 'Сумма получения получилась нулевой. Проверьте курс';
  end if;

  select id into v_rub from public.currencies where code = 'RUB';
  if v_in_currency = v_rub then
    v_volume := round(v_amount_in, 2);
  elsif v_out_currency = v_rub then
    v_volume := round(v_amount_out, 2);
  else
    select buy_rate into v_rub_rate
    from public.exchange_rates
    where base_currency_id = v_in_currency
      and quote_currency_id = v_rub
      and effective_at <= p_at
    order by effective_at desc, created_at desc
    limit 1;
    if v_rub_rate is null then
      raise exception 'Нет курса к рублю для расчёта оборота';
    end if;
    v_volume := round(v_amount_in * v_rub_rate, 2);
  end if;

  if p_draft_id is not null then
    select id, status into v_id, v_status
    from public.operations
    where id = p_draft_id
    for update;
    if v_id is null then
      raise exception 'Черновик не найден';
    end if;
    if v_status = 'posted' then
      return v_id;
    end if;
    if v_status <> 'draft' then
      raise exception 'Провести можно только черновик';
    end if;
  else
    v_id := gen_random_uuid();
  end if;

  v_existing := private.claim_key(p_key, p_actor, 'exchange', v_id);
  if v_existing is not null then
    return v_existing;
  end if;

  if p_as_draft then
    v_number := private.next_number('public.operation_number_seq'::regclass, 'EX-');
    insert into public.operations (
      id, operation_number, type, location_id, counterparty_id, status,
      cashbox_in_id, cashbox_out_id, currency_from, currency_to,
      amount_from, amount_to, exchange_rate, commission, commission_currency_id,
      volume_rub, comment, idempotency_key, created_by, created_at
    ) values (
      v_id, v_number, 'exchange', p_location, p_counterparty, 'draft',
      p_cashbox_in, p_cashbox_out, v_in_currency, v_out_currency,
      v_amount_in, v_amount_out, v_rate, v_commission, p_commission_currency,
      v_volume, nullif(btrim(coalesce(p_comment, '')), ''), p_key, p_actor, p_at
    );
    perform private.audit(p_actor, 'exchange.draft', 'operation', v_id, null, jsonb_build_object('number', v_number));
    return v_id;
  end if;

  perform 1 from public.cashboxes
  where id in (p_cashbox_in, p_cashbox_out)
  order by id
  for update;

  v_balance := private.cashbox_balance(p_cashbox_out);
  if v_balance < v_amount_out then
    raise exception 'Недостаточно средств в кассе. Доступно %, требуется %', v_balance, v_amount_out;
  end if;

  if p_draft_id is null then
    v_number := private.next_number('public.operation_number_seq'::regclass, 'EX-');
    insert into public.operations (
      id, operation_number, type, location_id, counterparty_id, status,
      cashbox_in_id, cashbox_out_id, currency_from, currency_to,
      amount_from, amount_to, exchange_rate, commission, commission_currency_id,
      volume_rub, comment, idempotency_key, created_by, posted_by, created_at, posted_at
    ) values (
      v_id, v_number, 'exchange', p_location, p_counterparty, 'posted',
      p_cashbox_in, p_cashbox_out, v_in_currency, v_out_currency,
      v_amount_in, v_amount_out, v_rate, v_commission, p_commission_currency,
      v_volume, nullif(btrim(coalesce(p_comment, '')), ''), p_key, p_actor, p_actor, p_at, p_at
    );
  else
    update public.operations set
      location_id = p_location,
      counterparty_id = p_counterparty,
      status = 'posted',
      cashbox_in_id = p_cashbox_in,
      cashbox_out_id = p_cashbox_out,
      currency_from = v_in_currency,
      currency_to = v_out_currency,
      amount_from = v_amount_in,
      amount_to = v_amount_out,
      exchange_rate = v_rate,
      commission = v_commission,
      commission_currency_id = p_commission_currency,
      volume_rub = v_volume,
      comment = nullif(btrim(coalesce(p_comment, '')), ''),
      posted_by = p_actor,
      posted_at = p_at
    where id = v_id;
  end if;

  v_tx := private.open_tx('exchange', v_id, null, null, p_location, 'Обмен валюты', p_actor, p_at);
  perform private.add_entry(v_tx, v_id, null, null, p_cashbox_in, null, v_in_currency, p_counterparty, 'in', v_amount_in, 'exchange_in', p_actor, p_at);
  perform private.add_entry(v_tx, v_id, null, null, p_cashbox_out, null, v_out_currency, p_counterparty, 'out', v_amount_out, 'exchange_out', p_actor, p_at);
  if v_commission > 0 then
    perform private.add_entry(v_tx, v_id, null, null, null, null, p_commission_currency, p_counterparty, 'in', v_commission, 'commission', p_actor, p_at);
  end if;

  perform private.audit(
    p_actor, 'exchange.post', 'operation', v_id, null,
    jsonb_build_object(
      'amount_in', v_amount_in, 'amount_out', v_amount_out,
      'rate', v_rate, 'commission', v_commission
    )
  );
  return v_id;
end;
$$;

create or replace function private.cancel_operation(
  p_actor uuid,
  p_key text,
  p_operation uuid,
  p_reason text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_op public.operations%rowtype;
  v_existing uuid;
  v_tx uuid;
  v_entry record;
  v_cashbox uuid;
  v_delta numeric;
  v_balance numeric;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 5 then
    raise exception 'Укажите причину отмены';
  end if;

  select * into v_op from public.operations where id = p_operation for update;
  if not found then
    raise exception 'Операция не найдена';
  end if;
  if v_op.status = 'cancelled' then
    return v_op.id;
  end if;

  v_existing := private.claim_key(p_key, p_actor, 'cancel_operation', v_op.id);
  if v_existing is not null then
    return v_existing;
  end if;

  if v_op.status = 'draft' then
    update public.operations
      set status = 'cancelled', cancel_reason = btrim(p_reason), cancelled_by = p_actor, cancelled_at = now()
      where id = v_op.id;
    perform private.audit(p_actor, 'operation.cancel_draft', 'operation', v_op.id, null, jsonb_build_object('reason', btrim(p_reason)));
    return v_op.id;
  end if;

  for v_cashbox, v_delta in
    select cashbox_id,
           sum(case when direction = 'in' then -amount else amount end)
    from public.financial_entries
    where operation_id = v_op.id and cashbox_id is not null
    group by cashbox_id
  loop
    perform 1 from public.cashboxes where id = v_cashbox for update;
    v_balance := private.cashbox_balance(v_cashbox);
    if v_balance + v_delta < 0 then
      raise exception 'Отмена сделает остаток кассы отрицательным. Сначала верните средства в кассу';
    end if;
  end loop;

  v_tx := private.open_tx('reversal', v_op.id, null, null, v_op.location_id, 'Отмена операции', p_actor, now());
  for v_entry in
    select * from public.financial_entries where operation_id = v_op.id and entry_type <> 'reversal'
  loop
    perform private.add_entry(
      v_tx, v_op.id, v_entry.transfer_id, v_entry.debt_id,
      v_entry.cashbox_id, v_entry.transit_account_id, v_entry.currency_id, v_entry.counterparty_id,
      case when v_entry.direction = 'in' then 'out' else 'in' end,
      v_entry.amount, 'reversal', p_actor, now()
    );
  end loop;

  update public.operations
    set status = 'cancelled', cancel_reason = btrim(p_reason), cancelled_by = p_actor, cancelled_at = now()
    where id = v_op.id;

  perform private.audit(p_actor, 'operation.cancel', 'operation', v_op.id, jsonb_build_object('status', 'posted'), jsonb_build_object('reason', btrim(p_reason)));
  return v_op.id;
end;
$$;

create or replace function private.post_cash_movement(
  p_actor uuid,
  p_key text,
  p_cashbox uuid,
  p_direction text,
  p_amount numeric,
  p_category text,
  p_comment text,
  p_counterparty uuid,
  p_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_box public.cashboxes%rowtype;
  v_precision integer;
  v_currency_active boolean;
  v_id uuid := gen_random_uuid();
  v_existing uuid;
  v_current numeric;
  v_target numeric;
  v_amount numeric;
  v_direction text;
  v_tx uuid;
  v_type text;
  v_entry_type text;
  v_number text;
begin
  if p_at is null then
    p_at := now();
  end if;
  if p_direction not in ('in', 'out', 'adjust') then
    raise exception 'Неизвестное движение кассы';
  end if;
  if p_comment is null or char_length(btrim(p_comment)) < 5 then
    raise exception 'Укажите причину движения';
  end if;

  select * into v_box from public.cashboxes where id = p_cashbox;
  if not found then
    raise exception 'Касса не найдена';
  end if;
  select precision, is_active into v_precision, v_currency_active
  from public.currencies where id = v_box.currency_id;
  if not v_box.is_active or not v_currency_active then
    raise exception 'Касса или валюта отключена';
  end if;
  if p_counterparty is not null and not exists (
    select 1 from public.counterparties where id = p_counterparty and status = 'active'
  ) then
    raise exception 'Контрагент не найден или находится в архиве';
  end if;

  v_existing := private.claim_key(p_key, p_actor, 'cash_movement', v_id);
  if v_existing is not null then
    return v_existing;
  end if;

  perform 1 from public.cashboxes where id = p_cashbox for update;
  v_current := private.cashbox_balance(p_cashbox);

  if p_direction = 'adjust' then
    v_target := round(p_amount, v_precision);
    if v_target < 0 or v_target = 'NaN'::numeric then
      raise exception 'Новый остаток не может быть отрицательным';
    end if;
    if v_target = v_current then
      raise exception 'Остаток уже совпадает с указанным';
    end if;
    v_amount := abs(v_target - v_current);
    v_direction := case when v_target > v_current then 'in' else 'out' end;
    v_type := 'adjustment';
    v_entry_type := 'adjustment';
  else
    v_amount := round(p_amount, v_precision);
    if v_amount <= 0 or v_amount = 'NaN'::numeric then
      raise exception 'Сумма должна быть больше нуля';
    end if;
    v_direction := p_direction;
    v_target := null;
    if p_direction = 'out' and v_current < v_amount then
      raise exception 'Недостаточно средств в кассе. Доступно %, требуется %', v_current, v_amount;
    end if;
    v_type := case when p_direction = 'in' then 'cash_in' else 'cash_out' end;
    v_entry_type := v_type;
  end if;

  v_number := private.next_number('public.operation_number_seq'::regclass, case when v_type = 'adjustment' then 'AD-' else 'CS-' end);
  insert into public.operations (
    id, operation_number, type, location_id, counterparty_id, status,
    cashbox_in_id, cashbox_out_id, currency_from, currency_to,
    amount_from, amount_to, category, comment, idempotency_key,
    created_by, posted_by, created_at, posted_at
  ) values (
    v_id, v_number, v_type, v_box.location_id, p_counterparty, 'posted',
    case when v_direction = 'in' or v_type = 'adjustment' then p_cashbox else null end,
    case when v_direction = 'out' and v_type <> 'adjustment' then p_cashbox else null end,
    v_box.currency_id,
    case when v_type = 'adjustment' then v_box.currency_id else null end,
    v_amount, v_target, coalesce(p_category, v_type), btrim(p_comment), p_key,
    p_actor, p_actor, p_at, p_at
  );

  v_tx := private.open_tx(v_type, v_id, null, null, v_box.location_id, btrim(p_comment), p_actor, p_at);
  perform private.add_entry(
    v_tx, v_id, null, null, p_cashbox, null, v_box.currency_id, p_counterparty,
    v_direction, v_amount, v_entry_type, p_actor, p_at
  );
  perform private.audit(p_actor, 'cash.' || p_direction, 'cashbox', p_cashbox, null, jsonb_build_object('amount', v_amount, 'operation', v_id, 'reason', btrim(p_comment)));
  return v_id;
end;
$$;
