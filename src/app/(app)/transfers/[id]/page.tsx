import { notFound } from "next/navigation";
import { requireSession } from "@/server/session";
import { getTransfer } from "@/server/queries";
import { formatDateTime, formatMoney } from "@/lib/format";
import { transferStatusLabel } from "@/lib/labels";
import { Denied, PageHeader, Panel, StatusBadge } from "@/components/bits";
import { CancelDocument, TransferStepButtons } from "@/components/action-dialogs";

export default async function TransferPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session.can("transfers.view")) return <Denied />;
  const { id } = await params;
  const { transfer, events } = await getTransfer(id);
  if (!transfer) notFound();
  const status = String(transfer.status);
  const canSend = status === "created" && session.can("transfers.send") && session.canLocation(String(transfer.from_location_id));
  const canReceive = status === "sent" && session.can("transfers.receive") && session.canLocation(String(transfer.to_location_id));
  const canCancel = (status === "created" || status === "sent") && session.can("transfers.cancel") && session.canLocation(String(transfer.from_location_id));
  return (
    <div className="space-y-5">
      <PageHeader
        title={String(transfer.transfer_number)}
        description={`${transfer.from_name} → ${transfer.to_name}`}
        actions={
          <>
            <StatusBadge status={status} label={transferStatusLabel[status] ?? status} />
            {(canSend || canReceive) && <TransferStepButtons id={String(transfer.id)} status={status} />}
            {canCancel && <CancelDocument id={String(transfer.id)} kind="transfer" />}
          </>
        }
      />
      <Panel className="grid gap-2 p-5 text-sm md:grid-cols-2">
        <p>Отправлено: {formatMoney(transfer.amount as string, String(transfer.currency_code))}</p>
        <p>Комиссия: {formatMoney(transfer.commission as string, String(transfer.currency_code))}</p>
        <p>К получению: {formatMoney(transfer.net_amount as string, String(transfer.currency_code))}</p>
        <p>Создал: {String(transfer.created_by_name ?? "—")}</p>
        <p>Отправлено: {formatDateTime(transfer.sent_at ? String(transfer.sent_at) : null)}</p>
        <p>Получил: {String(transfer.received_by_name ?? "—")} · {formatDateTime(transfer.received_at ? String(transfer.received_at) : null)}</p>
        {transfer.comment ? <p className="md:col-span-2">{String(transfer.comment)}</p> : null}
        {transfer.cancel_reason ? <p className="md:col-span-2 text-destructive">{String(transfer.cancel_reason)}</p> : null}
      </Panel>
      <Panel>
        <h2 className="px-5 py-4 font-medium">История статусов</h2>
        <div className="divide-y divide-border/70 text-sm">
          {events.map((event) => {
            const actor = event.profiles;
            const name = Array.isArray(actor) ? (actor[0] as { full_name?: string } | undefined)?.full_name : (actor as { full_name?: string } | null)?.full_name;
            return (
              <div key={String(event.id)} className="grid gap-1 px-5 py-3 md:grid-cols-3">
                <span>{formatDateTime(String(event.created_at))}</span>
                <span>{transferStatusLabel[String(event.status)] ?? String(event.status)}</span>
                <span className="text-muted-foreground">{name ?? "—"} · {String(event.comment ?? "")}</span>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
