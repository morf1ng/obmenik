import Link from "next/link";
import { requireSession } from "@/server/session";
import { listTransfers, loadCurrencies, loadLocations } from "@/server/queries";
import { readList } from "@/lib/list";
import { formatDateTime, formatMoney } from "@/lib/format";
import { transferStatusLabel } from "@/lib/labels";
import { Denied, Empty, Field, Filters, PageHeader, Panel, Pager, StatusBadge, controlClass } from "@/components/bits";
import { TransferForm } from "@/components/action-dialogs";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default async function TransfersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  if (!session.can("transfers.view")) return <Denied />;
  const params = readList(await searchParams);
  const [{ rows, count }, locations, currencies] = await Promise.all([listTransfers(params), loadLocations(), loadCurrencies()]);
  const visible = locations.filter((item) => session.canLocation(item.id));
  return (
    <div className="space-y-5">
      <PageHeader title="Перестановки" description="Отправка списывает кассу и кладёт чистую сумму на транзитный счёт. Получатель подтверждает приход. Комиссия — отдельная запись: отправлено = получено + комиссия." />
      {session.can("transfers.create") && <TransferForm locations={visible} currencies={currencies.filter((item) => item.is_active)} />}
      <Filters pathname="/transfers">
        <Field label="Поиск"><Input className="h-10" name="q" defaultValue={params.q} /></Field>
        <Field label="Статус">
          <select className={controlClass} name="status" defaultValue={params.status}>
            <option value="">Все</option>
            <option value="created">Создана</option>
            <option value="sent">Отправлена</option>
            <option value="received">Получена</option>
            <option value="cancelled">Отменена</option>
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
            {visible.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </Field>
      </Filters>
      <Panel>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Номер</TableHead>
              <TableHead>Маршрут</TableHead>
              <TableHead>Отправлено</TableHead>
              <TableHead>Комиссия</TableHead>
              <TableHead>К получению</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Дата</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={7}><Empty title="Перестановок нет" text="Создайте перемещение между Махачкалой и Москвой." /></TableCell></TableRow>}
            {rows.map((row) => (
              <TableRow key={String(row.id)}>
                <TableCell><Link className="font-medium text-primary" href={`/transfers/${row.id}`}>{String(row.transfer_number)}</Link></TableCell>
                <TableCell>{String(row.from_name)} → {String(row.to_name)}</TableCell>
                <TableCell className="tabular-nums">{formatMoney(row.amount as string, String(row.currency_code))}</TableCell>
                <TableCell className="tabular-nums">{formatMoney(row.commission as string, String(row.currency_code))}</TableCell>
                <TableCell className="tabular-nums">{formatMoney(row.net_amount as string, String(row.currency_code))}</TableCell>
                <TableCell><StatusBadge status={String(row.status)} label={transferStatusLabel[String(row.status)] ?? String(row.status)} /></TableCell>
                <TableCell>{formatDateTime(String(row.created_at))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Pager pathname="/transfers" params={params} count={count} />
      </Panel>
    </div>
  );
}
