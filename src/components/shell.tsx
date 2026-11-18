"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Bell, LogOut, Menu } from "lucide-react";
import { navigation } from "@/lib/navigation";
import { roleLabel } from "@/lib/labels";
import { formatMoney } from "@/lib/format";
import { signOut, setLocation } from "@/server/actions";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Notice = {
  id: string;
  transfer_number: string;
  from_name: string;
  to_name: string;
  currency_code: string;
  net_amount: string;
};

export function AppShell({
  company,
  fullName,
  role,
  locations,
  activeLocation,
  notices,
  allowed,
  children,
}: {
  company: string;
  fullName: string;
  role: string;
  locations: { id: string; name: string }[];
  activeLocation: string | null;
  notices: Notice[];
  allowed: string[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const items = navigation.filter((item) => allowed.includes(item.action));
  const initials = fullName
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(900px_circle_at_0%_-10%,oklch(0.34_0.07_190/0.28),transparent_52%),radial-gradient(800px_circle_at_100%_0%,oklch(0.3_0.06_255/0.22),transparent_46%)]" />
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[260px] flex-col border-r border-sidebar-border bg-sidebar/95 backdrop-blur md:flex">
        <Brand company={company} />
        <Sidebar items={items} onNavigate={() => undefined} />
      </aside>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-[280px] bg-sidebar p-0">
          <Brand company={company} />
          <Sidebar items={items} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="relative md:pl-[260px]">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border/70 bg-background/75 px-4 backdrop-blur-xl md:px-8">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(true)} aria-label="Открыть меню">
            <Menu />
          </Button>
          <form action={setLocation} className="min-w-0 flex-1 md:flex-none">
            <label className="sr-only" htmlFor="location-switch">
              Точка
            </label>
            <select
              id="location-switch"
              name="location"
              defaultValue={activeLocation ?? "all"}
              onChange={(event) => event.currentTarget.form?.requestSubmit()}
              className="h-9 max-w-[220px] rounded-lg border border-input bg-card/70 px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
            >
              <option value="all">Все доступные точки</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </form>
          <div className="ml-auto flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="relative" aria-label="Уведомления">
                  <Bell />
                  {notices.length > 0 && (
                    <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                      {notices.length}
                    </span>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                <DropdownMenuLabel>Деньги в пути</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {notices.length === 0 && <p className="px-2 py-3 text-sm text-muted-foreground">Нет перестановок, ожидающих получения</p>}
                {notices.map((notice) => (
                  <DropdownMenuItem key={notice.id} asChild>
                    <Link href={`/transfers/${notice.id}`}>
                      <span className="flex flex-col gap-0.5">
                        <span className="font-medium">{notice.transfer_number}</span>
                        <span className="text-xs text-muted-foreground">
                          {notice.from_name} → {notice.to_name} · {formatMoney(notice.net_amount, notice.currency_code)}
                        </span>
                      </span>
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-muted/60">
                  <Avatar className="size-8">
                    <AvatarFallback className="bg-primary/15 text-xs text-primary">{initials}</AvatarFallback>
                  </Avatar>
                  <span className="hidden text-left sm:block">
                    <span className="block text-sm leading-none font-medium">{fullName}</span>
                    <span className="text-xs text-muted-foreground">{roleLabel[role] ?? role}</span>
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{roleLabel[role] ?? role}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/settings">Настройки</Link>
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onClick={() => signOut()}>
                  <LogOut />
                  Выйти
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1440px] px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}

function Brand({ company }: { company: string }) {
  return (
    <div className="flex items-center gap-3 px-5 py-5">
      <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground">V</span>
      <span>
        <span className="block text-sm font-semibold tracking-[0.16em]">{company}</span>
        <span className="block text-xs text-muted-foreground">Контроль обмена</span>
      </span>
    </div>
  );
}

function Sidebar({
  items,
  onNavigate,
}: {
  items: (typeof navigation)[number][];
  onNavigate: () => void;
}) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 pb-6">
      {items.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
              active ? "bg-sidebar-accent text-foreground" : "text-sidebar-foreground/75 hover:bg-sidebar-accent/70 hover:text-foreground"
            }`}
          >
            <Icon className={active ? "text-primary" : ""} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
