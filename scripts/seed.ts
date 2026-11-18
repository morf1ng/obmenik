import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

loadEnv(".env.local");
loadEnv(".env");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Нужны NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SECRET_KEY в .env.local");
  process.exit(1);
}

const password = process.env.DEMO_PASSWORD || randomBytes(12).toString("base64url");
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const mhk = "11111111-1111-4111-8111-111111111111";
const msk = "22222222-2222-4222-8222-222222222222";

const users = [
  { email: "admin@valora.demo", fullName: "Администратор DEMO", role: "ADMIN", locations: [mhk, msk], grants: [] as string[] },
  { email: "accountant@valora.demo", fullName: "Бухгалтер DEMO", role: "ACCOUNTANT", locations: [mhk, msk], grants: [] },
  { email: "manager.makhachkala@valora.demo", fullName: "Управляющий Махачкалы DEMO", role: "MANAGER", locations: [mhk], grants: [] },
  { email: "manager.moscow@valora.demo", fullName: "Управляющий Москвы DEMO", role: "MANAGER", locations: [msk], grants: [] },
  { email: "employee.makhachkala@valora.demo", fullName: "Сотрудник Махачкалы DEMO", role: "EMPLOYEE", locations: [mhk], grants: [] },
  { email: "employee.moscow@valora.demo", fullName: "Сотрудник Москвы DEMO", role: "EMPLOYEE", locations: [msk], grants: [] },
  { email: "cashier.makhachkala@valora.demo", fullName: "Кассир Махачкалы DEMO", role: "EMPLOYEE", locations: [mhk], grants: ["operations.post", "operations.cancel", "cashboxes.move"] },
  { email: "cashier.moscow@valora.demo", fullName: "Кассир Москвы DEMO", role: "EMPLOYEE", locations: [msk], grants: ["operations.post", "operations.cancel", "cashboxes.move"] },
];

const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
if (listed.error) throw listed.error;

for (const user of users) {
  const existing = listed.data.users.find((item) => item.email === user.email);
  const authUser = existing
    ? (await admin.auth.admin.updateUserById(existing.id, { password, email_confirm: true, user_metadata: { full_name: user.fullName } })).data.user
    : (await admin.auth.admin.createUser({ email: user.email, password, email_confirm: true, user_metadata: { full_name: user.fullName } })).data.user;
  if (!authUser) throw new Error(`Не удалось подготовить ${user.email}`);

  const profile = await admin.from("profiles").upsert({
    id: authUser.id,
    full_name: user.fullName,
    email: user.email,
    role: user.role,
    is_active: true,
  });
  if (profile.error) throw profile.error;

  const cleared = await admin.from("employee_locations").delete().eq("user_id", authUser.id);
  if (cleared.error) throw cleared.error;
  const linked = await admin.from("employee_locations").insert(user.locations.map((locationId) => ({ user_id: authUser.id, location_id: locationId })));
  if (linked.error) throw linked.error;

  const removed = await admin.from("user_permission_overrides").delete().eq("user_id", authUser.id);
  if (removed.error) throw removed.error;
  if (user.grants.length) {
    const grants = await admin.from("user_permission_overrides").insert(user.grants.map((action) => ({ user_id: authUser.id, action, allowed: true })));
    if (grants.error) throw grants.error;
  }
}

const seeded = await admin.rpc("seed_demo_data");
if (seeded.error && !seeded.error.message.includes("уже загружены")) throw seeded.error;

console.log("\nДемо-сотрудники VALORA. Пароль показан один раз и не записан в репозиторий.\n");
for (const user of users) console.log(`${user.email}  ·  ${user.role}`);
console.log(`\nПароль для всех демо-учётных записей: ${password}`);
if (seeded.error) console.log("\nФинансовые демо-данные уже были загружены, повторно не создавались.");
else console.log("\nДемо-операции, перестановки, долги и курсы проведены через журнал.");

function loadEnv(file: string) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
