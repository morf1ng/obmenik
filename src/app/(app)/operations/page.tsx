import Link from "next/link";
import { requireSession } from "@/server/session";
import { listOperations, loadCurrencies, loadLocations } from "@/server/queries";
import { readList } from "@/lib/list";
import { formatDateTime, formatMoney } from "@/lib/format";
import { operationStatusLabel, operationTypeLabel } from "@/lib/labels";
import { Denied, Empty, Field, Filters, PageHeader, Panel, Pager, SortLink, StatusBadge, controlClass } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default async function OperationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  if (!session.can("operations.view")) return <Denied />;
  const params = readList(await searchParams);
  const [{ rows, count }, locations, currencies] = await Promise.all([listOperations(params), loadLocations(), loadCurrencies()]);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Операции"
        description="Проведённый документ нельзя удалить. Исправление делается отменой с причиной."
        actions={session.can("operations.create") ? <Button asChild><Link href="/operations/new">Новый обмен</Link></Button> : undefined}
      />
      <Filters pathname="/operations">
        <Field label="Поиск"><Input className="h-10" name="q" defaultValue={params.q} placeholder="Номер, контрагент" /></Field>
        <Field label="Статус">
          <select className={controlClass} name="status" defaultValue={params.status}>
            <option value="">Все</option>
            <option value="draft">Черновик</option>
            <option value="posted">Проведена</option>
            <option value="cancelled">Отменена</option>
          </select>
        </Field>
        <Field label="Точка">
          <select className={controlClass} name="location" defaultValue={params.location}>
            <option value="">Все</option>
            {locations.filter((item) => session.canLocation(item.id)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </Field>
        <Field label="Валюта">
          <select className={controlClass} name="currency" defaultValue={params.currency}>
            <option value="">Все</option>
            {currencies.map((item) => <option key={item.id} value={item.code}>{item.code}</option>)}
          </select>
        </Field>
        <Field label="С"><Input className="h-10" type="date" name="from" defaultValue={params.from} /></Field>
        <Field label="По"><Input className="h-10" type="date" name="to" defaultValue={params.to} /></Field>
      </Filters>
      <Panel>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead><SortLink pathname="/operations" params={params} column="operation_number">Номер</SortLink></TableHead>
              <TableHead>Тип</TableHead>
              <TableHead>Точка</TableHead>
              <TableHead>Контрагент</TableHead>
              <TableHead><SortLink pathname="/operations" params={params} column="amount_from">Суммы</SortLink></TableHead>
              <TableHead>Статус</TableHead>
              <TableHead><SortLink pathname="/operations" params={params} column="created_at">Дата</SortLink></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={7}><Empty title="Операций нет" text="Измените фильтр или проведите первый обмен." /></TableCell></TableRow>}
            {rows.map((row) => (
              <TableRow key={String(row.id)}>
                <TableCell><Link className="font-medium text-primary" href={`/operations/${row.id}`}>{String(row.operation_number)}</Link></TableCell>
                <TableCell>{operationTypeLabel[String(row.type)] ?? String(row.type)}</TableCell>
                <TableCell>{String(row.location_name ?? "")}</TableCell>
                <TableCell>{String(row.counterparty_name ?? "—")}</TableCell>
                <TableCell className="tabular-nums">{formatMoney(row.amount_from as string, String(row.code_from ?? ""))}{row.amount_to ? ` → ${formatMoney(row.amount_to as string, String(row.code_to ?? ""))}` : ""}</TableCell>
                <TableCell><StatusBadge status={String(row.status)} label={operationStatusLabel[String(row.status)] ?? String(row.status)} /></TableCell>
                <TableCell>{formatDateTime(String(row.created_at))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Pager pathname="/operations" params={params} count={count} />
      </Panel>
    </div>
  );
}
