import Link from "next/link";
import { requireSession, selectedLocation } from "@/server/session";
import { callRpc, loadLocations } from "@/server/queries";
import { chosenLocation, readList } from "@/lib/list";
import { formatDateTime, formatMoney } from "@/lib/format";
import { operationStatusLabel, operationTypeLabel } from "@/lib/labels";
import { Denied, Field, Filters, PageHeader, Panel, StatusBadge, controlClass } from "@/components/bits";
import { SplitCharts, TurnoverChart } from "@/components/dashboard-charts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Snapshot = {
  from: string;
  to: string;
  balances: { location_name: string; cashbox_name: string; code: string; balance: string }[];
  company_balances: { code: string; symbol: string; balance: string }[];
  exchange_volume_rub: string;
  operation_count: number;
  debts: { code: string; receivable: string; payable: string }[];
  commissions: { code: string; amount: string }[];
  in_transit: { code: string; amount: string }[];
  recent: { id: string; number: string; type: string; status: string; location: string; counterparty: string | null; amount_from: string | null; code_from: string | null; amount_to: string | null; code_to: string | null; created_at: string }[];
  week: { day: string; volume: string }[];
  month: { day: string; volume: string }[];
  by_currency: { code: string; amount: string }[];
  by_location: { location: string; volume: string }[];
};

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  if (!session.can("dashboard.view")) return <Denied />;
  const params = readList(await searchParams);
  const period = params.period || "today";
  const preferred = await selectedLocation(session);
  const location = chosenLocation(params.location, preferred);
  const [snapshot, locations] = await Promise.all([
    callRpc<Snapshot>("dashboard_snapshot", {
      p_period: period,
      p_from: params.from || null,
      p_to: params.to || null,
      p_location: location,
    }),
    loadLocations(),
  ]);
  const visible = locations.filter((item) => session.canLocation(item.id));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Главная панель"
        description="Остатки читаются из финансового журнала. Оборот — это объём обмена, а не прибыль."
        actions={session.can("operations.create") ? <Button asChild><Link href="/operations/new">Новый обмен</Link></Button> : undefined}
      />
      <Filters pathname="/">
        <Field label="Период">
          <select className={controlClass} name="period" defaultValue={period}>
            <option value="today">Сегодня</option>
            <option value="yesterday">Вчера</option>
            <option value="week">Неделя</option>
            <option value="month">Месяц</option>
            <option value="custom">Произвольный</option>
          </select>
        </Field>
        <Field label="С"><Input className="h-10" type="date" name="from" defaultValue={params.from} /></Field>
        <Field label="По"><Input className="h-10" type="date" name="to" defaultValue={params.to} /></Field>
        <Field label="Точка">
          <select className={controlClass} name="location" defaultValue={params.location || preferred || "all"}>
            <option value="all">Все доступные</option>
            {visible.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </Field>
      </Filters>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Оборот за период" value={formatMoney(snapshot.exchange_volume_rub, "RUB")} hint={`${snapshot.from} — ${snapshot.to}`} />
        <Metric label="Проведено операций" value={String(snapshot.operation_count)} hint="Только проведённые документы" />
        <Metric label="Комиссия" value={snapshot.commissions.map((item) => formatMoney(item.amount, item.code)).join(" · ") || "0"} hint="Не включает объём обмена" />
        <Metric label="В пути" value={snapshot.in_transit.map((item) => formatMoney(item.amount, item.code)).join(" · ") || "0"} hint="Отправлено и ещё не получено" />
      </div>
      <Panel className="p-5">
        <h2 className="mb-4 font-medium">Баланс компании по валютам</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {snapshot.company_balances.map((item) => (
            <div key={item.code} className="rounded-xl bg-background/50 p-4">
              <p className="text-xs text-muted-foreground">{item.code}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(item.balance, item.code)}</p>
            </div>
          ))}
        </div>
      </Panel>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel className="p-5">
          <h2 className="mb-3 font-medium">Точки и кассы</h2>
          <div className="space-y-2">
            {snapshot.balances.map((item) => (
              <div key={`${item.cashbox_name}-${item.code}`} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">{item.location_name} · {item.cashbox_name}</span>
                <span className="tabular-nums">{formatMoney(item.balance, item.code)}</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel className="p-5">
          <h2 className="mb-3 font-medium">Открытые долги</h2>
          <p className="mb-3 text-xs text-muted-foreground">Положительное направление — нам должны. Отрицательное в карточке контрагента — мы должны. Валюты не складываются.</p>
          <div className="space-y-3">
            {snapshot.debts.length === 0 && <p className="text-sm text-muted-foreground">Открытых долгов нет.</p>}
            {snapshot.debts.map((item) => (
              <div key={item.code} className="grid grid-cols-2 gap-2 text-sm">
                <span>Нам должны {formatMoney(item.receivable, item.code)}</span>
                <span>Мы должны {formatMoney(item.payable, item.code)}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
      <Panel className="p-5">
        <div className="grid gap-6 lg:grid-cols-2">
          <TurnoverChart title="Оборот за неделю" points={snapshot.week} />
          <TurnoverChart title="Оборот за месяц" points={snapshot.month} />
        </div>
        <SplitCharts currencies={snapshot.by_currency} locations={snapshot.by_location} />
      </Panel>
      <Panel>
        <div className="flex items-center justify-between px-5 py-4">
          <h2 className="font-medium">Последние операции</h2>
          <Link href="/operations" className="text-sm text-primary">Все операции</Link>
        </div>
        <div className="divide-y divide-border/70">
          {snapshot.recent.map((item) => (
            <Link key={item.id} href={`/operations/${item.id}`} className="grid gap-1 px-5 py-3 text-sm hover:bg-muted/40 md:grid-cols-[140px_1fr_1fr_auto]">
              <span className="font-medium">{item.number}</span>
              <span className="text-muted-foreground">{item.location} · {item.counterparty ?? operationTypeLabel[item.type]}</span>
              <span className="tabular-nums">{formatMoney(item.amount_from, item.code_from ?? undefined)} → {formatMoney(item.amount_to, item.code_to ?? undefined)}</span>
              <StatusBadge status={item.status} label={operationStatusLabel[item.status] ?? item.status} />
              <span className="text-xs text-muted-foreground md:col-span-4">{formatDateTime(item.created_at)}</span>
            </Link>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Panel className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-2 text-xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </Panel>
  );
}
