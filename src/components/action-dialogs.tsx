"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  cancelOperation,
  cancelTransfer,
  createCurrency,
  createDebt,
  createEmployee,
  createTransfer,
  postCashMovement,
  postExchange,
  publishRate,
  receiveTransfer,
  repayDebt,
  resetEmployeePassword,
  saveCashbox,
  saveEmployee,
  saveLocation,
  saveSettings,
  sendTransfer,
  setCurrencyActive,
  updateCounterparty,
} from "@/server/actions";
import { actionLabel, roleLabel } from "@/lib/labels";
import { notify } from "@/components/notify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { controlClass, Field } from "@/components/bits";

function useKey() {
  const [key] = useState(() => crypto.randomUUID());
  return key;
}

export function CashMovementDialog({
  cashboxId,
  code,
  balance,
}: {
  cashboxId: string;
  code: string;
  balance: string;
}) {
  const router = useRouter();
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<"in" | "out" | "adjust">("in");
  const [amount, setAmount] = useState("");
  const [comment, setComment] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button onClick={() => { setIdempotencyKey(crypto.randomUUID()); setDirection("in"); setOpen(true); }}>Приход</Button>
      <Button variant="outline" onClick={() => { setIdempotencyKey(crypto.randomUUID()); setDirection("out"); setOpen(true); }}>Расход</Button>
      <Button variant="secondary" onClick={() => { setIdempotencyKey(crypto.randomUUID()); setDirection("adjust"); setOpen(true); }}>Корректировка</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {direction === "in" ? "Приход" : direction === "out" ? "Расход" : "Корректировка остатка"} · {code}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Текущий остаток считается из журнала: {balance} {code}. Поле остатка напрямую не редактируется.</p>
          <Field label={direction === "adjust" ? "Новый остаток" : "Сумма"}>
            <Input className="h-10" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </Field>
          <Field label="Причина">
            <Textarea value={comment} onChange={(event) => setComment(event.target.value)} />
          </Field>
          {direction === "out" && (
            <Field label="Категория">
              <select id="category" className={controlClass} defaultValue="expense">
                <option value="expense">Расход</option>
                <option value="other">Прочее</option>
              </select>
            </Field>
          )}
          <DialogFooter>
            <Button
              disabled={pending}
              onClick={() => {
                const category = direction === "out" ? (document.getElementById("category") as HTMLSelectElement | null)?.value : direction;
                startTransition(async () => {
                  const result = await postCashMovement({
                    idempotencyKey,
                    cashboxId,
                    direction,
                    amount,
                    category,
                    comment,
                  });
                  if (notify(result)) {
                    setOpen(false);
                    router.refresh();
                  }
                });
              }}
            >
              {pending ? "Проводим…" : "Подтвердить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function CancelDocument({
  id,
  kind,
}: {
  id: string;
  kind: "operation" | "transfer";
}) {
  const router = useRouter();
  const idempotencyKey = useKey();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)}>Отменить</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Отмена с указанием причины</DialogTitle>
          </DialogHeader>
          <Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Почему операция отменяется" />
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => {
                startTransition(async () => {
                  const result = kind === "operation"
                    ? await cancelOperation({ id, reason, idempotencyKey })
                    : await cancelTransfer({ id, reason, idempotencyKey });
                  if (notify(result)) {
                    setOpen(false);
                    router.refresh();
                  }
                });
              }}
            >
              {pending ? "Отменяем…" : "Сторнировать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function PostDraftButton({
  draft,
}: {
  draft: {
    id: string;
    location_id: string;
    cashbox_in_id: string;
    cashbox_out_id: string;
    counterparty_id: string;
    amount_from: string;
    exchange_rate: string;
    commission: string;
    commission_currency_id: string | null;
    comment: string | null;
  };
}) {
  const router = useRouter();
  const [key] = useState(() => crypto.randomUUID());
  const [pending, startTransition] = useTransition();
  return (
    <Button
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const result = await postExchange({
            idempotencyKey: key,
            draftId: draft.id,
            locationId: draft.location_id,
            cashboxInId: draft.cashbox_in_id,
            cashboxOutId: draft.cashbox_out_id,
            counterpartyId: draft.counterparty_id,
            amountIn: String(draft.amount_from),
            exchangeRate: String(draft.exchange_rate),
            commission: String(draft.commission ?? ""),
            commissionCurrencyId: draft.commission_currency_id ?? undefined,
            comment: draft.comment ?? "",
          });
          if (notify(result)) router.refresh();
        });
      }}
    >
      {pending ? "Проводим…" : "Провести черновик"}
    </Button>
  );
}

export function TransferForm({
  locations,
  currencies,
}: {
  locations: { id: string; name: string }[];
  currencies: { id: string; code: string }[];
}) {
  const router = useRouter();
  const idempotencyKey = useKey();
  const [pending, startTransition] = useTransition();
  const [fromLocationId, setFrom] = useState(locations[0]?.id ?? "");
  const [toLocationId, setTo] = useState(locations[1]?.id ?? locations[0]?.id ?? "");
  const [currencyId, setCurrency] = useState(currencies.find((item) => item.code === "USD")?.id ?? currencies[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [commissionEnabled, setCommissionEnabled] = useState(false);
  const [commission, setCommission] = useState("");
  const [comment, setComment] = useState("");
  const [dispatch, setDispatch] = useState(true);

  return (
    <form
      className="grid gap-4 rounded-2xl border border-border/80 bg-card/75 p-5 md:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await createTransfer({
            idempotencyKey, fromLocationId, toLocationId, currencyId, amount, commissionEnabled, commission, comment, dispatch,
          });
          if (notify(result) && result.id) router.push(`/transfers/${result.id}`);
        });
      }}
    >
      <Field label="Точка отправления">
        <select className={controlClass} value={fromLocationId} onChange={(event) => setFrom(event.target.value)}>
          {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
        </select>
      </Field>
      <Field label="Точка получения">
        <select className={controlClass} value={toLocationId} onChange={(event) => setTo(event.target.value)}>
          {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
        </select>
      </Field>
      <Field label="Валюта">
        <select className={controlClass} value={currencyId} onChange={(event) => setCurrency(event.target.value)}>
          {currencies.map((currency) => <option key={currency.id} value={currency.id}>{currency.code}</option>)}
        </select>
      </Field>
      <Field label="Сумма списания">
        <Input className="h-10" value={amount} onChange={(event) => setAmount(event.target.value)} />
      </Field>
      <label className="flex items-center gap-2 text-sm md:col-span-2">
        <input type="checkbox" checked={commissionEnabled} onChange={(event) => setCommissionEnabled(event.target.checked)} />
        Удержать комиссию отдельной записью. Получатель увидит сумму минус комиссию.
      </label>
      {commissionEnabled && (
        <Field label="Комиссия">
          <Input className="h-10" value={commission} onChange={(event) => setCommission(event.target.value)} />
        </Field>
      )}
      <Field label="Комментарий">
        <Input className="h-10" value={comment} onChange={(event) => setComment(event.target.value)} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={dispatch} onChange={(event) => setDispatch(event.target.checked)} />
        Сразу отправить и поставить деньги в путь
      </label>
      <div className="md:col-span-2">
        <Button type="submit" disabled={pending}>{pending ? "Сохраняем…" : dispatch ? "Создать и отправить" : "Только создать заявку"}</Button>
      </div>
    </form>
  );
}

export function TransferStepButtons({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [key] = useState(() => crypto.randomUUID());
  const [pending, startTransition] = useTransition();
  if (status !== "created" && status !== "sent") return null;
  return (
    <Button
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const result = status === "created"
            ? await sendTransfer({ id, idempotencyKey: key })
            : await receiveTransfer({ id, idempotencyKey: key });
          if (notify(result)) router.refresh();
        });
      }}
    >
      {pending ? "Проводим…" : status === "created" ? "Отправить" : "Подтвердить получение"}
    </Button>
  );
}

export function DebtForm({
  counterparties,
  currencies,
  locations,
}: {
  counterparties: { id: string; name: string }[];
  currencies: { id: string; code: string }[];
  locations: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [pending, startTransition] = useTransition();
  const [counterpartyId, setParty] = useState(counterparties[0]?.id ?? "");
  const [currencyId, setCurrency] = useState(currencies[0]?.id ?? "");
  const [locationId, setLocation] = useState(locations[0]?.id ?? "");
  const [direction, setDirection] = useState<"receivable" | "payable">("receivable");
  const [amount, setAmount] = useState("");
  const [comment, setComment] = useState("");
  return (
    <form
      className="grid gap-3 rounded-2xl border border-border/80 bg-card/75 p-5 md:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await createDebt({ idempotencyKey, counterpartyId, currencyId, locationId, direction, amount, comment });
          if (notify(result)) {
            setIdempotencyKey(crypto.randomUUID());
            setAmount("");
            router.refresh();
          }
        });
      }}
    >
      <Field label="Контрагент">
        <select className={controlClass} value={counterpartyId} onChange={(event) => setParty(event.target.value)}>
          {counterparties.map((party) => <option key={party.id} value={party.id}>{party.name}</option>)}
        </select>
      </Field>
      <Field label="Направление">
        <select className={controlClass} value={direction} onChange={(event) => setDirection(event.target.value as "receivable" | "payable")}>
          <option value="receivable">Нам должны</option>
          <option value="payable">Мы должны</option>
        </select>
      </Field>
      <Field label="Валюта">
        <select className={controlClass} value={currencyId} onChange={(event) => setCurrency(event.target.value)}>
          {currencies.map((currency) => <option key={currency.id} value={currency.id}>{currency.code}</option>)}
        </select>
      </Field>
      <Field label="Точка">
        <select className={controlClass} value={locationId} onChange={(event) => setLocation(event.target.value)}>
          {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
        </select>
      </Field>
      <Field label="Сумма">
        <Input className="h-10" value={amount} onChange={(event) => setAmount(event.target.value)} />
      </Field>
      <Field label="Комментарий">
        <Input className="h-10" value={comment} onChange={(event) => setComment(event.target.value)} />
      </Field>
      <div className="md:col-span-2">
        <Button type="submit" disabled={pending}>Зарегистрировать долг</Button>
      </div>
    </form>
  );
}

export function RepayDialog({
  debtId,
  remaining,
  cashboxes,
}: {
  debtId: string;
  remaining: string;
  cashboxes: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(remaining));
  const [cashboxId, setCashbox] = useState(cashboxes[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => { setIdempotencyKey(crypto.randomUUID()); setAmount(String(remaining)); setOpen(true); }}>Погасить</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Погашение</DialogTitle>
          </DialogHeader>
          <Field label="Касса">
            <select className={controlClass} value={cashboxId} onChange={(event) => setCashbox(event.target.value)}>
              {cashboxes.map((box) => <option key={box.id} value={box.id}>{box.name}</option>)}
            </select>
          </Field>
          <Field label="Сумма">
            <Input className="h-10" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </Field>
          <Button type="button" variant="ghost" onClick={() => setAmount(String(remaining))}>Подставить остаток</Button>
          <DialogFooter>
            <Button
              disabled={pending}
              onClick={() => {
                startTransition(async () => {
                  const result = await repayDebt({ idempotencyKey, debtId, cashboxId, amount, comment: "Погашение из реестра" });
                  if (notify(result)) {
                    setOpen(false);
                    router.refresh();
                  }
                });
              }}
            >
              Провести погашение
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function RateEditor({ currencies }: { currencies: { id: string; code: string; is_active: boolean }[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const bases = currencies.filter((item) => item.code !== "RUB");
  const rub = currencies.find((item) => item.code === "RUB");
  const [baseCurrencyId, setBase] = useState(bases[0]?.id ?? "");
  const [buyRate, setBuy] = useState("");
  const [sellRate, setSell] = useState("");
  const [effectiveAt, setEffective] = useState(new Date().toISOString().slice(0, 16));
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form
        className="grid gap-3 rounded-2xl border border-border/80 bg-card/75 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(async () => {
            const result = await publishRate({
              baseCurrencyId,
              quoteCurrencyId: rub?.id ?? "",
              buyRate,
              sellRate,
              effectiveAt,
            });
            if (notify(result)) router.refresh();
          });
        }}
      >
        <h2 className="font-medium">Новая запись курса</h2>
        <Field label="Валюта">
          <select className={controlClass} value={baseCurrencyId} onChange={(event) => setBase(event.target.value)}>
            {bases.map((currency) => <option key={currency.id} value={currency.id}>{currency.code}</option>)}
          </select>
        </Field>
        <Field label="Покупка, RUB">
          <Input className="h-10" value={buyRate} onChange={(event) => setBuy(event.target.value)} />
        </Field>
        <Field label="Продажа, RUB">
          <Input className="h-10" value={sellRate} onChange={(event) => setSell(event.target.value)} />
        </Field>
        <Field label="Действует с">
          <Input className="h-10" type="datetime-local" value={effectiveAt} onChange={(event) => setEffective(event.target.value)} />
        </Field>
        <Button type="submit" disabled={pending}>Сохранить курс</Button>
      </form>
      <form
        className="grid gap-3 rounded-2xl border border-border/80 bg-card/75 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(async () => {
            const result = await createCurrency({ code, name, symbol, precision: 2 });
            if (notify(result)) router.refresh();
          });
        }}
      >
        <h2 className="font-medium">Новая валюта</h2>
        <Field label="Код"><Input className="h-10" value={code} onChange={(event) => setCode(event.target.value)} /></Field>
        <Field label="Название"><Input className="h-10" value={name} onChange={(event) => setName(event.target.value)} /></Field>
        <Field label="Символ"><Input className="h-10" value={symbol} onChange={(event) => setSymbol(event.target.value)} /></Field>
        <Button type="submit" variant="secondary" disabled={pending}>Добавить и создать кассы</Button>
        <div className="flex flex-wrap gap-2">
          {currencies.filter((item) => item.code !== "RUB").map((currency) => (
            <Button
              key={currency.id}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                startTransition(async () => {
                  const result = await setCurrencyActive({ id: currency.id, active: !currency.is_active });
                  if (notify(result)) router.refresh();
                });
              }}
            >
              {currency.code}: {currency.is_active ? "отключить" : "включить"}
            </Button>
          ))}
        </div>
      </form>
    </div>
  );
}

export function CounterpartyEditor({
  id,
  name,
  phone,
  comment,
  status,
}: {
  id: string;
  name: string;
  phone: string;
  comment: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [nextName, setName] = useState(name);
  const [nextPhone, setPhone] = useState(phone);
  const [nextComment, setComment] = useState(comment);
  const [nextStatus, setStatus] = useState(status === "archived" ? "archived" : "active");
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await updateCounterparty({ id, name: nextName, phone: nextPhone, comment: nextComment, status: nextStatus });
          if (notify(result)) router.refresh();
        });
      }}
    >
      <Field label="Имя"><Input className="h-10" value={nextName} onChange={(event) => setName(event.target.value)} /></Field>
      <Field label="Телефон"><Input className="h-10" value={nextPhone} onChange={(event) => setPhone(event.target.value)} /></Field>
      <Field label="Комментарий"><Textarea value={nextComment} onChange={(event) => setComment(event.target.value)} /></Field>
      <Field label="Статус">
        <select className={controlClass} value={nextStatus} onChange={(event) => setStatus(event.target.value as "active" | "archived")}>
          <option value="active">Активен</option>
          <option value="archived">В архиве</option>
        </select>
      </Field>
      <Button type="submit" disabled={pending}>Сохранить карточку</Button>
    </form>
  );
}

export function LocationEditor({
  locations,
  cashboxes,
  canManage,
}: {
  locations: { id: string; name: string; address: string | null; is_active: boolean }[];
  cashboxes: { id: string; name: string; is_active: boolean }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  if (!canManage) return null;
  return (
    <div className="grid gap-4">
      <form
        className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-card/75 p-5 md:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(async () => {
            const result = await saveLocation({ name, address, active: true });
            if (notify(result)) {
              setName("");
              setAddress("");
              router.refresh();
            }
          });
        }}
      >
        <Input className="h-10" placeholder="Название точки" value={name} onChange={(event) => setName(event.target.value)} />
        <Input className="h-10" placeholder="Адрес" value={address} onChange={(event) => setAddress(event.target.value)} />
        <Button type="submit" disabled={pending}>Добавить точку</Button>
      </form>
      {locations.map((location) => (
        <LocationRow key={location.id} location={location} />
      ))}
      {cashboxes.map((box) => (
        <CashboxRow key={box.id} box={box} />
      ))}
    </div>
  );
}

function LocationRow({ location }: { location: { id: string; name: string; address: string | null; is_active: boolean } }) {
  const router = useRouter();
  const [name, setName] = useState(location.name);
  const [address, setAddress] = useState(location.address ?? "");
  const [active, setActive] = useState(location.is_active);
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="grid gap-2 rounded-xl border border-border/70 p-3 md:grid-cols-[1fr_1fr_auto_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await saveLocation({ id: location.id, name, address, active });
          if (notify(result)) router.refresh();
        });
      }}
    >
      <Input className="h-10" value={name} onChange={(event) => setName(event.target.value)} />
      <Input className="h-10" value={address} onChange={(event) => setAddress(event.target.value)} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />Активна</label>
      <Button type="submit" variant="outline" disabled={pending}>Сохранить</Button>
    </form>
  );
}

function CashboxRow({ box }: { box: { id: string; name: string; is_active: boolean } }) {
  const router = useRouter();
  const [name, setName] = useState(box.name);
  const [active, setActive] = useState(box.is_active);
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="grid gap-2 rounded-xl border border-border/70 p-3 md:grid-cols-[1fr_auto_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await saveCashbox({ id: box.id, name, active });
          if (notify(result)) router.refresh();
        });
      }}
    >
      <Input className="h-10" value={name} onChange={(event) => setName(event.target.value)} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />Касса активна</label>
      <Button type="submit" variant="outline" disabled={pending}>Имя кассы</Button>
    </form>
  );
}

export function SettingsForm({
  companyName,
  legalName,
  fullName,
  canManage,
}: {
  companyName: string;
  legalName: string;
  fullName: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [company, setCompany] = useState(companyName);
  const [legal, setLegal] = useState(legalName);
  const [name, setName] = useState(fullName);
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await saveSettings({ companyName: company, legalName: legal, fullName: name });
          if (notify(result)) router.refresh();
        });
      }}
    >
      <Field label="Ваше имя"><Input className="h-10" value={name} onChange={(event) => setName(event.target.value)} /></Field>
      <Field label="Название в интерфейсе"><Input className="h-10" value={company} disabled={!canManage} onChange={(event) => setCompany(event.target.value)} /></Field>
      <Field label="Юридическое описание"><Input className="h-10" value={legal} disabled={!canManage} onChange={(event) => setLegal(event.target.value)} /></Field>
      <Button type="submit" disabled={pending}>Сохранить</Button>
    </form>
  );
}

export function EmployeeManager({
  people,
  links,
  overrides,
  locations,
}: {
  people: { id: string; full_name: string; email: string | null; role: string; is_active: boolean }[];
  links: { user_id: string; location_id: string }[];
  overrides: { user_id: string; action: string; allowed: boolean }[];
  locations: { id: string; name: string }[];
}) {
  const [selected, setSelected] = useState(people[0]?.id ?? "");
  const person = people.find((item) => item.id === selected);
  return (
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <div className="rounded-2xl border border-border/80 bg-card/60 p-2">
        {people.map((item) => (
          <button key={item.id} type="button" onClick={() => setSelected(item.id)} className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${item.id === selected ? "bg-muted" : ""}`}>
            <span className="block font-medium">{item.full_name}</span>
            <span className="text-xs text-muted-foreground">{roleLabel[item.role]} · {item.is_active ? "активен" : "отключён"}</span>
          </button>
        ))}
        <CreateEmployee locations={locations} />
      </div>
      {person && (
        <EmployeeCard
          person={person}
          locationIds={links.filter((link) => link.user_id === person.id).map((link) => link.location_id)}
          overrides={overrides.filter((item) => item.user_id === person.id)}
          locations={locations}
        />
      )}
    </div>
  );
}

function CreateEmployee({ locations }: { locations: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [fullName, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"ADMIN" | "ACCOUNTANT" | "MANAGER" | "EMPLOYEE">("EMPLOYEE");
  const [locationIds, setLocations] = useState<string[]>(locations[0] ? [locations[0].id] : []);
  return (
    <>
      <Button className="mt-3 w-full" onClick={() => setOpen(true)}>Новый сотрудник</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Создать сотрудника</DialogTitle></DialogHeader>
          <Field label="Имя"><Input className="h-10" value={fullName} onChange={(event) => setName(event.target.value)} /></Field>
          <Field label="Почта"><Input className="h-10" value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
          <Field label="Временный пароль"><Input className="h-10" value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
          <Field label="Роль">
            <select className={controlClass} value={role} onChange={(event) => setRole(event.target.value as typeof role)}>
              {Object.entries(roleLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <div className="grid gap-2">
            {locations.map((location) => (
              <label key={location.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={locationIds.includes(location.id)}
                  onChange={(event) => {
                    setLocations((current) => event.target.checked ? [...current, location.id] : current.filter((id) => id !== location.id));
                  }}
                />
                {location.name}
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button
              disabled={pending}
              onClick={() => {
                startTransition(async () => {
                  const result = await createEmployee({ fullName, email, password, role, locationIds });
                  if (notify(result)) {
                    setOpen(false);
                    router.refresh();
                  }
                });
              }}
            >
              Создать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function EmployeeCard({
  person,
  locationIds,
  overrides,
  locations,
}: {
  person: { id: string; full_name: string; email: string | null; role: string; is_active: boolean };
  locationIds: string[];
  overrides: { action: string; allowed: boolean }[];
  locations: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [fullName, setName] = useState(person.full_name);
  const [role, setRole] = useState(person.role);
  const [active, setActive] = useState(person.is_active);
  const [selectedLocations, setSelectedLocations] = useState(locationIds);
  const [grants, setGrants] = useState(overrides);
  const [password, setPassword] = useState("");
  const [pending, startTransition] = useTransition();
  const actions = Object.keys(actionLabel);
  return (
    <form
      className="grid gap-4 rounded-2xl border border-border/80 bg-card/75 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await saveEmployee({
            id: person.id,
            fullName,
            role,
            active,
            locationIds: selectedLocations,
            overrides: grants,
          });
          if (notify(result)) router.refresh();
        });
      }}
    >
      <div>
        <h2 className="text-lg font-semibold">{person.full_name}</h2>
        <p className="text-sm text-muted-foreground">{person.email}</p>
      </div>
      <Field label="Имя"><Input className="h-10" value={fullName} onChange={(event) => setName(event.target.value)} /></Field>
      <Field label="Роль">
        <select className={controlClass} value={role} onChange={(event) => setRole(event.target.value)}>
          {Object.entries(roleLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />Учётная запись активна</label>
      <div className="grid gap-2 sm:grid-cols-2">
        {locations.map((location) => (
          <label key={location.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selectedLocations.includes(location.id)}
              onChange={(event) => setSelectedLocations((current) => event.target.checked ? [...current, location.id] : current.filter((id) => id !== location.id))}
            />
            {location.name}
          </label>
        ))}
      </div>
      <div className="grid max-h-72 gap-2 overflow-auto rounded-xl border border-border/70 p-3">
        {actions.map((action) => {
          const current = grants.find((item) => item.action === action);
          return (
            <label key={action} className="flex items-center justify-between gap-3 text-sm">
              <span>{actionLabel[action]}</span>
              <select
                className="h-8 rounded-md border border-input bg-transparent px-2"
                value={current ? String(current.allowed) : "role"}
                onChange={(event) => {
                  const value = event.target.value;
                  setGrants((list) => {
                    const rest = list.filter((item) => item.action !== action);
                    if (value === "role") return rest;
                    return [...rest, { action, allowed: value === "true" }];
                  });
                }}
              >
                <option value="role">Как у роли</option>
                <option value="true">Разрешить</option>
                <option value="false">Запретить</option>
              </select>
            </label>
          );
        })}
      </div>
      <Button type="submit" disabled={pending}>Сохранить права</Button>
      <div className="flex flex-col gap-2 border-t border-border/70 pt-4 sm:flex-row">
        <Input className="h-10" placeholder="Новый пароль" value={password} onChange={(event) => setPassword(event.target.value)} />
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            startTransition(async () => {
              const result = await resetEmployeePassword({ id: person.id, password });
              if (notify(result)) setPassword("");
            });
          }}
        >
          Сменить пароль
        </Button>
      </div>
    </form>
  );
}
