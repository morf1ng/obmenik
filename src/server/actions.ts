"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/server/session";
import { callRpc } from "@/server/queries";
import { fail, ok, type ActionResult } from "@/server/result";

const money = z.string().trim().regex(/^\d+([.,]\d{1,8})?$/, "Введите сумму");
const key = z.string().trim().min(8).max(120);
const uuid = z.string().uuid();

function num(value: string) {
  return value.replace(/\s/g, "").replace(",", ".");
}

function refresh() {
  revalidatePath("/", "layout");
}

export async function signIn(_state: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return fail(new Error("Введите почту и пароль"));
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return fail(new Error("Неверная почта или пароль"));
  const { data } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from("profiles").select("is_active").eq("id", data.user?.id ?? "").maybeSingle();
  if (!(profile as { is_active?: boolean } | null)?.is_active) {
    await supabase.auth.signOut();
    return fail(new Error("Учётная запись не активирована. Обратитесь к администратору"));
  }
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function setLocation(formData: FormData) {
  const session = await requireSession();
  const value = String(formData.get("location") ?? "all");
  if (value !== "all" && !session.canLocation(value)) return;
  const jar = await cookies();
  jar.set("valora-location", value, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
  });
  refresh();
}

const exchangeSchema = z.object({
  idempotencyKey: key,
  locationId: uuid,
  cashboxInId: uuid,
  cashboxOutId: uuid,
  counterpartyId: uuid,
  amountIn: money,
  exchangeRate: money,
  commission: z.string().optional(),
  commissionCurrencyId: z.string().optional(),
  comment: z.string().max(2000).optional(),
  draftId: z.string().optional(),
});

function exchangeArgs(input: z.infer<typeof exchangeSchema>) {
  const commission = input.commission?.trim() ? num(input.commission) : "0";
  return {
    p_idempotency_key: input.idempotencyKey,
    p_location_id: input.locationId,
    p_cashbox_in_id: input.cashboxInId,
    p_cashbox_out_id: input.cashboxOutId,
    p_counterparty_id: input.counterpartyId,
    p_amount_in: num(input.amountIn),
    p_exchange_rate: num(input.exchangeRate),
    p_commission: commission,
    p_commission_currency_id: commission !== "0" ? input.commissionCurrencyId || null : null,
    p_comment: input.comment ?? "",
  };
}

export async function saveExchangeDraft(input: unknown): Promise<ActionResult> {
  try {
    const parsed = exchangeSchema.parse(input);
    const id = await callRpc<string>("save_exchange_draft", exchangeArgs(parsed));
    refresh();
    return ok("Черновик сохранён", id);
  } catch (error) {
    return fail(error);
  }
}

export async function postExchange(input: unknown): Promise<ActionResult> {
  try {
    const parsed = exchangeSchema.parse(input);
    const id = await callRpc<string>("post_exchange", {
      ...exchangeArgs(parsed),
      p_draft_id: parsed.draftId || null,
    });
    refresh();
    return ok("Обмен проведён", id);
  } catch (error) {
    return fail(error);
  }
}

export async function cancelOperation(input: unknown): Promise<ActionResult> {
  try {
    const parsed = z.object({ id: uuid, reason: z.string().trim().min(5).max(2000), idempotencyKey: key }).parse(input);
    await callRpc("cancel_operation", {
      p_operation_id: parsed.id,
      p_reason: parsed.reason,
      p_idempotency_key: parsed.idempotencyKey,
    });
    refresh();
    return ok("Операция отменена, проводки сторнированы");
  } catch (error) {
    return fail(error);
  }
}

export async function postCashMovement(input: unknown): Promise<ActionResult> {
  try {
    const parsed = z.object({
      idempotencyKey: key,
      cashboxId: uuid,
      direction: z.enum(["in", "out", "adjust"]),
      amount: money,
      category: z.string().optional(),
      comment: z.string().trim().min(5).max(2000),
      counterpartyId: z.string().optional(),
    }).parse(input);
    const id = await callRpc<string>("post_cash_movement", {
      p_idempotency_key: parsed.idempotencyKey,
      p_cashbox_id: parsed.cashboxId,
      p_direction: parsed.direction,
      p_amount: num(parsed.amount),
      p_category: parsed.category || null,
      p_comment: parsed.comment,
      p_counterparty_id: parsed.counterpartyId || null,
    });
    refresh();
    return ok(parsed.direction === "adjust" ? "Остаток скорректирован" : "Движение проведено", id);
  } catch (error) {
    return fail(error);
  }
}

export async function createCounterparty(input: unknown): Promise<ActionResult> {
  try {
    const parsed = z.object({
      name: z.string().trim().min(2).max(200),
      phone: z.string().max(40).optional(),
      comment: z.string().max(2000).optional(),
    }).parse(input);
    const id = await callRpc<string>("create_counterparty", {
      p_name: parsed.name,
      p_phone: parsed.phone ?? "",
      p_comment: parsed.comment ?? "",
    });
    refresh();
    return ok("Контрагент создан", id);
  } catch (error) {
    return fail(error);
  }
}

export async function updateCounterparty(input: unknown): Promise<ActionResult> {
  try {
    const parsed = z.object({
      id: uuid,
      name: z.string().trim().min(2).max(200),
      phone: z.string().max(40).optional(),
      comment: z.string().max(2000).optional(),
      status: z.enum(["active", "archived"]),
    }).parse(input);
    await callRpc("update_counterparty", {
      p_id: parsed.id,
      p_name: parsed.name,
      p_phone: parsed.phone ?? "",
      p_comment: parsed.comment ?? "",
      p_status: parsed.status,
    });
    refresh();
    return ok("Карточка контрагента обновлена");
  } catch (error) {
    return fail(error);
  }
}

export async function createTransfer(input: unknown): Promise<ActionResult> {
  try {
    const parsed = z.object({
      idempotencyKey: key,
      fromLocationId: uuid,
      toLocationId: uuid,
      currencyId: uuid,
      amount: money,
      commissionEnabled: z.boolean(),
      commission: z.string().optional(),
      comment: z.string().max(2000).optional(),
      dispatch: z.boolean(),
    }).parse(input);
    const commission = parsed.commissionEnabled && parsed.commission?.trim() ? num(parsed.commission) : "0";
    const id = await callRpc<string>("create_transfer", {
      p_idempotency_key: parsed.idempotencyKey,
      p_from_location_id: parsed.fromLocationId,
      p_to_location_id: parsed.toLocationId,
      p_currency_id: parsed.currencyId,
      p_amount: num(parsed.amount),
      p_commission: commission,
      p_comment: parsed.comment ?? "",
      p_dispatch: parsed.dispatch,
    });
    refresh();
    return ok(parsed.dispatch ? "Перестановка отправлена, деньги в пути" : "Заявка на перестановку создана", id);
  } catch (error) {
    return fail(error);
  }
}

export async function sendTransfer(input: unknown): Promise<ActionResult> {
  try {
    const parsed = z.object({ id: uuid, idempotencyKey: key }).parse(input);
    await callRpc("send_transfer", { p_transfer_id: parsed.id, p_idempotency_key: parsed.idempotencyKey });
    refresh();
    return ok("Деньги списаны и поставлены в путь");
  } catch (error) {
    return fail(error);
  }
}

export async function receiveTransfer(input: unknown): Promise<ActionResult> {
  try {
    const parsed = z.object({ id: uuid, idempotencyKey: key }).parse(input);
    await callRpc("receive_transfer", { p_transfer_id: parsed.id, p_idempotency_key: parsed.idempotencyKey });
    refresh();
    return ok("Получение подтверждено, касса пополнена");
  } catch (error) {
    return fail(error);
  }
}

export async function cancelTransfer(input: unknown): Promise<ActionResult> {
  try {
    const parsed = z.object({ id: uuid, reason: z.string().trim().min(5).max(2000), idempotencyKey: key }).parse(input);
    await callRpc("cancel_transfer", {
      p_transfer_id: parsed.id,
      p_reason: parsed.reason,
      p_idempotency_key: parsed.idempotencyKey,
    });
    refresh();
    return ok("Перестановка отменена");
  } catch (error) {
    return fail(error);
  }
}

export async function createDebt(input: unknown): Promise<ActionResult> {
  try {
    const parsed = z.object({
      idempotencyKey: key,
      counterpartyId: uuid,
      currencyId: uuid,
      locationId: uuid,
      direction: z.enum(["receivable", "payable"]),
      amount: money,
      comment: z.string().max(2000).optional(),
    }).parse(input);
    const id = await callRpc<string>("create_debt", {
      p_idempotency_key: parsed.idempotencyKey,
      p_counterparty_id: parsed.counterpartyId,
      p_currency_id: parsed.currencyId,
      p_location_id: parsed.locationId,
      p_direction: parsed.direction,
      p_amount: num(parsed.amount),
      p_comment: parsed.comment ?? "",
    });
    refresh();
    return ok("Задолженность зарегистрирована", id);
  } catch (error) {
    return fail(error);
  }
}

export async function repayDebt(input: unknown): Promise<ActionResult> {
  try {
    const parsed = z.object({
      idempotencyKey: key,
      debtId: uuid,
      cashboxId: uuid,
      amount: money,
      comment: z.string().max(2000).optional(),
    }).parse(input);
    await callRpc("repay_debt", {
      p_idempotency_key: parsed.idempotencyKey,
      p_debt_id: parsed.debtId,
      p_cashbox_id: parsed.cashboxId,
      p_amount: num(parsed.amount),
      p_comment: parsed.comment ?? "",
    });
    refresh();
    return ok("Погашение проведено по кассе");
  } catch (error) {
    return fail(error);
  }
}

export async function publishRate(input: unknown): Promise<ActionResult> {
  try {
    const parsed = z.object({
      baseCurrencyId: uuid,
      quoteCurrencyId: uuid,
      buyRate: money,
      sellRate: money,
      effectiveAt: z.string().min(10),
    }).parse(input);
    await callRpc("publish_rate", {
      p_base_currency_id: parsed.baseCurrencyId,
      p_quote_currency_id: parsed.quoteCurrencyId,
      p_buy_rate: num(parsed.buyRate),
      p_sell_rate: num(parsed.sellRate),
      p_effective_at: new Date(parsed.effectiveAt).toISOString(),
    });
    refresh();
    return ok("Новый курс сохранён. Старые операции не изменились");
  } catch (error) {
    return fail(error);
  }
}

export async function setCurrencyActive(input: unknown): Promise<ActionResult> {
  try {
    const parsed = z.object({ id: uuid, active: z.boolean() }).parse(input);
    await callRpc("set_currency_active", { p_currency_id: parsed.id, p_active: parsed.active });
    refresh();
    return ok(parsed.active ? "Валюта включена" : "Валюта отключена");
  } catch (error) {
    return fail(error);
  }
}

export async function createCurrency(input: unknown): Promise<ActionResult> {
  try {
    const parsed = z.object({
      code: z.string().trim().min(3).max(8),
      name: z.string().trim().min(2).max(80),
      symbol: z.string().trim().min(1).max(8),
      precision: z.number().int().min(0).max(8),
    }).parse(input);
    await callRpc("create_currency", {
      p_code: parsed.code,
      p_name: parsed.name,
      p_symbol: parsed.symbol,
      p_precision: parsed.precision,
    });
    refresh();
    return ok("Валюта добавлена, кассы созданы на каждой точке");
  } catch (error) {
    return fail(error);
  }
}

export async function saveLocation(input: unknown): Promise<ActionResult> {
  try {
    const parsed = z.object({
      id: z.string().optional(),
      name: z.string().trim().min(2).max(120),
      address: z.string().max(300).optional(),
      active: z.boolean(),
    }).parse(input);
    if (parsed.id) {
      await callRpc("update_location", {
        p_location_id: parsed.id,
        p_name: parsed.name,
        p_address: parsed.address ?? "",
        p_active: parsed.active,
      });
    } else {
      await callRpc("create_location", { p_name: parsed.name, p_address: parsed.address ?? "" });
    }
    refresh();
    return ok(parsed.id ? "Точка обновлена" : "Точка создана вместе с кассами");
  } catch (error) {
    return fail(error);
  }
}

export async function saveCashbox(input: unknown): Promise<ActionResult> {
  try {
    const parsed = z.object({ id: uuid, name: z.string().trim().min(2).max(160), active: z.boolean() }).parse(input);
    await callRpc("update_cashbox", { p_cashbox_id: parsed.id, p_name: parsed.name, p_active: parsed.active });
    refresh();
    return ok("Карточка кассы обновлена. Остаток не менялся");
  } catch (error) {
    return fail(error);
  }
}

export async function saveSettings(input: unknown): Promise<ActionResult> {
  try {
    const parsed = z.object({
      companyName: z.string().trim().min(2).max(80),
      legalName: z.string().trim().min(2).max(200),
      fullName: z.string().trim().min(2).max(160),
    }).parse(input);
    const session = await requireSession();
    await callRpc("update_own_profile", { p_full_name: parsed.fullName });
    if (session.can("settings.manage")) {
      await callRpc("update_setting", { p_key: "company_name", p_value: parsed.companyName });
      await callRpc("update_setting", { p_key: "legal_name", p_value: parsed.legalName });
    }
    refresh();
    return ok("Настройки сохранены");
  } catch (error) {
    return fail(error);
  }
}

const employeeSchema = z.object({
  id: uuid,
  fullName: z.string().trim().min(2).max(160),
  role: z.enum(["ADMIN", "ACCOUNTANT", "MANAGER", "EMPLOYEE"]),
  active: z.boolean(),
  locationIds: z.array(uuid),
  overrides: z.array(z.object({ action: z.string(), allowed: z.boolean() })),
});

export async function saveEmployee(input: unknown): Promise<ActionResult> {
  try {
    const parsed = employeeSchema.parse(input);
    await callRpc("update_employee", {
      p_user_id: parsed.id,
      p_full_name: parsed.fullName,
      p_role: parsed.role,
      p_is_active: parsed.active,
      p_location_ids: parsed.locationIds,
    });
    await callRpc("set_permission_overrides", { p_user_id: parsed.id, p_overrides: parsed.overrides });
    refresh();
    return ok("Права сотрудника обновлены");
  } catch (error) {
    return fail(error);
  }
}

export async function createEmployee(input: unknown): Promise<ActionResult> {
  try {
    const session = await requireSession();
    if (!session.can("employees.manage")) return fail(new Error("Недостаточно прав: employees.manage"));
    const parsed = z.object({
      fullName: z.string().trim().min(2).max(160),
      email: z.string().trim().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Укажите почту"),
      password: z.string().min(8).max(72),
      role: z.enum(["ADMIN", "ACCOUNTANT", "MANAGER", "EMPLOYEE"]),
      locationIds: z.array(uuid).min(1),
    }).parse(input);
    const service = createServiceClient();
    const created = await service.auth.admin.createUser({
      email: parsed.email,
      password: parsed.password,
      email_confirm: true,
      user_metadata: { full_name: parsed.fullName },
    });
    if (created.error || !created.data.user) return fail(created.error ?? new Error("Не удалось создать сотрудника"));
    try {
      await callRpc("update_employee", {
        p_user_id: created.data.user.id,
        p_full_name: parsed.fullName,
        p_role: parsed.role,
        p_is_active: true,
        p_location_ids: parsed.locationIds,
      });
    } catch (error) {
      await service.auth.admin.deleteUser(created.data.user.id);
      return fail(error);
    }
    refresh();
    return ok("Сотрудник создан. Передайте ему пароль по защищённому каналу");
  } catch (error) {
    return fail(error);
  }
}

export async function resetEmployeePassword(input: unknown): Promise<ActionResult> {
  try {
    const session = await requireSession();
    if (!session.can("employees.manage")) return fail(new Error("Недостаточно прав: employees.manage"));
    const parsed = z.object({ id: uuid, password: z.string().min(8).max(72) }).parse(input);
    const service = createServiceClient();
    const { error } = await service.auth.admin.updateUserById(parsed.id, { password: parsed.password });
    if (error) return fail(error);
    return ok("Пароль обновлён. Сообщите его сотруднику один раз");
  } catch (error) {
    return fail(error);
  }
}
