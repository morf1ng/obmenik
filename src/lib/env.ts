export function isSupabaseConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && supabaseAnonKeyOrEmpty());
}

export function supabaseUrl() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("Не задан NEXT_PUBLIC_SUPABASE_URL");
  return url;
}

export function supabaseAnonKey() {
  const key = supabaseAnonKeyOrEmpty();
  if (!key) throw new Error("Не задан публичный ключ Supabase");
  return key;
}

export function supabaseSecretKey() {
  return process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}

function supabaseAnonKeyOrEmpty() {
  return process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
}
