import { requireSession } from "@/server/session";
import { loadCurrencies, loadRateHistory, loadRates } from "@/server/queries";
import { formatDateTime, formatMoney } from "@/lib/format";
import { Denied, PageHeader, Panel, StatusBadge } from "@/components/bits";
import { RateEditor } from "@/components/action-dialogs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default async function RatesPage() {
  const session = await requireSession();
  if (!session.can("rates.view")) return <Denied />;
  const [rates, history, currencies] = await Promise.all([loadRates(), loadRateHistory(), loadCurrencies()]);
  return (
    <div className="space-y-5">
      <PageHeader title="Валюты и курсы" description="Новый курс добавляется отдельной записью и начинает действовать с указанного времени. Уже проведённые операции хранят свой курс." />
      {session.can("rates.manage") && <RateEditor currencies={currencies} />}
      <Panel>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Пара</TableHead>
              <TableHead>Покупка</TableHead>
              <TableHead>Продажа</TableHead>
              <TableHead>Действует с</TableHead>
              <TableHead>Кто установил</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rates.map((rate) => (
              <TableRow key={rate.id}>
                <TableCell>{rate.base_code}/{rate.quote_code}</TableCell>
                <TableCell className="tabular-nums">{formatMoney(rate.buy_rate, rate.quote_code, 4)}</TableCell>
                <TableCell className="tabular-nums">{formatMoney(rate.sell_rate, rate.quote_code, 4)}</TableCell>
                <TableCell>{formatDateTime(rate.effective_at)}</TableCell>
                <TableCell>{rate.created_by_name ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>
      <Panel>
        <h2 className="px-5 py-4 font-medium">История изменений</h2>
        <div className="divide-y divide-border/70 text-sm">
          {history.map((row) => (
            <div key={row.id} className="grid gap-1 px-5 py-3 md:grid-cols-4">
              <span>{row.base}/{row.quote}</span>
              <span>покупка {row.buy_rate}</span>
              <span>продажа {row.sell_rate}</span>
              <span className="text-muted-foreground">{formatDateTime(row.effective_at)} · {row.author}</span>
            </div>
          ))}
        </div>
      </Panel>
      <Panel className="p-5">
        <h2 className="mb-3 font-medium">Справочник валют</h2>
        <div className="flex flex-wrap gap-2">
          {currencies.map((currency) => (
            <StatusBadge key={currency.id} status={currency.is_active ? "active" : "archived"} label={`${currency.code} ${currency.symbol} · ${currency.is_active ? "включена" : "отключена"}`} />
          ))}
        </div>
      </Panel>
    </div>
  );
}
