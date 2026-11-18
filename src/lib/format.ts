import Decimal from "decimal.js";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export function formatMoney(value: string | number | null | undefined, code?: string, precision = 2) {
  if (value === null || value === undefined || value === "") return "—";
  const decimal = new Decimal(value).toDecimalPlaces(precision, Decimal.ROUND_HALF_UP);
  const [whole, fraction = ""] = decimal.toFixed(precision).split(".");
  const sign = whole.startsWith("-") ? "−" : "";
  const digits = whole.replace("-", "").replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
  const amount = precision > 0 ? `${sign}${digits},${fraction}` : `${sign}${digits}`;
  return code ? `${amount}\u00a0${code}` : amount;
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return format(new Date(value), "d MMM yyyy, HH:mm", { locale: ru });
}

export function formatDay(value: string) {
  return format(new Date(`${value}T00:00:00`), "d MMM", { locale: ru });
}

export function parseMoney(input: string) {
  return new Decimal(input.trim().replace(/\s/g, "").replace(",", "."));
}
