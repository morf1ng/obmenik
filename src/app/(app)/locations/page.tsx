import { requireSession } from "@/server/session";
import { loadCashboxes, loadLocations } from "@/server/queries";
import { formatMoney } from "@/lib/format";
import { Denied, PageHeader, Panel } from "@/components/bits";
import { LocationEditor } from "@/components/action-dialogs";

export default async function LocationsPage() {
  const session = await requireSession();
  if (!session.can("locations.view")) return <Denied />;
  const [locations, cashboxes] = await Promise.all([loadLocations(), loadCashboxes()]);
  const visible = locations.filter((item) => session.canLocation(item.id));
  return (
    <div className="space-y-5">
      <PageHeader title="Точки компании" description="Махачкала и Москва ведут отдельные кассы. Новая точка сразу получает кассу на каждую активную валюту." />
      <div className="grid gap-4 md:grid-cols-2">
        {visible.map((location) => (
          <Panel key={location.id} className="p-5">
            <h2 className="text-lg font-semibold">{location.name}</h2>
            <p className="text-sm text-muted-foreground">{location.address}</p>
            <div className="mt-4 space-y-2 text-sm">
              {cashboxes.filter((box) => box.location_id === location.id).map((box) => (
                <div key={box.id} className="flex justify-between">
                  <span>{box.currency_code}</span>
                  <span className="tabular-nums">{formatMoney(box.balance, box.currency_code)}</span>
                </div>
              ))}
            </div>
          </Panel>
        ))}
      </div>
      <LocationEditor locations={locations} cashboxes={cashboxes} canManage={session.can("locations.manage")} />
    </div>
  );
}
