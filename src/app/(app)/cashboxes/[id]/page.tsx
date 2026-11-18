import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/server/session";
import { callRpc, loadCashboxes } from "@/server/queries";
import { formatDateTime, formatMoney } from "@/lib/format";
import { Denied, Field, Filters, PageHeader, Panel } from "@/components/bits";
import { CashMovementDialog } from "@/components/action-dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Statement = {
  opening: string;
  closing: string;
  lines: { id: string; at: string; direction: string; amount: string; type: string; balance_after: string; description: string | null; actor: string | null; operation_id: string | null }[];
};

export default async function CashboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  if (!session.can("cashboxes.view")) return <Denied />;
  const { id } = await params;
  const query = await searchParams;
  const from = typeof query.from === "string" ? query.from : "";
  const to = typeof query.to === "string" ? query.to : "";
  const cashboxes = await loadCashboxes();
  const box = cashboxes.find((item) => item.id === id);
  if (!box) notFound();
  const statement = await callRpc<Statement>("cashbox_statement", {
    p_cashbox_id: id,
    p_from: from || null,
    p_to: to || null,
  });
  const canMove = session.can("cashboxes.move") || session.can("cashboxes.adjust");
  return (
    <div className="space-y-5">
      <PageHeader
        title={box.name}
        description={`${box.location_name} · ${box.currency_code}`}
        actions={
          <>
            <Button variant="outline" asChild><a href={`/api/export?kind=cashbox&id=${id}&from=${from}&to=${to}&format=csv`}>CSV</a></Button>
            <Button variant="outline" asChild><a href={`/api/export?kind=cashbox&id=${id}&from=${from}&to=${to}&format=xlsx`}>Excel</a></Button>
            {canMove && <CashMovementDialog cashboxId={box.id} code={box.currency_code} balance={formatMoney(box.balance, box.currency_code, box.currency_precision)} />}
          </>
        }
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Panel className="p-4"><p className="text-xs text-muted-foreground">Сейчас</p><p className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(box.balance, box.currency_code)}</p></Panel>
        <Panel className="p-4"><p className="text-xs text-muted-foreground">На начало периода</p><p className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(statement.opening, box.currency_code)}</p></Panel>
        <Panel className="p-4"><p className="text-xs text-muted-foreground">На конец периода</p><p className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(statement.closing, box.currency_code)}</p></Panel>
      </div>
      <Filters pathname={`/cashboxes/${id}`}>
        <Field label="С"><Input className="h-10" type="date" name="from" defaultValue={from} /></Field>
        <Field label="По"><Input className="h-10" type="date" name="to" defaultValue={to} /></Field>
      </Filters>
      <Panel>
        <div className="divide-y divide-border/70 text-sm">
          {statement.lines.length === 0 && <p className="px-5 py-8 text-muted-foreground">За период движений нет.</p>}
          {statement.lines.map((line) => (
            <div key={line.id} className="grid gap-1 px-5 py-3 md:grid-cols-[180px_1fr_140px_160px]">
              <span>{formatDateTime(line.at)}</span>
              <span>{line.description ?? line.type}{line.operation_id && <> · <Link className="text-primary" href={`/operations/${line.operation_id}`}>документ</Link></>}</span>
              <span className={line.direction === "in" ? "text-primary" : "text-destructive"}>{line.direction === "in" ? "+" : "−"}{formatMoney(line.amount, box.currency_code)}</span>
              <span className="tabular-nums text-muted-foreground">{formatMoney(line.balance_after, box.currency_code)}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
