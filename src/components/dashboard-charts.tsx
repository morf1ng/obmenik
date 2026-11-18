"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatDay, formatMoney } from "@/lib/format";

const tooltipStyle = {
  background: "oklch(0.23 0.03 258)",
  border: "1px solid oklch(1 0 0 / 10%)",
  borderRadius: 12,
  color: "oklch(0.96 0.01 250)",
};

export function TurnoverChart({ title, points }: { title: string; points: { day: string; volume: string }[] }) {
  const data = [...points].sort((a, b) => a.day.localeCompare(b.day)).map((point) => ({
    day: formatDay(point.day),
    volume: Number(point.volume),
  }));
  return (
    <div className="h-72">
      <p className="mb-3 text-sm font-medium">{title}</p>
      <ResponsiveContainer width="100%" height="88%">
        <AreaChart data={data}>
          <CartesianGrid stroke="oklch(1 0 0 / 8%)" vertical={false} />
          <XAxis dataKey="day" tick={{ fill: "oklch(0.74 0.02 255)", fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "oklch(0.74 0.02 255)", fontSize: 12 }} axisLine={false} tickLine={false} width={64} />
          <Tooltip contentStyle={tooltipStyle} formatter={(value) => formatMoney(Number(value), "RUB")} />
          <Area type="monotone" dataKey="volume" stroke="oklch(0.74 0.15 163)" fill="oklch(0.74 0.15 163 / 0.2)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SplitCharts({
  currencies,
  locations,
}: {
  currencies: { code: string; amount: string }[];
  locations: { location: string; volume: string }[];
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="h-72">
        <p className="mb-3 text-sm font-medium">Входящий объём по валютам</p>
        <ResponsiveContainer width="100%" height="88%">
          <BarChart data={currencies.map((item) => ({ name: item.code, amount: Number(item.amount) }))}>
            <CartesianGrid stroke="oklch(1 0 0 / 8%)" vertical={false} />
            <XAxis dataKey="name" tick={{ fill: "oklch(0.74 0.02 255)", fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "oklch(0.74 0.02 255)", fontSize: 12 }} axisLine={false} tickLine={false} width={56} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="amount" fill="oklch(0.7 0.12 230)" radius={6} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="h-72">
        <p className="mb-3 text-sm font-medium">Активность точек, оборот в RUB</p>
        <ResponsiveContainer width="100%" height="88%">
          <BarChart data={locations.map((item) => ({ name: item.location, volume: Number(item.volume) }))}>
            <CartesianGrid stroke="oklch(1 0 0 / 8%)" vertical={false} />
            <XAxis dataKey="name" tick={{ fill: "oklch(0.74 0.02 255)", fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "oklch(0.74 0.02 255)", fontSize: 12 }} axisLine={false} tickLine={false} width={64} />
            <Tooltip contentStyle={tooltipStyle} formatter={(value) => formatMoney(Number(value), "RUB")} />
            <Bar dataKey="volume" fill="oklch(0.74 0.15 163)" radius={6} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
