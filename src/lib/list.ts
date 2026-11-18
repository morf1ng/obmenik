export type SearchParams = Record<string, string | string[] | undefined>;

export type ListParams = {
  q: string;
  page: number;
  sort: string;
  dir: "asc" | "desc";
  status: string;
  location: string;
  currency: string;
  direction: string;
  from: string;
  to: string;
  period: string;
};

export const pageSize = 15;

function one(params: SearchParams, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export function readList(params: SearchParams, fallbackSort = "created_at"): ListParams {
  const page = Number(one(params, "page"));
  return {
    q: one(params, "q").slice(0, 80),
    page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1,
    sort: one(params, "sort") || fallbackSort,
    dir: one(params, "dir") === "asc" ? "asc" : "desc",
    status: one(params, "status"),
    location: one(params, "location"),
    currency: one(params, "currency"),
    direction: one(params, "direction"),
    from: one(params, "from"),
    to: one(params, "to"),
    period: one(params, "period"),
  };
}

export function pageHref(pathname: string, params: ListParams, patch: Partial<ListParams>) {
  const next = { ...params, ...patch };
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(next)) {
    if (!value || (key === "page" && value === 1) || (key === "dir" && value === "desc") || (key === "period" && value === "today" && pathname === "/")) {
      continue;
    }
    if (key === "sort" && value === "created_at" && pathname !== "/audit") continue;
    query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `${pathname}?${text}` : pathname;
}

export function chosenLocation(explicit: string, fallback: string | null) {
  if (explicit === "all") return null;
  return explicit || fallback;
}

export function safeSearch(value: string) {
  return value.replace(/[%(),]/g, "").trim();
}
