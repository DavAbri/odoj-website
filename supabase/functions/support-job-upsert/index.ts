import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireAdmin, requireActiveSession, logAktion, corsHeaders, json } from "../_shared/support.ts";

// Erlaubte Felder für ein Inserat im Support-Modus - exakt dieselben, die das
// normale Arbeitgeber-Formular (meine-inserate.html) verwendet. Alles, was
// nicht hier aufgeführt ist, wird ignoriert, selbst wenn es im Request steckt.
const ALLOWED_JOB_FIELDS = [
  "titel", "branche", "datum", "uhrzeit_von", "uhrzeit_bis", "stundenanzahl",
  "tagesgehalt", "adresse", "ort", "plaetze", "mindestalter", "beschreibung",
  "status", "mindest_termine",
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
    const body = await req.json().catch(() => ({}));
    const { sessionId, jobId, fields, termine } = body;

    const sessionCheck = await requireActiveSession(adminClient, adminId, sessionId);
    if (!sessionCheck.ok) return json({ error: sessionCheck.error }, sessionCheck.status);
    const { session } = sessionCheck;

    const safeFields = pickAllowed(fields || {}, ALLOWED_JOB_FIELDS);

    let resultJob;
    if (jobId) {
      // Bestehendes Inserat bearbeiten - muss wirklich dem Ziel-Arbeitgeber gehören.
      const { data: existing, error: exErr } = await adminClient
        .from("jobs").select("id, arbeitgeber_id").eq("id", jobId).maybeSingle();
      if (exErr || !existing) return json({ error: "Inserat nicht gefunden." }, 404);
      if (existing.arbeitgeber_id !== session.target_user_id) {
        return json({ error: "Dieses Inserat gehört nicht zum Ziel-Arbeitgeber dieser Support-Session." }, 403);
      }
      const { data, error } = await adminClient
        .from("jobs").update(safeFields).eq("id", jobId).select().single();
      if (error) return json({ error: error.message }, 400);
      resultJob = data;
      await logAktion(adminClient, session.id, "job_update", "jobs", jobId, { fields: safeFields });
    } else {
      // Neues Inserat - firmenname aus dem Zielprofil übernehmen, arbeitgeber_id fix auf das Ziel.
      const { data: targetProfile } = await adminClient
        .from("Profile").select("firmenname").eq("user_id", session.target_user_id).maybeSingle();

      const { data, error } = await adminClient
        .from("jobs")
        .insert({
          ...safeFields,
          arbeitgeber_id: session.target_user_id,
          firmenname: targetProfile?.firmenname || "",
          status: safeFields.status || "aktiv",
        })
        .select().single();
      if (error) return json({ error: error.message }, 400);
      resultJob = data;
      await logAktion(adminClient, session.id, "job_create", "jobs", resultJob.id, { fields: safeFields });
    }

    // Optional: Termine (Mehrfach-Tage) mitgeben - ersetzt die bestehenden
    // Termine dieses Jobs komplett, gleiches Verhalten wie das normale Formular.
    if (Array.isArray(termine)) {
      await adminClient.from("job_termine").delete().eq("job_id", resultJob.id);
      if (termine.length > 0) {
        const rows = termine
          .filter((t: Record<string, unknown>) => t && t.datum)
          .map((t: Record<string, unknown>) => ({
            job_id: resultJob.id,
            datum: t.datum,
            uhrzeit_von: t.uhrzeit_von || null,
            uhrzeit_bis: t.uhrzeit_bis || null,
          }));
        if (rows.length > 0) {
          const { error: termErr } = await adminClient.from("job_termine").insert(rows);
          if (termErr) return json({ error: "Inserat gespeichert, aber Termine fehlgeschlagen: " + termErr.message, job: resultJob }, 207);
        }
      }
      await logAktion(adminClient, session.id, "job_termine_set", "job_termine", resultJob.id, { anzahl: termine.length });
    }

    return json({ success: true, job: resultJob }, 200);
  } catch (error) {
    return json({ error: String(error) }, 500);
  }
});
