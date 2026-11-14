// Wer ruft eine Server-Funktion auf? (Sicherheit 14.11.2026)
// - istServiceAufruf: nur die Plattform selbst (5-Minuten-Lauf, Datenbank-
//   Trigger) - echter Plattform-Schlüssel, nicht nur behauptet.
// - angemeldeterNutzer: der angemeldete Nutzer laut gültigem Anmelde-Token.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export const ADMIN_EMAILS = ["admin@odoj.at", "david.aberer@odoj.at", "sebastian.wimmer@odoj.at"];

export function bearerToken(req: Request): string {
  const h = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  return h.replace(/^Bearer\s+/i, "").trim();
}

function jwtRolle(token: string): string | null {
  try {
    let teil = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    while (teil.length % 4) teil += "=";
    return JSON.parse(atob(teil)).role ?? null;
  } catch {
    return null;
  }
}

export async function istServiceAufruf(req: Request): Promise<boolean> {
  const token = bearerToken(req);
  if (!token) return false;
  if (token === SERVICE_KEY) return true;
  if (jwtRolle(token) !== "service_role") return false;
  // Behauptete Plattform-Rolle echt prüfen: nur der echte Schlüssel darf
  // Nutzerkonten auflisten - ein gefälschtes Token scheitert hier.
  const c = createClient(SUPABASE_URL, token, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.admin.listUsers({ page: 1, perPage: 1 });
  return !error;
}

export async function angemeldeterNutzer(req: Request, admin: any): Promise<{ id: string; email: string } | null> {
  const token = bearerToken(req);
  if (!token || jwtRolle(token) !== "authenticated") return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;
  return { id: data.user.id, email: (data.user.email || "").toLowerCase() };
}
