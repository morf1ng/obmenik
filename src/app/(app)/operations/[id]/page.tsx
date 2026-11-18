import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/server/session";
import { getOperation, loadCashboxes, loadCurrencies } from "@/server/queries";
import { formatDateTime, formatMoney } from "@/lib/format";
import { operationStatusLabel, operationTypeLabel } from "@/lib/labels";
import { Denied, PageHeader, Panel, StatusBadge } from "@/components/bits";
import { CancelDocument, PostDraftButton } from "@/components/action-dialogs";

export default async function OperationPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session.can("operations.view")) return <Denied />;
  const { id } = await params;
  const [{ operation, entries }, currencies, cashboxes] = await Promise.all([getOperation(id), loadCurrencies(), loadCashboxes()]);
  if (!operation) notFound();
  const currency = new Map(currencies.map((item) => [item.id, item.code]));
  const box = new Map(cashboxes.map((item) => [item.id, item.name]));
  const status = String(operation.status);
  return (
    <div className="space-y-5">
      <PageHeader
        title={String(operation.operation_number)}
        description={`${operationTypeLabel[String(operation.type)] ?? ""} · ${operation.location_name ?? ""}`}
        actions={
          <>
            <StatusBadge status={status} label={operationStatusLabel[status] ?? status} />
            {status === "draft" && session.can("operations.post") && operation.cashbox_in_id && operation.cashbox_out_id && (
              <PostDraftButton
                draft={{
                  id: String(operation.id),
                  location_id: String(operation.location_id),
                  cashbox_in_id: String(operation.cashbox_in_id),
                  cashbox_out_id: String(operation.cashbox_out_id),
                  counterparty_id: String(operation.counterparty_id),
                  amount_from: String(operation.amount_from),
                  exchange_rate: String(operation.exchange_rate),
                  commission: String(operation.commission ?? "0"),
                  commission_currency_id: operation.commission_currency_id ? String(operation.commission_currency_id) : null,
                  comment: operation.comment ? String(operation.comment) : null,
                }}
              />
            )}
            {status === "posted" && session.can("operations.cancel") && <CancelDocument id={String(operation.id)} kind="operation" />}
          </>
        }
      />
      <Panel className="grid gap-3 p-5 text-sm md:grid-cols-2">
        <p>Контрагент: {operation.counterparty_id ? <Link className="text-primary" href={`/counterparties/${operation.counterparty_id}`}>{String(operation.counterparty_name ?? "")}</Link> : "—"}</p>
        <p>Сотрудник: {String(operation.created_by_name ?? "—")}</p>
        <p>Отдано: {formatMoney(operation.amount_from as string, String(operation.code_from ?? ""))}</p>
        <p>Получено: {formatMoney(operation.amount_to as string, String(operation.code_to ?? ""))}</p>
        <p>Курс в операции: {String(operation.exchange_rate ?? "—")}</p>
        <p>Комиссия: {formatMoney(operation.commission as string, String(operation.commission_code ?? ""))}</p>
        <p>Создано: {formatDateTime(String(operation.created_at))}</p>
        <p>Проведено: {formatDateTime(operation.posted_at ? String(operation.posted_at) : null)}</p>
        {operation.comment ? <p className="md:col-span-2">Комментарий: {String(operation.comment)}</p> : null}
        {operation.cancel_reason ? <p className="md:col-span-2 text-destructive">Причина отмены: {String(operation.cancel_reason)}</p> : null}
      </Panel>
      <Panel>
        <h2 className="px-5 py-4 font-medium">Проводки</h2>
        <div className="divide-y divide-border/70 text-sm">
          {entries.length === 0 && <p className="px-5 py-6 text-muted-foreground">Проводок нет: документ ещё не проведён.</p>}
          {entries.map((entry) => (
            <div key={String(entry.id)} className="grid gap-1 px-5 py-3 md:grid-cols-4">
              <span>{formatDateTime(String(entry.created_at))}</span>
              <span>{entry.cashbox_id ? box.get(String(entry.cashbox_id)) ?? "Касса" : "Доход комиссии"}</span>
              <span>{String(entry.entry_type)} · {entry.direction === "in" ? "приход" : "расход"}</span>
              <span className="tabular-nums">{formatMoney(entry.amount as string, currency.get(String(entry.currency_id)))}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
