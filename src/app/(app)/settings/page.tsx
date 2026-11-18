import { requireSession } from "@/server/session";
import { loadSettings } from "@/server/queries";
import { PageHeader, Panel } from "@/components/bits";
import { SettingsForm } from "@/components/action-dialogs";

export default async function SettingsPage() {
  const session = await requireSession();
  const settings = await loadSettings();
  return (
    <div className="space-y-5">
      <PageHeader title="Настройки" description="Закрытая система компании. Пароли хранит Supabase Auth, сервисный ключ не попадает в браузер." />
      <Panel className="p-5">
        <SettingsForm
          companyName={settings.company_name || "VALORA"}
          legalName={settings.legal_name || ""}
          fullName={session.profile.full_name}
          canManage={session.can("settings.manage")}
        />
      </Panel>
    </div>
  );
}
