-- Демо-наполнение идёт через те же проводки, что и боевые операции.
-- Функцию вызывает только service role из scripts/seed.ts.

create or replace function public.seed_demo_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid;
  v_mgr_mhk uuid;
  v_mgr_msk uuid;
  v_mhk uuid := '11111111-1111-4111-8111-111111111111';
  v_msk uuid := '22222222-2222-4222-8222-222222222222';
  v_rub uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  v_usd uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
  v_eur uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
  v_usdt uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
  v_mhk_rub uuid := 'c1000000-0000-4000-8000-000000000001';
  v_mhk_usd uuid := 'c1000000-0000-4000-8000-000000000002';
  v_mhk_eur uuid := 'c1000000-0000-4000-8000-000000000003';
  v_mhk_usdt uuid := 'c1000000-0000-4000-8000-000000000004';
  v_msk_rub uuid := 'c2000000-0000-4000-8000-000000000001';
  v_msk_usd uuid := 'c2000000-0000-4000-8000-000000000002';
  v_msk_eur uuid := 'c2000000-0000-4000-8000-000000000003';
  v_msk_usdt uuid := 'c2000000-0000-4000-8000-000000000004';
  v_names text[] := array[
    'Каспий Трейд DEMO', 'Северный партнёр DEMO', 'Магомед Алиев DEMO', 'ООО «Горизонт» DEMO',
    'Анна Соколова DEMO', 'Пётр Волков DEMO', 'East Gate DEMO', 'Каспий Логистик DEMO',
    'Марина Орлова DEMO', 'Руслан Гаджиев DEMO'
  ];
  v_cp uuid[] := array[]::uuid[];
  v_i integer;
  v_actor uuid;
  v_before numeric;
  v_mid numeric;
  v_after numeric;
  v_op uuid;
  v_dup uuid;
  v_debt uuid;
  v_transfer uuid;
  rec record;
begin
  if exists (select 1 from public.operations) or exists (select 1 from public.transfers) then
    raise exception 'Демо-данные уже загружены';
  end if;

  select id into v_admin from public.profiles where role = 'ADMIN' and is_active order by created_at limit 1;
  if v_admin is null then
    raise exception 'Сначала создайте активного администратора';
  end if;
  select id into v_mgr_mhk from public.profiles where email = 'manager.makhachkala@valora.demo';
  select id into v_mgr_msk from public.profiles where email = 'manager.moscow@valora.demo';
  v_mgr_mhk := coalesce(v_mgr_mhk, v_admin);
  v_mgr_msk := coalesce(v_mgr_msk, v_admin);

  for v_i in 1..10 loop
    v_cp[v_i] := private.create_counterparty(v_admin, v_names[v_i], '+7 000 100-00-' || lpad(v_i::text, 2, '0'), 'DEMO · тестовый контрагент');
  end loop;

  perform private.publish_rate(v_admin, v_usd, v_rub, 89.20, 91.40, now() - interval '30 days');
  perform private.publish_rate(v_admin, v_eur, v_rub, 97.00, 99.40, now() - interval '30 days');
  perform private.publish_rate(v_admin, v_usdt, v_rub, 89.00, 91.10, now() - interval '30 days');
  perform private.publish_rate(v_admin, v_usd, v_rub, 90.10, 92.20, now() - interval '10 days');
  perform private.publish_rate(v_admin, v_eur, v_rub, 97.80, 100.10, now() - interval '10 days');
  perform private.publish_rate(v_admin, v_usdt, v_rub, 89.90, 91.80, now() - interval '10 days');
  perform private.publish_rate(v_admin, v_usd, v_rub, 90.50, 92.50, now() - interval '1 day');
  perform private.publish_rate(v_admin, v_eur, v_rub, 98.20, 100.60, now() - interval '1 day');
  perform private.publish_rate(v_admin, v_usdt, v_rub, 90.30, 92.10, now() - interval '1 day');

  perform private.post_cash_movement(v_admin, 'demo:open:mhk:rub', v_mhk_rub, 'in', 5000000, 'capital', 'DEMO · начальный остаток', null, now() - interval '21 days');
  perform private.post_cash_movement(v_admin, 'demo:open:mhk:usd', v_mhk_usd, 'in', 50000, 'capital', 'DEMO · начальный остаток', null, now() - interval '21 days');
  perform private.post_cash_movement(v_admin, 'demo:open:mhk:eur', v_mhk_eur, 'in', 20000, 'capital', 'DEMO · начальный остаток', null, now() - interval '21 days');
  perform private.post_cash_movement(v_admin, 'demo:open:mhk:usdt', v_mhk_usdt, 'in', 30000, 'capital', 'DEMO · начальный остаток', null, now() - interval '21 days');
  perform private.post_cash_movement(v_admin, 'demo:open:msk:rub', v_msk_rub, 'in', 8000000, 'capital', 'DEMO · начальный остаток', null, now() - interval '21 days');
  perform private.post_cash_movement(v_admin, 'demo:open:msk:usd', v_msk_usd, 'in', 80000, 'capital', 'DEMO · начальный остаток', null, now() - interval '21 days');
  perform private.post_cash_movement(v_admin, 'demo:open:msk:eur', v_msk_eur, 'in', 25000, 'capital', 'DEMO · начальный остаток', null, now() - interval '21 days');
  perform private.post_cash_movement(v_admin, 'demo:open:msk:usdt', v_msk_usdt, 'in', 40000, 'capital', 'DEMO · начальный остаток', null, now() - interval '21 days');

  v_before := private.cashbox_balance(v_mhk_rub);
  v_op := private.post_exchange(v_admin, 'demo:self:cancel', v_mhk, v_mhk_usd, v_mhk_rub, v_cp[1], 100, 90.50, 0, null, 'DEMO · проверка отмены', now(), null, false);
  v_mid := private.cashbox_balance(v_mhk_rub);
  perform private.cancel_operation(v_admin, 'demo:self:cancel:undo', v_op, 'DEMO · проверка отмены');
  v_after := private.cashbox_balance(v_mhk_rub);
  if v_before <> v_after then
    raise exception 'SELFTEST: отмена не восстановила остаток';
  end if;
  if v_mid >= v_before then
    raise exception 'SELFTEST: обмен не уменьшил кассу расхода';
  end if;

  v_op := private.post_exchange(v_admin, 'demo:self:dup', v_mhk, v_mhk_usd, v_mhk_rub, v_cp[2], 200, 90.50, 0, null, 'DEMO · проверка идемпотентности', now(), null, false);
  v_dup := private.post_exchange(v_admin, 'demo:self:dup', v_mhk, v_mhk_usd, v_mhk_rub, v_cp[2], 200, 90.50, 0, null, 'DEMO · проверка идемпотентности', now(), null, false);
  if v_op <> v_dup then
    raise exception 'SELFTEST: повторный ключ создал другую операцию';
  end if;
  if (select count(*) from public.operations where idempotency_key = 'demo:self:dup') <> 1 then
    raise exception 'SELFTEST: обмен провелся дважды';
  end if;

  begin
    perform private.post_exchange(v_admin, 'demo:self:poor', v_mhk, v_mhk_rub, v_mhk_usd, v_cp[3], 10000000, 92.50, 0, null, 'DEMO · нехватка', now(), null, false);
    raise exception 'SELFTEST: не отклонена операция без покрытия';
  exception
    when others then
      if position('Недостаточно средств' in sqlerrm) = 0 then
        raise;
      end if;
  end;

  for rec in
    select * from (values
      (1, v_mhk, v_mhk_usd, v_mhk_rub, 2000::numeric, 90.50::numeric, 500::numeric),
      (2, v_mhk, v_mhk_usd, v_mhk_rub, 1500, 90.40, 0),
      (3, v_mhk, v_mhk_eur, v_mhk_rub, 1000, 98.20, 300),
      (4, v_mhk, v_mhk_usdt, v_mhk_rub, 2500, 90.30, 0),
      (5, v_mhk, v_mhk_rub, v_mhk_usd, 462500, 92.50, 0),
      (6, v_mhk, v_mhk_rub, v_mhk_eur, 201200, 100.60, 0),
      (7, v_msk, v_msk_usd, v_msk_rub, 3000, 90.50, 1000),
      (8, v_msk, v_msk_usd, v_msk_rub, 2500, 90.20, 0),
      (9, v_msk, v_msk_eur, v_msk_rub, 1500, 98.00, 0),
      (10, v_msk, v_msk_usdt, v_msk_rub, 4000, 90.10, 0),
      (11, v_msk, v_msk_rub, v_msk_usd, 925000, 92.50, 0),
      (12, v_msk, v_msk_rub, v_msk_usdt, 184200, 92.10, 0),
      (13, v_mhk, v_mhk_usd, v_mhk_rub, 800, 90.50, 0),
      (14, v_msk, v_msk_eur, v_msk_rub, 800, 98.20, 0),
      (15, v_mhk, v_mhk_usdt, v_mhk_rub, 1000, 90.30, 200),
      (16, v_msk, v_msk_usd, v_msk_eur, 1000, 0.8996, 0),
      (17, v_mhk, v_mhk_eur, v_mhk_usd, 500, 1.0616, 0),
      (18, v_msk, v_msk_rub, v_msk_eur, 503000, 100.60, 0),
      (19, v_mhk, v_mhk_usd, v_mhk_rub, 1200, 90.50, 0),
      (20, v_msk, v_msk_usd, v_msk_rub, 1800, 90.50, 750),
      (21, v_mhk, v_mhk_rub, v_mhk_usdt, 92100, 92.10, 0),
      (22, v_msk, v_msk_eur, v_msk_rub, 600, 98.20, 0),
      (23, v_mhk, v_mhk_usd, v_mhk_rub, 900, 90.50, 0),
      (24, v_msk, v_msk_usdt, v_msk_rub, 1500, 90.30, 0)
    ) as t(n, location_id, cash_in, cash_out, amount, rate, commission)
  loop
    v_actor := case when rec.location_id = v_mhk then v_mgr_mhk else v_mgr_msk end;
    perform private.post_exchange(
      v_actor,
      'demo:ex:' || rec.n,
      rec.location_id,
      rec.cash_in,
      rec.cash_out,
      v_cp[1 + ((rec.n - 1) % 10)],
      rec.amount,
      rec.rate,
      rec.commission,
      case when rec.commission > 0 then v_rub else null end,
      'DEMO · обмен №' || rec.n,
      now() - ((20 - (rec.n % 18)) || ' days')::interval,
      null,
      false
    );
  end loop;

  perform private.post_exchange(
    v_mgr_mhk, 'demo:draft:1', v_mhk, v_mhk_usd, v_mhk_rub, v_cp[5],
    300, 90.50, 0, null, 'DEMO · черновик', now(), null, true
  );

  perform private.post_cash_movement(
    v_admin, 'demo:expense:rent', v_mhk_rub, 'out', 50000, 'expense',
    'DEMO · аренда точки', null, now() - interval '3 days'
  );

  perform private.create_transfer(v_mgr_mhk, 'demo:tr:created', v_mhk, v_msk, v_usd, 10000, 0, 'DEMO · заявка без отправки', false, now() - interval '2 days');

  v_transfer := private.create_transfer(v_mgr_mhk, 'demo:tr:sent', v_mhk, v_msk, v_eur, 5000, 50, 'DEMO · евро в пути', true, now() - interval '1 day');

  v_transfer := private.create_transfer(v_mgr_msk, 'demo:tr:received', v_msk, v_mhk, v_usd, 20000, 100, 'DEMO · доллары доставлены', true, now() - interval '4 days');
  perform private.receive_transfer(v_mgr_mhk, 'demo:tr:received:ok', v_transfer);

  v_transfer := private.create_transfer(v_mgr_mhk, 'demo:tr:cancel', v_mhk, v_msk, v_usdt, 1000, 0, 'DEMO · отменённая отправка', true, now() - interval '5 days');
  perform private.cancel_transfer(v_mgr_mhk, 'demo:tr:cancel:ok', v_transfer, 'DEMO · отмена до получения');

  perform private.create_debt(v_mgr_mhk, 'demo:debt:1', v_cp[3], v_usd, v_mhk, 'receivable', 5000, 'DEMO · клиент должен USD', now() - interval '12 days');
  v_debt := private.create_debt(v_mgr_msk, 'demo:debt:2', v_cp[4], v_rub, v_msk, 'receivable', 250000, 'DEMO · частичный долг', now() - interval '9 days');
  perform private.repay_debt(v_mgr_msk, 'demo:debt:2:pay', v_debt, v_msk_rub, 100000, 'DEMO · частичное погашение');
  perform private.create_debt(v_mgr_mhk, 'demo:debt:3', v_cp[5], v_eur, v_mhk, 'payable', 2000, 'DEMO · компания должна EUR', now() - interval '8 days');
  v_debt := private.create_debt(v_mgr_msk, 'demo:debt:4', v_cp[6], v_usdt, v_msk, 'receivable', 3000, 'DEMO · погашенный долг', now() - interval '7 days');
  perform private.repay_debt(v_mgr_msk, 'demo:debt:4:pay', v_debt, v_msk_usdt, 3000, 'DEMO · полное погашение');
  perform private.create_debt(v_mgr_msk, 'demo:debt:5', v_cp[7], v_usd, v_msk, 'receivable', 1500, 'DEMO · открытый долг USD', now() - interval '4 days');
  perform private.create_debt(v_mgr_mhk, 'demo:debt:6', v_cp[1], v_rub, v_mhk, 'payable', 400000, 'DEMO · компания должна RUB', now() - interval '3 days');

  update public.app_settings
    set value = 'true'::jsonb, updated_by = v_admin, updated_at = now()
    where key = 'demo_seeded';

  perform public.assert_financial_integrity();
end;
$$;
