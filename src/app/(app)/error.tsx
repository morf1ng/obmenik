"use client";

import { Button } from "@/components/ui/button";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="rounded-2xl border border-destructive/40 bg-card/80 p-6">
      <h1 className="text-lg font-semibold">Не удалось загрузить раздел</h1>
      <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
      <Button className="mt-4" onClick={reset}>Повторить</Button>
    </div>
  );
}
