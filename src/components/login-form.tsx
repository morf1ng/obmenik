"use client";

import { useActionState } from "react";
import { signIn } from "@/server/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/bits";

export function LoginForm() {
  const [state, action, pending] = useActionState(signIn, null);
  return (
    <form action={action} className="grid gap-4">
      <Field label="Почта">
        <Input className="h-10" name="email" type="email" autoComplete="username" required />
      </Field>
      <Field label="Пароль">
        <Input className="h-10" name="password" type="password" autoComplete="current-password" required />
      </Field>
      {state && !state.ok && <p className="text-sm text-destructive">{state.message}</p>}
      <Button type="submit" disabled={pending} className="h-10">{pending ? "Входим…" : "Войти"}</Button>
    </form>
  );
}
