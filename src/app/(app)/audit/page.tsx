import { requireSession } from "@/server/session";
import { listAudit, loadAuditAuthors } from "@/server/queries";
import { readList } from "@/lib/list";
import { formatDateTime } from "@/lib/format";
import { Denied, Empty, Field, Filters, PageHeader, Panel, Pager, SortLink } from "@/components/bits";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  if (!session.can("audit.view")) return <Denied />;
  const params = readList(await searchParams);
  const [{ rows, count }, authors] = await Promise.all([listAudit(params), loadAuditAuthors()]);
  return (
    <div className="space-y-5">
      <PageHeader title="История действий" description="Журнал нельзя удалить из интерфейса. Здесь видно, кто провёл, отменил, изменил курс, контрагента, права или подтвердил перестановку." />
      <Filters pathname="/audit">
        <Field label="Поиск"><Input className="h-10" name="q" defaultValue={params.q} placeholder="Действие" /></Field>
        <Field label="С"><Input className="h-10" type="date" name="from" defaultValue={params.from} /></Field>
        <Field label="По"><Input className="h-10" type="date" name="to" defaultValue={params.to} /></Field>
      </Filters>
      <Panel>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead><SortLink pathname="/audit" params={params} column="created_at">Когда</SortLink></TableHead>
              <TableHead>Кто</TableHead>
              <TableHead><SortLink pathname="/audit" params={params} column="action">Действие</SortLink></TableHead>
              <TableHead>Объект</TableHead>
              <TableHead>Изменение</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={5}><Empty title="Записей нет" text="Журнал появится после первых действий сотрудников." /></TableCell></TableRow>}
            {rows.map((row) => (
              <TableRow key={String(row.id)}>
                <TableCell>{formatDateTime(String(row.created_at))}</TableCell>
                <TableCell>{authors.get(String(row.user_id)) ?? "—"}</TableCell>
                <TableCell>{String(row.action)}</TableCell>
                <TableCell>{String(row.entity_type)}</TableCell>
                <TableCell className="max-w-xs truncate text-xs text-muted-foreground">{JSON.stringify(row.new_values ?? {})}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Pager pathname="/audit" params={params} count={count} />
      </Panel>
    </div>
  );
}
