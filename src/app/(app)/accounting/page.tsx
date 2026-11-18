import { requireSession, selectedLocation } from "@/server/session";
import { callRpc, loadLocations } from "@/server/queries";
import { chosenLocation, readList } from "@/lib/list";
import { formatDateTime, formatMoney } from "@/lib/format";
import { Denied, Field, Filters, PageHeader, Panel, controlClass } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Report = {
  from: string;
  to: string;
  turnover_rub: string;
  exchange_count: number;
  commissions: { code: string; amount: string }[];
  expenses: { code: string; amount: string }[];
  result: { code: string; amount: string }[];
  cashboxes: { id: string; name: string; location: string; code: string; balance: string; inflow: string; outflow: string }[];
  locations: { location: string; volume: string; count: number }[];
  currencies: { code: string; incoming: string; count: number }[];
  movements: { id: string; at: string; type: string; direction: string; amount: string; code: string; cashbox: string | null; description: string | null; actor: string | null }[];
};

export default async function AccountingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  if (!session.can("accounting.view")) return <Denied />;
  const params = readList(await searchParams, "created_at");
  const period = params.period || "month";
  const preferred = await selectedLocation(session);
  const location = chosenLocation(params.location, preferred);
  const [report, locations] = await Promise.all([
    callRpc<Report>("accounting_report", {
      p_period: period,
      p_from: params.from || null,
      p_to: params.to || null,
      p_location: location || null,
    }),
    loadLocations(),
  ]);
  const query = new URLSearchParams({ period, from: params.from, to: params.to, location: location ?? "all" });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Бухгалтерия"
        description="Фактический оборот, комиссионный доход и финансовый результат показаны раздельно. Объём обмена не является прибылью."
        actions={session.can("accounting.export") ? (
          <>
            <Button variant="outline" asChild><a href={`/api/export?kind=accounting&format=csv&${query}`}>CSV</a></Button>
            <Button variant="outline" asChild><a href={`/api/export?kind=accounting&format=xlsx&${query}`}>Excel</a></Button>
          </>
        ) : undefined}
      />
      <Filters pathname="/accounting">
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
            <option value="all">Все</option>
            {locations.filter((item) => session.canLocation(item.id)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </Field>
      </Filters>
      <div className="grid gap-3 md:grid-cols-3">
        <Panel className="p-4"><p className="text-xs text-muted-foreground">Фактический оборот</p><p className="mt-2 text-2xl font-semibold">{formatMoney(report.turnover_rub, "RUB")}</p><p className="text-xs text-muted-foreground">{report.exchange_count} обменов</p></Panel>
        <Panel className="p-4"><p className="text-xs text-muted-foreground">Комиссионный доход</p><p className="mt-2 text-sm">{lines(report.commissions)}</p></Panel>
        <Panel className="p-4"><p className="text-xs text-muted-foreground">Результат: комиссия минус расходы</p><p className="mt-2 text-sm">{lines(report.result)}</p></Panel>
      </div>
      <Tabs defaultValue="income">
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="income">Доходы</TabsTrigger>
          <TabsTrigger value="expense">Расходы</TabsTrigger>
          <TabsTrigger value="moves">Движения</TabsTrigger>
          <TabsTrigger value="turn">Обороты</TabsTrigger>
          <TabsTrigger value="cash">Кассы</TabsTrigger>
          <TabsTrigger value="points">Точки</TabsTrigger>
          <TabsTrigger value="fx">Валюты</TabsTrigger>
        </TabsList>
        <TabsContent value="income"><MoneyList title="Комиссии по валютам" rows={report.commissions} /></TabsContent>
        <TabsContent value="expense"><MoneyList title="Кассовые расходы" rows={report.expenses} /></TabsContent>
        <TabsContent value="moves">
          <Panel className="divide-y divide-border/70 text-sm">
            {report.movements.map((row) => (
              <div key={row.id} className="grid gap-1 px-5 py-3 md:grid-cols-4">
                <span>{formatDateTime(row.at)}</span>
                <span>{row.cashbox ?? "Вне кассы"} · {row.type}</span>
                <span>{row.direction === "in" ? "+" : "−"}{formatMoney(row.amount, row.code)}</span>
                <span className="text-muted-foreground">{row.actor} · {row.description}</span>
              </div>
            ))}
          </Panel>
        </TabsContent>
        <TabsContent value="turn"><MoneyList title="Оборот не равен прибыли" rows={[{ code: "RUB", amount: report.turnover_rub }]} /></TabsContent>
        <TabsContent value="cash">
          <Panel className="divide-y divide-border/70 text-sm">
            {report.cashboxes.map((row) => (
              <div key={row.id} className="grid gap-1 px-5 py-3 md:grid-cols-4">
                <span>{row.location}</span>
                <span>{row.name}</span>
                <span>Приход {formatMoney(row.inflow, row.code)} · расход {formatMoney(row.outflow, row.code)}</span>
                <span className="tabular-nums">Остаток {formatMoney(row.balance, row.code)}</span>
              </div>
            ))}
          </Panel>
        </TabsContent>
        <TabsContent value="points">
          <Panel className="divide-y divide-border/70 text-sm">
            {report.locations.map((row) => (
              <div key={row.location} className="flex justify-between px-5 py-3">
                <span>{row.location} · {row.count} обменов</span>
                <span>{formatMoney(row.volume, "RUB")}</span>
              </div>
            ))}
          </Panel>
        </TabsContent>
        <TabsContent value="fx">
          <Panel className="divide-y divide-border/70 text-sm">
            {report.currencies.map((row) => (
              <div key={row.code} className="flex justify-between px-5 py-3">
                <span>{row.code} · {row.count}</span>
                <span>Входящий объём {formatMoney(row.incoming, row.code)}</span>
              </div>
            ))}
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function lines(rows: { code: string; amount: string }[]) {
  if (!rows.length) return "0";
  return rows.map((row) => formatMoney(row.amount, row.code)).join(" · ");
}

function MoneyList({ title, rows }: { title: string; rows: { code: string; amount: string }[] }) {
  return (
    <Panel>
      <h2 className="px-5 py-4 font-medium">{title}</h2>
      <div className="divide-y divide-border/70 text-sm">
        {rows.length === 0 && <p className="px-5 py-6 text-muted-foreground">За период суммы нет.</p>}
        {rows.map((row) => (
          <div key={row.code} className="flex justify-between px-5 py-3">
            <span>{row.code}</span>
            <span className="tabular-nums">{formatMoney(row.amount, row.code)}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}
