import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { pageHref, pageSize, type ListParams } from "@/lib/list";
import { statusVariant } from "@/lib/labels";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight md:text-[1.7rem]">{title}</h1>
        {description && <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-border/80 bg-card/75 shadow-[0_20px_60px_-40px_oklch(0.1_0.02_255/0.8)] ${className}`}>{children}</section>;
}

export function Denied() {
  return (
    <Panel className="p-8">
      <h1 className="text-xl font-semibold">Недостаточно прав</h1>
      <p className="mt-2 max-w-lg text-sm text-muted-foreground">Этот раздел закрыт для вашей роли. Если доступ нужен для работы, попросите администратора выдать право.</p>
    </Panel>
  );
}

export function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="px-6 py-14 text-center">
      <p className="font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

export function StatusBadge({ status, label }: { status: string; label: string }) {
  return <Badge variant={statusVariant(status)}>{label}</Badge>;
}

export function Filters({ pathname, children }: { pathname: string; children: React.ReactNode }) {
  return (
    <form action={pathname} className="flex flex-col gap-2 rounded-2xl border border-border/70 bg-card/50 p-3 md:flex-row md:flex-wrap md:items-end">
      {children}
      <Button type="submit" variant="secondary">Применить</Button>
      <Button variant="ghost" asChild>
        <Link href={pathname}>Сбросить</Link>
      </Button>
    </form>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export const controlClass =
  "h-10 w-full min-w-[160px] rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40";

export function Pager({ pathname, params, count }: { pathname: string; params: ListParams; count: number }) {
  const pages = Math.max(1, Math.ceil(count / pageSize));
  const from = count === 0 ? 0 : (params.page - 1) * pageSize + 1;
  const to = Math.min(count, params.page * pageSize);
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-muted-foreground">
      <span>
        {from}–{to} из {count}
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={params.page <= 1} asChild={params.page > 1}>
          {params.page > 1 ? <Link href={pageHref(pathname, params, { page: params.page - 1 })}>Назад</Link> : <span>Назад</span>}
        </Button>
        <Button variant="outline" size="sm" disabled={params.page >= pages} asChild={params.page < pages}>
          {params.page < pages ? <Link href={pageHref(pathname, params, { page: params.page + 1 })}>Дальше</Link> : <span>Дальше</span>}
        </Button>
      </div>
    </div>
  );
}

export function SortLink({ pathname, params, column, children }: { pathname: string; params: ListParams; column: string; children: React.ReactNode }) {
  const nextDir = params.sort === column && params.dir === "desc" ? "asc" : "desc";
  return (
    <Link href={pageHref(pathname, params, { sort: column, dir: nextDir, page: 1 })} className="hover:text-foreground">
      {children}
    </Link>
  );
}
