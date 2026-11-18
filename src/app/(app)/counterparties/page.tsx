import Link from "next/link";
import { requireSession } from "@/server/session";
import { loadCounterparties, loadCounterpartyBalances } from "@/server/queries";
import { readList } from "@/lib/list";
import { formatMoney } from "@/lib/format";
import { Denied, Empty, Field, Filters, PageHeader, Panel, StatusBadge } from "@/components/bits";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default async function CounterpartiesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  if (!session.can("counterparties.view")) return <Denied />;
  const params = readList(await searchParams);
  const [people, balances] = await Promise.all([loadCounterparties(params.q), loadCounterpartyBalances()]);
  return (
    <div className="space-y-5">
      <PageHeader title="Контрагенты" description="Баланс каждого человека хранится отдельно по валютам. Плюс — он должен компании, минус — компания должна ему." />
      <Filters pathname="/counterparties">
        <Field label="Поиск"><Input className="h-10" name="q" defaultValue={params.q} placeholder="Имя" /></Field>
      </Filters>
      <Panel>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Имя</TableHead>
              <TableHead>Телефон</TableHead>
              <TableHead>Позиция</TableHead>
              <TableHead>Статус</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {people.length === 0 && <TableRow><TableCell colSpan={4}><Empty title="Контрагентов нет" text="Создайте контрагента из формы обмена или откройте карточку позже." /></TableCell></TableRow>}
            {people.map((person) => {
              const own = balances.filter((item) => item.counterparty_id === person.id);
              return (
                <TableRow key={person.id}>
                  <TableCell><Link className="font-medium text-primary" href={`/counterparties/${person.id}`}>{person.name}</Link></TableCell>
                  <TableCell>{person.phone ?? "—"}</TableCell>
                  <TableCell className="tabular-nums">{own.length ? own.map((item) => formatMoney(item.signed_balance, item.currency_code)).join(" · ") : "0"}</TableCell>
                  <TableCell><StatusBadge status={person.status} label={person.status === "active" ? "Активен" : "В архиве"} /></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Panel>
    </div>
  );
}
