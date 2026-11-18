import "server-only";
import { createClient } from "@/lib/supabase/server";
import { pageSize, safeSearch, type ListParams } from "@/lib/list";

type Row = Record<string, unknown>;

async function db() {
  return createClient();
}

function rows<T>(data: unknown): T[] {
  return (data ?? []) as T[];
}

export async function callRpc<T>(name: string, args: Record<string, unknown>) {
  const supabase = await db();
  const client = supabase as unknown as {
    rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: T | null; error: { message: string } | null }>;
  };
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export async function loadSettings() {
  const supabase = await db();
  const { data, error } = await supabase.from("app_settings").select("key, value");
  if (error) throw new Error(error.message);
  const map: Record<string, string> = {};
  for (const row of rows<{ key: string; value: unknown }>(data)) {
    map[row.key] = typeof row.value === "string" ? row.value : String(row.value ?? "");
  }
  return map;
}

export async function loadLocations() {
  const supabase = await db();
  const { data, error } = await supabase.from("locations").select("id, name, address, is_active").order("name");
  if (error) throw new Error(error.message);
  return rows<{ id: string; name: string; address: string | null; is_active: boolean }>(data);
}

export async function loadCurrencies() {
  const supabase = await db();
  const { data, error } = await supabase
    .from("currencies")
    .select("id, code, name, symbol, precision, is_active")
    .order("code");
  if (error) throw new Error(error.message);
  return rows<{ id: string; code: string; name: string; symbol: string; precision: number; is_active: boolean }>(data);
}

export async function loadCashboxes() {
  const supabase = await db();
  const { data, error } = await supabase
    .from("cashbox_balances")
    .select("id, name, location_id, location_name, currency_id, currency_code, currency_symbol, currency_precision, is_active, created_at, balance")
    .order("location_name")
    .order("currency_code");
  if (error) throw new Error(error.message);
  return rows<{
    id: string;
    name: string;
    location_id: string;
    location_name: string;
    currency_id: string;
    currency_code: string;
    currency_symbol: string;
    currency_precision: number;
    is_active: boolean;
    created_at: string;
    balance: string;
  }>(data);
}

export async function loadRates() {
  const supabase = await db();
  const { data, error } = await supabase.from("rates_current").select("*");
  if (error) throw new Error(error.message);
  return rows<{
    id: string;
    base_currency_id: string;
    base_code: string;
    quote_currency_id: string;
    quote_code: string;
    buy_rate: string;
    sell_rate: string;
    effective_at: string;
    created_by_name: string | null;
  }>(data);
}

export async function loadRateHistory() {
  const supabase = await db();
  const { data, error } = await supabase
    .from("exchange_rates")
    .select("id, buy_rate, sell_rate, effective_at, created_at, base_currency_id, quote_currency_id, currencies!exchange_rates_base_currency_id_fkey(code), quote:currencies!exchange_rates_quote_currency_id_fkey(code), profiles(full_name)")
    .order("effective_at", { ascending: false })
    .limit(80);
  if (error) throw new Error(error.message);
  return rows<Row>(data).map((row) => ({
    id: String(row.id),
    buy_rate: String(row.buy_rate),
    sell_rate: String(row.sell_rate),
    effective_at: String(row.effective_at),
    base: codeOf(row.currencies),
    quote: codeOf(row.quote),
    author: nameOf(row.profiles),
  }));
}

function codeOf(value: unknown) {
  if (Array.isArray(value)) return String((value[0] as Row | undefined)?.code ?? "");
  if (value && typeof value === "object" && "code" in value) return String((value as Row).code);
  return "";
}

function nameOf(value: unknown) {
  if (Array.isArray(value)) return String((value[0] as Row | undefined)?.full_name ?? "—");
  if (value && typeof value === "object" && "full_name" in value) return String((value as Row).full_name);
  return "—";
}

export async function loadCounterparties(query = "") {
  const supabase = await db();
  let request = supabase.from("counterparties").select("id, name, phone, comment, status, created_at").order("name");
  const q = safeSearch(query);
  if (q) request = request.ilike("name", `%${q}%`);
  const { data, error } = await request.limit(200);
  if (error) throw new Error(error.message);
  return rows<{ id: string; name: string; phone: string | null; comment: string | null; status: string; created_at: string }>(data);
}

export async function loadCounterpartyBalances() {
  const supabase = await db();
  const { data, error } = await supabase.from("counterparty_balances").select("*");
  if (error) throw new Error(error.message);
  return rows<{ counterparty_id: string; currency_code: string; receivable: string; payable: string; signed_balance: string }>(data);
}

async function paged(table: string, params: ListParams, sorts: string[], filters: (query: AnyQuery) => AnyQuery) {
  const supabase = await db();
  const start = (params.page - 1) * pageSize;
  let query = (supabase.from(table) as unknown as AnyQuery).select("*", { count: "exact" });
  query = filters(query);
  const sort = sorts.includes(params.sort) ? params.sort : sorts[0];
  const { data, error, count } = await query.order(sort, { ascending: params.dir === "asc" }).range(start, start + pageSize - 1);
  if (error) throw new Error(error.message);
  return { rows: rows<Row>(data), count: count ?? 0 };
}

type AnyQuery = {
  select: (columns: string, options?: { count: "exact" }) => AnyQuery;
  order: (column: string, options: { ascending: boolean }) => AnyQuery;
  range: (from: number, to: number) => Promise<{ data: unknown; error: { message: string } | null; count: number | null }>;
  eq: (column: string, value: string) => AnyQuery;
  gte: (column: string, value: string) => AnyQuery;
  lte: (column: string, value: string) => AnyQuery;
  or: (filters: string) => AnyQuery;
  ilike: (column: string, value: string) => AnyQuery;
};

function applyCommon(query: AnyQuery, params: ListParams, searchColumns: string[], locationColumn: string | null = "location_id") {
  const q = safeSearch(params.q);
  let next = query;
  if (q && searchColumns.length) {
    next = next.or(searchColumns.map((column) => `${column}.ilike.%${q}%`).join(","));
  }
  if (params.status) next = next.eq("status", params.status);
  if (params.location && locationColumn) next = next.eq(locationColumn, params.location);
  if (params.from) next = next.gte("created_at", `${params.from}T00:00:00+03:00`);
  if (params.to) next = next.lte("created_at", `${params.to}T23:59:59+03:00`);
  return next;
}

export function listOperations(params: ListParams) {
  return paged("operations_list", params, ["created_at", "operation_number", "amount_from"], (query) => {
    let next = applyCommon(query, params, ["operation_number", "counterparty_name", "comment"]);
    if (params.currency) next = next.or(`code_from.eq.${params.currency},code_to.eq.${params.currency}`);
    return next;
  });
}

export function listTransfers(params: ListParams) {
  return paged("transfers_list", params, ["created_at", "amount", "transfer_number"], (query) => {
    let next = applyCommon(query, params, ["transfer_number", "comment", "from_name", "to_name"], null);
    if (params.currency) next = next.eq("currency_code", params.currency);
    if (params.location) {
      next = next.or(`from_location_id.eq.${params.location},to_location_id.eq.${params.location}`);
    }
    return next;
  });
}

export function listDebts(params: ListParams) {
  return paged("debts_list", params, ["created_at", "remaining_amount", "debt_number"], (query) => {
    let next = applyCommon(query, params, ["debt_number", "counterparty_name", "comment"]);
    if (params.currency) next = next.eq("currency_code", params.currency);
    if (params.direction) next = next.eq("direction", params.direction);
    return next;
  });
}

export function listAudit(params: ListParams) {
  return paged("audit_logs", params, ["created_at", "action"], (query) =>
    applyCommon(query, params, ["action", "entity_type"]),
  );
}

export async function getOperation(id: string) {
  const supabase = await db();
  const { data, error } = await supabase.from("operations_list").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  const { data: entries, error: entryError } = await supabase
    .from("financial_entries")
    .select("id, direction, amount, entry_type, created_at, cashbox_id, currency_id")
    .eq("operation_id", id)
    .order("created_at");
  if (entryError) throw new Error(entryError.message);
  return { operation: data as Row | null, entries: rows<Row>(entries) };
}

export async function getTransfer(id: string) {
  const supabase = await db();
  const { data, error } = await supabase.from("transfers_list").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  const { data: events, error: eventError } = await supabase
    .from("transfer_events")
    .select("id, status, comment, created_at, actor_id, profiles(full_name)")
    .eq("transfer_id", id)
    .order("created_at");
  if (eventError) throw new Error(eventError.message);
  return { transfer: data as Row | null, events: rows<Row>(events) };
}

export async function getCounterparty(id: string) {
  const supabase = await db();
  const { data, error } = await supabase.from("counterparties").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  const [{ data: balances }, { data: operations }, { data: debts }] = await Promise.all([
    supabase.from("counterparty_balances").select("*").eq("counterparty_id", id),
    supabase.from("operations_list").select("*").eq("counterparty_id", id).order("created_at", { ascending: false }).limit(50),
    supabase.from("debts_list").select("*").eq("counterparty_id", id).order("created_at", { ascending: false }),
  ]);
  return {
    counterparty: data as Row | null,
    balances: rows<Row>(balances),
    operations: rows<Row>(operations),
    debts: rows<Row>(debts),
  };
}

export async function loadEmployees() {
  const supabase = await db();
  const [{ data: people, error }, { data: links }, { data: overrides }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, role, is_active, created_at").order("full_name"),
    supabase.from("employee_locations").select("user_id, location_id"),
    supabase.from("user_permission_overrides").select("user_id, action, allowed"),
  ]);
  if (error) throw new Error(error.message);
  return {
    people: rows<{ id: string; full_name: string; email: string | null; role: string; is_active: boolean; created_at: string }>(people),
    links: rows<{ user_id: string; location_id: string }>(links),
    overrides: rows<{ user_id: string; action: string; allowed: boolean }>(overrides),
  };
}

export async function loadAuditAuthors() {
  const supabase = await db();
  const { data, error } = await supabase.from("profiles").select("id, full_name");
  if (error) throw new Error(error.message);
  return new Map(rows<{ id: string; full_name: string }>(data).map((row) => [row.id, row.full_name]));
}

export async function pendingTransfers() {
  const supabase = await db();
  const { data, error } = await supabase
    .from("transfers_list")
    .select("id, transfer_number, to_name, currency_code, net_amount, from_name")
    .eq("status", "sent")
    .order("sent_at", { ascending: false })
    .limit(6);
  if (error) throw new Error(error.message);
  return rows<{ id: string; transfer_number: string; to_name: string; from_name: string; currency_code: string; net_amount: string }>(data);
}
