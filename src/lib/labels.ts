export const roleLabel: Record<string, string> = {
  ADMIN: "Администратор",
  ACCOUNTANT: "Бухгалтер",
  MANAGER: "Управляющий",
  EMPLOYEE: "Сотрудник",
};

export const operationStatusLabel: Record<string, string> = {
  draft: "Черновик",
  posted: "Проведена",
  cancelled: "Отменена",
};

export const operationTypeLabel: Record<string, string> = {
  exchange: "Обмен",
  cash_in: "Приход",
  cash_out: "Расход",
  adjustment: "Корректировка",
};

export const transferStatusLabel: Record<string, string> = {
  created: "Создана",
  sent: "Отправлена",
  received: "Получена",
  cancelled: "Отменена",
};

export const debtStatusLabel: Record<string, string> = {
  open: "Открыт",
  partial: "Частично",
  settled: "Погашен",
  cancelled: "Отменён",
};

export const debtDirectionLabel: Record<string, string> = {
  receivable: "Нам должны",
  payable: "Мы должны",
};

export const actionLabel: Record<string, string> = {
  "dashboard.view": "Главная панель",
  "operations.view": "Просмотр операций",
  "operations.create": "Черновики обменов",
  "operations.post": "Проведение операций",
  "operations.cancel": "Отмена операций",
  "cashboxes.view": "Просмотр касс",
  "cashboxes.move": "Приход и расход",
  "cashboxes.adjust": "Корректировка остатка",
  "counterparties.view": "Просмотр контрагентов",
  "counterparties.manage": "Изменение контрагентов",
  "debts.view": "Просмотр долгов",
  "debts.manage": "Управление долгами",
  "transfers.view": "Просмотр перестановок",
  "transfers.create": "Создание перестановок",
  "transfers.send": "Отправка перестановок",
  "transfers.receive": "Подтверждение получения",
  "transfers.cancel": "Отмена перестановок",
  "accounting.view": "Бухгалтерия",
  "accounting.export": "Экспорт отчётов",
  "rates.view": "Просмотр курсов",
  "rates.manage": "Изменение курсов и валют",
  "locations.view": "Просмотр точек",
  "locations.manage": "Управление точками и кассами",
  "employees.view": "Просмотр сотрудников",
  "employees.manage": "Управление сотрудниками",
  "audit.view": "Журнал действий",
  "settings.manage": "Настройки",
};

export function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (["posted", "received", "settled", "active"].includes(status)) return "default";
  if (["cancelled", "archived"].includes(status)) return "destructive";
  if (["sent", "partial", "payable"].includes(status)) return "outline";
  return "secondary";
}
