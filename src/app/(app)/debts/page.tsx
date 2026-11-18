import { requireSession } from "@/server/session";
import { listDebts, loadCashboxes, loadCounterparties, loadCurrencies, loadLocations } from "@/server/queries";
import { readList } from "@/lib/list";
import { formatDateTime, formatMoney } from "@/lib/format";
import { debtDirectionLabel, debtStatusLabel } from "@/lib/labels";
import { Denied, Empty, Field, Filters, PageHeader, Panel, Pager, StatusBadge, controlClass } from "@/components/bits";
import { DebtForm, RepayDialog } from "@/components/action-dialogs";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default async function DebtsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  if (!session.can("debts.view")) return <Denied />;
  const params = readList(await searchParams);
  const [{ rows, count }, parties, currencies, locations, cashboxes] = await Promise.all([
    listDebts(params), loadCounterparties(), loadCurrencies(), loadLocations(), loadCashboxes(),
  ]);
  const visibleLocations = locations.filter((item) => session.canLocation(item.id));
  return (
    <div className="space-y-5">
      <PageHeader title="Реестр долгов" description="Нам должны — дебиторка. Мы должны — кредиторка. Разные валюты в одну сумму не складываются. Погашение создаёт кассовую проводку." />
      {session.can("debts.manage") && (
        <DebtForm counterparties={parties.filter((item) => item.status === "active")} currencies={currencies.filter((item) => item.is_active)} locations={visibleLocations} />
      )}
      <Filters pathname="/debts">
        <Field label="Поиск"><Input className="h-10" name="q" defaultValue={params.q} /></Field>
        <Field label="Направление">
          <select className={controlClass} name="direction" defaultValue={params.direction}>
            <option value="">Все</option>
            <option value="receivable">Нам должны</option>
            <option value="payable">Мы должны</option>
          </select>
        </Field>
        <Field label="Валюта">
          <select className={controlClass} name="currency" defaultValue={params.currency}>
            <option value="">Все</option>
            {currencies.map((item) => <option key={item.id} value={item.code}>{item.code}</option>)}
          </select>
        </Field>
        <Field label="Точка">
          <select className={controlClass} name="location" defaultValue={params.location}>
            <option value="">Все</option>
            {visibleLocations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </Field>
        <Field label="С"><Input className="h-10" type="date" name="from" defaultValue={params.from} /></Field>
        <Field label="По"><Input className="h-10" type="date" name="to" defaultValue={params.to} /></Field>
      </Filters>
      <Panel>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Номер</TableHead>
              <TableHead>Контрагент</TableHead>
              <TableHead>Направление</TableHead>
              <TableHead>Остаток</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Дата</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={7}><Empty title="Долгов нет" text="Реестр пуст для выбранного фильтра." /></TableCell></TableRow>}
            {rows.map((row) => {
              const matching = cashboxes.filter((box) => box.location_id === row.location_id && box.currency_code === row.currency_code && box.is_active);
              const open = row.status === "open" || row.status === "partial";
              return (
                <TableRow key={String(row.id)}>
                  <TableCell>{String(row.debt_number)}</TableCell>
                  <TableCell>{String(row.counterparty_name)}</TableCell>
                  <TableCell>{debtDirectionLabel[String(row.direction)]}</TableCell>
                  <TableCell className="tabular-nums">{formatMoney(row.remaining_amount as string, String(row.currency_code))} из {formatMoney(row.amount as string, String(row.currency_code))}</TableCell>
                  <TableCell><StatusBadge status={String(row.status)} label={debtStatusLabel[String(row.status)] ?? String(row.status)} /></TableCell>
                  <TableCell>{formatDateTime(String(row.created_at))}</TableCell>
                  <TableCell>
                    {open && session.can("debts.manage") && (
                      <RepayDialog debtId={String(row.id)} remaining={String(row.remaining_amount)} cashboxes={matching} />
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <Pager pathname="/debts" params={params} count={count} />
      </Panel>
    </div>
  );
}
