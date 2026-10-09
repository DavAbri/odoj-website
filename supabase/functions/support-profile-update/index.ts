import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireAdmin, requireActiveSession, logAktion, corsHeaders, json } from "../_shared/support.ts";

// Erlaubte Felder - bewusst eine Erlaubt-Liste (kein Verbots-Liste), damit
// neue/sensible Profile-Spalten NIE automatisch im Support-Modus änderbar
// werden. IBAN, E-Mail, Passwort, SV-Nummer, Geburtsdatum, gesperrt,
// ref_code, Lebenslauf, Datenschutz-Zustimmung etc. sind hier bewusst NICHT
// gelistet und damit über diese Funktion unerreichbar.
const ALLOWED_PROFILE_FIELDS = [
  "firmenname", "vorname", "nachname", "telefon",
  "adresse", "adresse_plz", "adresse_ort",
  "website", "branche", "beschreibung", "uid_nummer",
] as const;

function pickAllowed(src: Record<string, unknown>, allowed: readonly string[]) {
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(src, key)) out[key] = src[key];
  }
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireAdmin(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const { adminId, adminClient } = auth;

  try {
    const { sessionId, fields } = await req.json().catch(() => ({}));

    const sessionCheck = await requireActiveSession(adminClient, adminId, sessionId);
    if (!sessionCheck.ok) return json({ error: sessionCheck.error }, sessionCheck.status);
    const { session } = sessionCheck;

    const safeFields = pickAllowed(fields || {}, ALLOWED_PROFILE_FIELDS);
    if (Object.keys(safeFields).length === 0) {
      return json({ error: "Keine erlaubten Felder zum Ändern übergeben." }, 400);
    }

    const { data, error } = await adminClient
      .from("Profile")
      .update(safeFields)
      .eq("user_id", session.target_user_id)
      .select()
      .single();
    if (error) return json({ error: error.message }, 400);

    await logAktion(adminClient, session.id, "profile_update", "Profile", session.target_user_id, { fields: safeFields });

    return json({ success: true, profile: data }, 200);
  } catch (error) {
    return json({ error: String(error) }, 500);
  }
});
