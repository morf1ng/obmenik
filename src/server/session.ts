import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";

export type Role = "ADMIN" | "ACCOUNTANT" | "MANAGER" | "EMPLOYEE";

export type Profile = {
  id: string;
  full_name: string;
  email: string | null;
  role: Role;
  is_active: boolean;
};

export type AppSession = {
  profile: Profile;
  actions: string[];
  locationIds: string[];
  can: (action: string) => boolean;
  canLocation: (locationId: string) => boolean;
};

export const getSession = cache(async (): Promise<AppSession | null> => {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, is_active")
    .eq("id", auth.user.id)
    .maybeSingle();

  if (!profile?.is_active) {
    await supabase.auth.signOut();
    return null;
  }

  const typed = profile as Profile;
  const [{ data: rolePerms }, { data: overrides }, { data: locations }] = await Promise.all([
    supabase.from("role_permissions").select("action").eq("role", typed.role),
    supabase.from("user_permission_overrides").select("action, allowed").eq("user_id", typed.id),
    supabase.from("employee_locations").select("location_id").eq("user_id", typed.id),
  ]);

  const actions = new Set<string>((rolePerms ?? []).map((row) => String((row as { action: string }).action)));
  if (typed.role !== "ADMIN") {
    for (const row of overrides ?? []) {
      const item = row as { action: string; allowed: boolean };
      if (item.allowed) actions.add(item.action);
      else actions.delete(item.action);
    }
  }

  const locationIds = (locations ?? []).map((row) => String((row as { location_id: string }).location_id));
  const companyWide = typed.role === "ADMIN" || typed.role === "ACCOUNTANT";

  return {
    profile: typed,
    actions: [...actions],
    locationIds,
    can: (action) => actions.has(action),
    canLocation: (locationId) => companyWide || locationIds.includes(locationId),
  };
});

export async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function selectedLocation(session: AppSession) {
  const jar = await cookies();
  const value = jar.get("valora-location")?.value;
  if (!value || value === "all") return null;
  return session.canLocation(value) ? value : null;
}
