import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/session";
import { callRpc } from "@/server/queries";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await requireSession();
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const kind = url.searchParams.get("kind");
  const period = url.searchParams.get("period") || "month";
  const from = url.searchParams.get("from") || null;
  const to = url.searchParams.get("to") || null;
  const location = url.searchParams.get("location") || null;

  let rows: string[][] = [];
  let filename = "valora";

  if (kind === "cashbox") {
    if (!session.can("cashboxes.view")) return NextResponse.json({ message: "Недостаточно прав" }, { status: 403 });
    const id = url.searchParams.get("id");
    if (!id) return NextResponse.json({ message: "Не указана касса" }, { status: 400 });
    const statement = await callRpc<{
      opening: string;
      closing: string;
      lines: { at: string; direction: string; amount: string; type: string; balance_after: string; description: string | null; actor: string | null }[];
    }>("cashbox_statement", { p_cashbox_id: id, p_from: from, p_to: to });
    rows = [
      ["Дата", "Тип", "Направление", "Сумма", "Остаток после", "Описание", "Сотрудник"],
      ...statement.lines.map((line) => [line.at, line.type, line.direction, line.amount, line.balance_after, line.description ?? "", line.actor ?? ""]),
      [],
      ["Остаток на начало", statement.opening],
      ["Остаток на конец", statement.closing],
    ];
    filename = "valora-cashbox";
  } else {
    if (!session.can("accounting.export")) return NextResponse.json({ message: "Недостаточно прав" }, { status: 403 });
    const report = await callRpc<{
      turnover_rub: string;
      commissions: { code: string; amount: string }[];
      expenses: { code: string; amount: string }[];
      result: { code: string; amount: string }[];
      movements: { at: string; type: string; direction: string; amount: string; code: string; cashbox: string | null; description: string | null; actor: string | null }[];
    }>("accounting_report", { p_period: period, p_from: from, p_to: to, p_location: location });
    rows = [
      ["Показатель", "Валюта", "Сумма"],
      ["Фактический оборот", "RUB", report.turnover_rub],
      ...report.commissions.map((item) => ["Комиссия", item.code, item.amount]),
      ...report.expenses.map((item) => ["Расход", item.code, item.amount]),
      ...report.result.map((item) => ["Результат", item.code, item.amount]),
      [],
      ["Дата", "Тип", "Направление", "Сумма", "Валюта", "Касса", "Описание", "Сотрудник"],
      ...report.movements.map((item) => [item.at, item.type, item.direction, item.amount, item.code, item.cashbox ?? "", item.description ?? "", item.actor ?? ""]),
    ];
    filename = "valora-accounting";
  }

  if (format === "csv") {
    const body = `\uFEFF${rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";")).join("\n")}`;
    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}.csv"`,
      },
    });
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Отчёт");
  rows.forEach((row) => sheet.addRow(row));
  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
    },
  });
}
