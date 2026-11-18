import { requireSession, selectedLocation } from "@/server/session";
import { loadCashboxes, loadCounterparties, loadCurrencies, loadLocations, loadRates } from "@/server/queries";
import { Denied, PageHeader } from "@/components/bits";
import { ExchangeForm } from "@/components/exchange-form";

export default async function NewOperationPage() {
  const session = await requireSession();
  if (!session.can("operations.create") && !session.can("operations.post")) return <Denied />;
  const [locations, currencies, cashboxes, counterparties, rates] = await Promise.all([
    loadLocations(),
    loadCurrencies(),
    loadCashboxes(),
    loadCounterparties(),
    loadRates(),
  ]);
  const visibleLocations = locations.filter((item) => item.is_active && session.canLocation(item.id));
  const active = await selectedLocation(session);
  return (
    <div className="space-y-5">
      <PageHeader title="Новый обмен" description="Клиент отдаёт одну валюту и получает другую. Сумма получения считается из суммы и курса." />
      <ExchangeForm
        locations={visibleLocations}
        currencies={currencies.filter((item) => item.is_active)}
        cashboxes={cashboxes}
        counterparties={counterparties.filter((item) => item.status === "active")}
        rates={rates}
        operator={session.profile.full_name}
        presetLocation={active ?? undefined}
      />
    </div>
  );
}
