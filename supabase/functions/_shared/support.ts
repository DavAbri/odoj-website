import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Muss mit der Liste in admin/index.html und admin/login.html übereinstimmen.
export const ADMIN_EMAILS = ["mail4david85@gmail.com", "admin@odoj.at"];

export const SUPPORT_SESSION_MINUTES = 30;

export interface SupportAuthResult {
  ok: true;
  adminId: string;
  adminEmail: string;
  anonClient: ReturnType<typeof createClient>;
  adminClient: ReturnType<typeof createClient>;
}
export interface SupportAuthError {
  ok: false;
  status: number;
  error: string;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Verifiziert den Aufrufer über sein eigenes Token (nicht nur, was der Client
// behauptet) und prüft gegen die Admin-E-Mail-Liste - gleiches Muster wie
// admin-delete-user/admin-user-detail.
export async function requireAdmin(req: Request): Promise<SupportAuthResult | SupportAuthError> {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return { ok: false, status: 401, error: "Nicht angemeldet." };

  const anonClient = createClient(SUPABASE_URL, ANON_KEY);
  const { data: callerData, error: callerErr } = await anonClient.auth.getUser(token);
  if (callerErr || !callerData?.user) return { ok: false, status: 401, error: "Ungültige Sitzung." };

  const adminEmail = (callerData.user.email || "").toLowerCase();
  if (!ADMIN_EMAILS.includes(adminEmail)) {
    return { ok: false, status: 403, error: "Kein Zugriff auf diese Funktion." };
  }

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  return { ok: true, adminId: callerData.user.id, adminEmail, anonClient, adminClient };
}

export interface ActiveSession {
  id: string;
  admin_id: string;
  target_user_id: string;
  grund: string;
  gestartet_am: string;
  beendet_am: string | null;
}

// Prüft bei JEDEM Aufruf neu (keine Behauptung des Clients wird vertraut):
// Session existiert, gehört genau diesem Admin, ist nicht beendet, ist nicht
// älter als SUPPORT_SESSION_MINUTES, und richtet sich genau gegen targetUserId
// (falls angegeben - bei session-end wird targetUserId nicht geprüft).
export async function requireActiveSession(
  adminClient: ReturnType<typeof createClient>,
  adminId: string,
  sessionId: string,
  targetUserId?: string
): Promise<{ ok: true; session: ActiveSession } | SupportAuthError> {
  if (!sessionId) return { ok: false, status: 400, error: "Keine Support-Session angegeben." };

  const { data: session, error } = await adminClient
    .from("support_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();

  if (error || !session) return { ok: false, status: 404, error: "Support-Session nicht gefunden." };
  if (session.admin_id !== adminId) return { ok: false, status: 403, error: "Diese Support-Session gehört nicht dir." };
  if (session.beendet_am) return { ok: false, status: 403, error: "Diese Support-Session wurde bereits beendet." };

  const startedAt = new Date(session.gestartet_am).getTime();
  const ageMinutes = (Date.now() - startedAt) / 60000;
  if (ageMinutes > SUPPORT_SESSION_MINUTES) {
    return { ok: false, status: 403, error: "Diese Support-Session ist nach 30 Minuten abgelaufen. Bitte neu starten." };
  }

  if (targetUserId && session.target_user_id !== targetUserId) {
    return { ok: false, status: 403, error: "Diese Support-Session gilt für einen anderen Nutzer." };
  }

  return { ok: true, session: session as ActiveSession };
}

export async function logAktion(
  adminClient: ReturnType<typeof createClient>,
  supportSessionId: string,
  aktionTyp: string,
  tabelle: string | null,
  rowId: string | null,
  details: Record<string, unknown> | null
) {
  await adminClient.from("support_aktionen").insert({
    support_session_id: supportSessionId,
    aktion_typ: aktionTyp,
    tabelle,
    row_id: rowId,
    details,
  });
}

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
