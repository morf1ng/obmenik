import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseSecretKey, supabaseUrl } from "@/lib/env";

export function createServiceClient() {
  const key = supabaseSecretKey();
  if (!key) throw new Error("Секретный ключ Supabase доступен только на сервере и не задан");
  return createClient(supabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
