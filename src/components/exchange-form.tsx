"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Decimal from "decimal.js";
import { quoteAmount, rateCaption, suggestedRate } from "@/lib/exchange-math";
import { formatMoney } from "@/lib/format";
import { createCounterparty, postExchange, saveExchangeDraft } from "@/server/actions";
import { notify } from "@/components/notify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { controlClass, Field } from "@/components/bits";

type Location = { id: string; name: string };
type Currency = { id: string; code: string; precision: number };
type Cashbox = { id: string; name: string; location_id: string; currency_id: string; currency_code: string; balance: string; is_active: boolean };
type Counterparty = { id: string; name: string };
type Rate = { base_code: string; quote_code: string; buy_rate: string; sell_rate: string };

export function ExchangeForm({
  locations,
  currencies,
  cashboxes,
  counterparties,
  rates,
  operator,
  presetLocation,
}: {
  locations: Location[];
  currencies: Currency[];
  cashboxes: Cashbox[];
  counterparties: Counterparty[];
  rates: Rate[];
  operator: string;
  presetLocation?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [key] = useState(() => crypto.randomUUID());
  const [confirm, setConfirm] = useState(false);
  const [partyOpen, setPartyOpen] = useState(false);
  const [parties, setParties] = useState(counterparties);
  const activeCurrencies = currencies.filter((item) => item.code);
  const [locationId, setLocationId] = useState(presetLocation && locations.some((item) => item.id === presetLocation) ? presetLocation : locations[0]?.id ?? "");
  const [partyId, setPartyId] = useState(parties[0]?.id ?? "");
  const [inCode, setInCode] = useState("USD");
  const [outCode, setOutCode] = useState("RUB");
  const [amountIn, setAmountIn] = useState("1000");
  const [rate, setRate] = useState(suggestedRate("USD", "RUB", rates) ?? "");
  const [commission, setCommission] = useState("");
  const [commissionCode, setCommissionCode] = useState("RUB");
  const [comment, setComment] = useState("");
  const [partyName, setPartyName] = useState("");
  const [partyPhone, setPartyPhone] = useState("");

  const boxes = cashboxes.filter((box) => box.location_id === locationId && box.is_active);
  const inBox = boxes.find((box) => box.currency_code === inCode);
  const outBox = boxes.find((box) => box.currency_code === outCode);
  const outCurrency = currencies.find((item) => item.code === outCode);
  const inCurrency = currencies.find((item) => item.code === inCode);

  const quoted = useMemo(() => {
    if (!amountIn || !rate || !outCurrency || inCode === outCode) return null;
    try {
      return quoteAmount(amountIn.replace(",", "."), rate.replace(",", "."), inCode, outCode, outCurrency.precision);
    } catch {
      return null;
    }
  }, [amountIn, rate, inCode, outCode, outCurrency]);

  const shortfall = outBox && quoted ? new Decimal(outBox.balance).lt(quoted) : false;

  function applyPair(nextIn: string, nextOut: string) {
    setInCode(nextIn);
    setOutCode(nextOut);
    const suggestion = suggestedRate(nextIn, nextOut, rates);
    if (suggestion) setRate(suggestion);
  }

  function payload() {
    return {
      idempotencyKey: key,
      locationId,
      cashboxInId: inBox?.id ?? "",
      cashboxOutId: outBox?.id ?? "",
      counterpartyId: partyId,
      amountIn,
      exchangeRate: rate,
      commission,
      commissionCurrencyId: currencies.find((item) => item.code === commissionCode)?.id,
      comment,
    };
  }

  function submit(mode: "draft" | "post") {
    startTransition(async () => {
      const result = mode === "draft" ? await saveExchangeDraft(payload()) : await postExchange(payload());
      if (notify(result) && result.id) {
        setConfirm(false);
        router.push(`/operations/${result.id}`);
        router.refresh();
      }
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
      <form
        className="grid gap-4 rounded-2xl border border-border/80 bg-card/75 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          setConfirm(true);
        }}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Точка">
            <select className={controlClass} value={locationId} onChange={(event) => setLocationId(event.target.value)}>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>{location.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Контрагент">
            <div className="flex gap-2">
              <select className={controlClass} value={partyId} onChange={(event) => setPartyId(event.target.value)}>
                {parties.map((party) => (
                  <option key={party.id} value={party.id}>{party.name}</option>
                ))}
              </select>
              <Button type="button" variant="outline" onClick={() => setPartyOpen(true)}>Новый</Button>
            </div>
          </Field>
        </div>
        <div className="grid gap-4 rounded-xl border border-border/70 p-4 md:grid-cols-2">
          <Field label="Клиент отдаёт">
            <select className={controlClass} value={inCode} onChange={(event) => applyPair(event.target.value, outCode)}>
              {activeCurrencies.map((currency) => (
                <option key={currency.id} value={currency.code}>{currency.code}</option>
              ))}
            </select>
          </Field>
          <Field label="Сумма отдачи">
            <Input className="h-10" inputMode="decimal" value={amountIn} onChange={(event) => setAmountIn(event.target.value)} />
          </Field>
          <p className="text-xs text-muted-foreground md:col-span-2">Приход в {inBox?.name ?? "кассу не найдена"}</p>
        </div>
        <Field label={`Курс. ${rateCaption(inCode, outCode)}`}>
          <Input className="h-10" inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value)} />
        </Field>
        <div className="grid gap-4 rounded-xl border border-border/70 p-4 md:grid-cols-2">
          <Field label="Клиент получает">
            <select className={controlClass} value={outCode} onChange={(event) => applyPair(inCode, event.target.value)}>
              {activeCurrencies.map((currency) => (
                <option key={currency.id} value={currency.code}>{currency.code}</option>
              ))}
            </select>
          </Field>
          <Field label="Сумма получения">
            <Input className="h-10" readOnly value={quoted ?? ""} />
          </Field>
          <p className={`text-xs md:col-span-2 ${shortfall ? "text-destructive" : "text-muted-foreground"}`}>
            Расход из {outBox?.name ?? "кассы не найдена"}. Доступно {outBox ? formatMoney(outBox.balance, outCode, outCurrency?.precision) : "—"}.
            {shortfall ? " Недостаточно средств." : ""}
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Комиссия, если есть">
            <Input className="h-10" inputMode="decimal" value={commission} onChange={(event) => setCommission(event.target.value)} placeholder="0" />
          </Field>
          <Field label="Валюта комиссии">
            <select className={controlClass} value={commissionCode} onChange={(event) => setCommissionCode(event.target.value)}>
              {activeCurrencies.map((currency) => (
                <option key={currency.id} value={currency.code}>{currency.code}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Комментарий">
          <Textarea value={comment} onChange={(event) => setComment(event.target.value)} />
        </Field>
        <p className="text-sm text-muted-foreground">Ответственный: {operator}. Курс записывается в операцию и не меняется задним числом.</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={pending} onClick={() => submit("draft")}>Сохранить черновик</Button>
          <Button type="submit" disabled={pending || shortfall || !quoted || inCode === outCode}>Провести</Button>
        </div>
      </form>
      <aside className="h-fit rounded-2xl border border-primary/30 bg-primary/10 p-5">
        <p className="text-sm text-muted-foreground">Калькулятор</p>
        <p className="mt-3 text-3xl font-semibold tabular-nums">{quoted ? formatMoney(quoted, outCode, outCurrency?.precision) : "—"}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Клиент отдаёт {amountIn || "—"} {inCode} по курсу {rate || "—"} и получает {outCode}.
        </p>
        <p className="mt-4 text-xs leading-5 text-muted-foreground">
          Оборот в отчёте — это рублёвая нога обмена. Комиссия учитывается отдельно и не считается прибылью от всего объёма.
        </p>
      </aside>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Провести обмен?</DialogTitle>
          </DialogHeader>
          <div className="space-y-1 text-sm">
            <p>В кассу придёт {formatMoney(amountIn, inCode, inCurrency?.precision)}.</p>
            <p>Из кассы уйдёт {quoted ? formatMoney(quoted, outCode, outCurrency?.precision) : "—"}.</p>
            <p>Курс {rate} будет сохранён в операции.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>Вернуться</Button>
            <Button disabled={pending} onClick={() => submit("post")}>{pending ? "Проводим…" : "Подтвердить"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={partyOpen} onOpenChange={setPartyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новый контрагент</DialogTitle>
          </DialogHeader>
          <Field label="Имя или название">
            <Input className="h-10" value={partyName} onChange={(event) => setPartyName(event.target.value)} />
          </Field>
          <Field label="Телефон">
            <Input className="h-10" value={partyPhone} onChange={(event) => setPartyPhone(event.target.value)} />
          </Field>
          <DialogFooter>
            <Button
              disabled={pending}
              onClick={() => {
                startTransition(async () => {
                  const result = await createCounterparty({ name: partyName, phone: partyPhone, comment: "" });
                  if (notify(result) && result.id) {
                    setParties((current) => [...current, { id: result.id!, name: partyName }]);
                    setPartyId(result.id);
                    setPartyOpen(false);
                    setPartyName("");
                  }
                });
              }}
            >
              Создать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
