import { requireSession } from "@/server/session";
import { loadEmployees, loadLocations } from "@/server/queries";
import { roleLabel } from "@/lib/labels";
import { Denied, PageHeader, Panel, StatusBadge } from "@/components/bits";
import { EmployeeManager } from "@/components/action-dialogs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default async function EmployeesPage() {
  const session = await requireSession();
  if (!session.can("employees.view")) return <Denied />;
  const [{ people, links, overrides }, locations] = await Promise.all([loadEmployees(), loadLocations()]);
  return (
    <div className="space-y-5">
      <PageHeader title="Сотрудники" description="Публичная регистрация закрыта. Учётные записи создаёт администратор. Права проверяются в интерфейсе, в серверных функциях и политиками RLS." />
      {session.can("employees.manage") ? (
        <EmployeeManager people={people} links={links} overrides={overrides} locations={locations} />
      ) : (
        <Panel>
          <Table>
            <TableHeader><TableRow><TableHead>Имя</TableHead><TableHead>Роль</TableHead><TableHead>Статус</TableHead></TableRow></TableHeader>
            <TableBody>
              {people.map((person) => (
                <TableRow key={person.id}>
                  <TableCell>{person.full_name}</TableCell>
                  <TableCell>{roleLabel[person.role]}</TableCell>
                  <TableCell><StatusBadge status={person.is_active ? "active" : "archived"} label={person.is_active ? "Активен" : "Отключён"} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      )}
    </div>
  );
}
