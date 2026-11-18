"use client";

import { toast } from "sonner";
import type { ActionResult } from "@/server/result";

export function notify(result: ActionResult) {
  if (result.ok) toast.success(result.message);
  else toast.error(result.message);
  return result.ok;
}
