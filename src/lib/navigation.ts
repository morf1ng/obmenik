import {
  ArrowLeftRight,
  UserCog,
  Building2,
  HandCoins,
  Landmark,
  LayoutDashboard,
  ScrollText,
  Settings,
  Truck,
  Users,
  Wallet,
  Coins,
} from "lucide-react";

export const navigation = [
  { href: "/", label: "Главная панель", action: "dashboard.view", icon: LayoutDashboard },
  { href: "/operations", label: "Операции", action: "operations.view", icon: ArrowLeftRight },
  { href: "/cashboxes", label: "Кассы", action: "cashboxes.view", icon: Wallet },
  { href: "/counterparties", label: "Контрагенты", action: "counterparties.view", icon: Users },
  { href: "/debts", label: "Долги", action: "debts.view", icon: HandCoins },
  { href: "/transfers", label: "Перестановки", action: "transfers.view", icon: Truck },
  { href: "/accounting", label: "Бухгалтерия", action: "accounting.view", icon: Landmark },
  { href: "/rates", label: "Валюты и курсы", action: "rates.view", icon: Coins },
  { href: "/locations", label: "Точки компании", action: "locations.view", icon: Building2 },
  { href: "/employees", label: "Сотрудники", action: "employees.view", icon: UserCog },
  { href: "/audit", label: "История действий", action: "audit.view", icon: ScrollText },
  { href: "/settings", label: "Настройки", action: "dashboard.view", icon: Settings },
] as const;
