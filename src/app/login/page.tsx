import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
import { isSupabaseConfigured } from "@/lib/env";
import { getSession } from "@/server/session";
import { LoginForm } from "@/components/login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  if (!isSupabaseConfigured()) redirect("/");
  const session = await getSession();
  if (session) redirect("/");
  const params = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-3xl border border-border/80 bg-card/80 p-8 shadow-2xl">
        <div className="mb-8 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary font-semibold text-primary-foreground">V</span>
          <div>
            <p className="text-sm font-semibold tracking-[0.18em]">VALORA</p>
            <p className="text-sm text-muted-foreground">Вход для сотрудников</p>
          </div>
        </div>
        {params.reason === "inactive" && (
          <p className="mb-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">Учётная запись отключена.</p>
        )}
        <LoginForm />
        <p className="mt-6 text-xs leading-5 text-muted-foreground">Публичной регистрации нет. Учётную запись создаёт администратор компании.</p>
      </div>
    </main>
  );
}
