// Support-Modus: "Anwesenheit bestätigen" und "nicht gekommen" melden laufen
// im Namen eines vertretenen Arbeitgebers NICHT über die direkten
// Client-Schreibzugriffe (bewerbungen.update, nachrichten.insert), die in
// diesem Modus mit der echten Admin-Sitzung aufgerufen würden - die
// bestehenden RLS-Policies auf diesen Tabellen matchen dann keine Zeile
// (0 betroffene Zeilen, aber HTTP 204 "Erfolg" - eine gefährliche stille
// No-Op, kein Fehler). Läuft deshalb wie support-job-upsert als
// service_role, mit denselben Prüfungen wie überall im Support-Zugriff
// (Admin + aktive Session, genau für diesen Arbeitgeber).
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireAdmin, requireActiveSession, logAktion, corsHeaders, json } from "../_shared/support.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireAdmin(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const body = await req.json().catch(() => ({}));
  const { sessionId, bewId, aktion, grund } = body || {};
  if (!bewId || !aktion) return json({ error: "bewId oder aktion fehlt." }, 400);
  if (aktion !== "anwesenheit_bestaetigt" && aktion !== "nicht_gekommen") {
    return json({ error: "Unbekannte Aktion." }, 400);
  }

  const { data: bew, error: bewErr } = await auth.adminClient
    .from("bewerbungen")
    .select("id, job_id, jobber_id, status, anwesenheit_bestaetigt, nicht_gekommen, jobs(arbeitgeber_id)")
    .eq("id", bewId)
    .maybeSingle();
  if (bewErr || !bew) return json({ error: "Bewerbung nicht gefunden." }, 404);

  const targetUserId = (bew as any).jobs?.arbeitgeber_id;
  if (!targetUserId) return json({ error: "Arbeitgeber der Bewerbung nicht gefunden." }, 404);

  const sess = await requireActiveSession(auth.adminClient, auth.adminId, sessionId, targetUserId);
  if (!sess.ok) return json({ error: sess.error }, sess.status);

  if (bew.anwesenheit_bestaetigt || bew.nicht_gekommen) {
    return json({ error: "Für diese Bewerbung liegt bereits eine Entscheidung vor." }, 409);
  }

  if (aktion === "anwesenheit_bestaetigt") {
    const { error: updErr } = await auth.adminClient
      .from("bewerbungen")
      .update({ anwesenheit_bestaetigt: true, bestaetigt_am: new Date().toISOString(), status: "abgeschlossen" })
      .eq("id", bewId);
    // Der bestehende Zeitsperre-Trigger (A1) gilt unverändert auch hier -
    // ein zu früher Versuch schlägt mit derselben Fehlermeldung fehl.
    if (updErr) return json({ error: updErr.message }, 400);

    const systemMsg = `Einsatz erfolgreich abgeschlossen!\n\nVielen Dank für deinen Einsatz heute – du hast großartige Arbeit geleistet! Deine Anwesenheit wurde von uns offiziell bestätigt.\n\nWir freuen uns, dich bald wieder bei einem Einsatz dabei zu haben!\n\n– Team ODOJ`;
    await auth.adminClient.from("nachrichten").insert({
      bewerbung_id: bewId, sender_id: targetUserId, empfaenger_id: bew.jobber_id,
      nachricht: systemMsg, gelesen: false, erstellt_am: new Date().toISOString(),
    });

    const { data: jobRow } = await auth.adminClient.from("jobs").select("titel, firmenname").eq("id", bew.job_id).maybeSingle();
    const bewReqPayload = JSON.stringify({ jobId: bew.job_id, bewId, agId: targetUserId, firmenname: jobRow?.firmenname || "" });
    await auth.adminClient.from("nachrichten").insert({
      bewerbung_id: bewId, sender_id: targetUserId, empfaenger_id: bew.jobber_id,
      nachricht: "[BEW_REQ:" + bewReqPayload + "]", gelesen: false, erstellt_am: new Date().toISOString(),
    });

    await logAktion(auth.adminClient, sess.session.id, "anwesenheit_bestaetigt", "bewerbungen", bewId, null);
    return json({ ok: true, jobTitel: jobRow?.titel || "" }, 200);
  }

  // nicht_gekommen
  const { error: updErr2 } = await auth.adminClient
    .from("bewerbungen")
    .update({ nicht_gekommen: true, nicht_gekommen_am: new Date().toISOString(), nicht_gekommen_grund: grund || null })
    .eq("id", bewId);
  if (updErr2) return json({ error: updErr2.message }, 400);

  await logAktion(auth.adminClient, sess.session.id, "nicht_gekommen", "bewerbungen", bewId, { grund: grund || null });
  return json({ ok: true }, 200);
});
