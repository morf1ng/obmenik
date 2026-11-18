import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/server/session";
import { getCounterparty } from "@/server/queries";
import { formatDateTime, formatMoney } from "@/lib/format";
import { debtDirectionLabel, debtStatusLabel, operationStatusLabel } from "@/lib/labels";
import { Denied, PageHeader, Panel, StatusBadge } from "@/components/bits";
import { CounterpartyEditor } from "@/components/action-dialogs";

export default async function CounterpartyPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session.can("counterparties.view")) return <Denied />;
  const { id } = await params;
  const { counterparty, balances, operations, debts } = await getCounterparty(id);
  if (!counterparty) notFound();
  return (
    <div className="space-y-5">
      <PageHeader title={String(counterparty.name)} description={String(counterparty.phone ?? "Телефон не указан")} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {["RUB", "USD", "EUR", "USDT"].map((code) => {
          const row = balances.find((item) => item.currency_code === code);
          return (
            <Panel key={code} className="p-4">
              <p className="text-xs text-muted-foreground">{code}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{formatMoney(row?.signed_balance as string ?? "0", code)}</p>
              <p className="text-xs text-muted-foreground">{Number(row?.signed_balance ?? 0) < 0 ? "Компания должна" : "Контрагент должен или нуль"}</p>
            </Panel>
          );
        })}
      </div>
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        {session.can("counterparties.manage") && (
          <Panel className="p-5">
            <CounterpartyEditor
              id={String(counterparty.id)}
              name={String(counterparty.name)}
              phone={String(counterparty.phone ?? "")}
              comment={String(counterparty.comment ?? "")}
              status={String(counterparty.status)}
            />
          </Panel>
        )}
        <div className="space-y-4">
          <Panel>
            <h2 className="px-5 py-4 font-medium">Операции</h2>
            <div className="divide-y divide-border/70 text-sm">
              {operations.map((row) => (
                <Link key={String(row.id)} href={`/operations/${row.id}`} className="grid gap-1 px-5 py-3 md:grid-cols-3 hover:bg-muted/40">
                  <span>{String(row.operation_number)}</span>
                  <span className="tabular-nums">{formatMoney(row.amount_from as string, String(row.code_from ?? ""))}</span>
                  <StatusBadge status={String(row.status)} label={operationStatusLabel[String(row.status)] ?? String(row.status)} />
                </Link>
              ))}
              {operations.length === 0 && <p className="px-5 py-6 text-muted-foreground">Операций пока нет.</p>}
            </div>
          </Panel>
          <Panel>
            <h2 className="px-5 py-4 font-medium">Долги</h2>
            <div className="divide-y divide-border/70 text-sm">
              {debts.map((row) => (
                <div key={String(row.id)} className="grid gap-1 px-5 py-3 md:grid-cols-4">
                  <span>{String(row.debt_number)}</span>
                  <span>{debtDirectionLabel[String(row.direction)]}</span>
                  <span className="tabular-nums">{formatMoney(row.remaining_amount as string, String(row.currency_code))} из {formatMoney(row.amount as string, String(row.currency_code))}</span>
                  <StatusBadge status={String(row.status)} label={debtStatusLabel[String(row.status)] ?? String(row.status)} />
                  <span className="text-xs text-muted-foreground md:col-span-4">{formatDateTime(String(row.created_at))}</span>
                </div>
              ))}
              {debts.length === 0 && <p className="px-5 py-6 text-muted-foreground">Задолженностей нет.</p>}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
