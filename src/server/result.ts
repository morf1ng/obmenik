export type ActionResult = {
  ok: boolean;
  message: string;
  id?: string;
  temporaryPassword?: string;
};

export function ok(message: string, id?: string, temporaryPassword?: string): ActionResult {
  return { ok: true, message, id, temporaryPassword };
}

export function fail(error: unknown): ActionResult {
  if (error && typeof error === "object" && "issues" in error && Array.isArray((error as { issues: unknown[] }).issues)) {
    const issue = (error as { issues: { message?: string }[] }).issues[0];
    return { ok: false, message: issue?.message || "Проверьте поля формы" };
  }
  const raw = error instanceof Error ? error.message : "Не удалось выполнить действие";
  const message = raw
    .replace(/^P0001:\s*/, "")
    .replace(/^ERROR:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return { ok: false, message: message || "Не удалось выполнить действие" };
}
