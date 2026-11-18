import { isSupabaseConfigured } from "@/lib/env";
import { requireSession, selectedLocation } from "@/server/session";
import { loadLocations, loadSettings, pendingTransfers } from "@/server/queries";
import { AppShell } from "@/components/shell";

export const dynamic = "force-dynamic";

export default async function ApplicationLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured()) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6">
        <p className="text-sm font-semibold tracking-[0.18em] text-primary">VALORA</p>
        <h1 className="mt-3 text-3xl font-semibold">Нужны ключи Supabase</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Скопируйте .env.example в .env.local и заполните NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY и серверный SUPABASE_SECRET_KEY. Затем примените миграции и выполните npm run seed.
        </p>
      </main>
    );
  }

  const session = await requireSession();
  const [locations, settings, notices] = await Promise.all([
    loadLocations(),
    loadSettings(),
    session.can("transfers.view") ? pendingTransfers() : Promise.resolve([]),
  ]);
  const visible = locations.filter((location) => session.canLocation(location.id));
  const active = await selectedLocation(session);

  return (
    <AppShell
      company={settings.company_name || "VALORA"}
      fullName={session.profile.full_name}
      role={session.profile.role}
      locations={visible}
      activeLocation={active}
      notices={notices}
      allowed={session.actions}
    >
      {settings.demo_seeded === "true" && (
        <p className="mb-5 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2 text-sm text-primary">
          Показаны демонстрационные данные DEMO. Это не рабочие остатки компании.
        </p>
      )}
      {children}
    </AppShell>
  );
}
