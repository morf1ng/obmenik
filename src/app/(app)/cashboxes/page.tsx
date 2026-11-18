import Link from "next/link";
import { requireSession } from "@/server/session";
import { loadCashboxes } from "@/server/queries";
import { formatDateTime, formatMoney } from "@/lib/format";
import { Denied, PageHeader, Panel, StatusBadge } from "@/components/bits";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default async function CashboxesPage() {
  const session = await requireSession();
  if (!session.can("cashboxes.view")) return <Denied />;
  const cashboxes = await loadCashboxes();
  return (
    <div className="space-y-5">
      <PageHeader title="Кассы" description="У каждой точки своя касса на валюту. Остаток — сумма проведённых записей, его нельзя вписать руками." />
      <Panel>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Касса</TableHead>
              <TableHead>Точка</TableHead>
              <TableHead>Валюта</TableHead>
              <TableHead>Остаток</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Создана</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cashboxes.map((box) => (
              <TableRow key={box.id}>
                <TableCell><Link className="font-medium text-primary" href={`/cashboxes/${box.id}`}>{box.name}</Link></TableCell>
                <TableCell>{box.location_name}</TableCell>
                <TableCell>{box.currency_code}</TableCell>
                <TableCell className="tabular-nums">{formatMoney(box.balance, box.currency_code, box.currency_precision)}</TableCell>
                <TableCell><StatusBadge status={box.is_active ? "active" : "archived"} label={box.is_active ? "Активна" : "Отключена"} /></TableCell>
                <TableCell>{formatDateTime(box.created_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>
    </div>
  );
}
