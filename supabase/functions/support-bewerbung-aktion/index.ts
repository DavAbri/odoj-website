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
  if (aktion !== "anwesenheit_bestaetigt" && aktion !== "nicht_gekommen" && aktion !== "annehmen" && aktion !== "ablehnen") {
    return json({ error: "Unbekannte Aktion." }, 400);
  }

  const { data: bew, error: bewErr } = await auth.adminClient
    .from("bewerbungen")
    .select("id, job_id, jobber_id, termin_id, status, anwesenheit_bestaetigt, nicht_gekommen, jobs(arbeitgeber_id, titel, firmenname, plaetze, status)")
    .eq("id", bewId)
    .maybeSingle();
  if (bewErr || !bew) return json({ error: "Bewerbung nicht gefunden." }, 404);

  const targetUserId = (bew as any).jobs?.arbeitgeber_id;
  if (!targetUserId) return json({ error: "Arbeitgeber der Bewerbung nicht gefunden." }, 404);

  const sess = await requireActiveSession(auth.adminClient, auth.adminId, sessionId, targetUserId);
  if (!sess.ok) return json({ error: sess.error }, sess.status);

  if ((aktion === "anwesenheit_bestaetigt" || aktion === "nicht_gekommen") && (bew.anwesenheit_bestaetigt || bew.nicht_gekommen)) {
    return json({ error: "Für diese Bewerbung liegt bereits eine Entscheidung vor." }, 409);
  }

  // D3/E3: Annehmen/Ablehnen lief bisher NUR über den direkten Client-Schreib-
  // zugriff - im Support-Modus griff die RLS-Policy "Bewerbungen" (auth.uid()
  // = arbeitgeber_id) dann nicht, die Annahme blieb eine stille No-Op (0 Zeilen
  // geändert, kein Fehler) und die Folge-Mail an den Arbeitgeber ("Bewerbung
  // angenommen" + Datenblatt) blieb aus, obwohl der Jobber im Chat schon eine
  // Zusage-Nachricht sah. Gleiches Muster wie oben: läuft jetzt als service_role.
  if (aktion === "annehmen" || aktion === "ablehnen") {
    const newStatus = aktion === "annehmen" ? "angenommen" : "abgelehnt";
    const updatePayload: Record<string, unknown> = { status: newStatus };
    if (newStatus === "angenommen") updatePayload.annahme_gesehen = false;

    const { error: updErr3 } = await auth.adminClient.from("bewerbungen").update(updatePayload).eq("id", bewId);
    if (updErr3) return json({ error: updErr3.message }, 400);

    // Automatische Job-Deaktivierung bei voller Belegung (nur Einzeltag-
    // Bewerbungen, gleiche Logik/Einschränkung wie im Client).
    if (newStatus === "angenommen" && bew.job_id && !(bew as any).termin_id) {
      const job = (bew as any).jobs;
      if (job?.status === "aktiv") {
        const { count } = await auth.adminClient
          .from("bewerbungen")
          .select("id", { count: "exact", head: true })
          .eq("job_id", bew.job_id)
          .eq("status", "angenommen");
        if ((count || 0) >= (job.plaetze || 0)) {
          await auth.adminClient.from("jobs").update({ status: "inaktiv" }).eq("id", bew.job_id);
        }
      }
    }

    const jobTitel = (bew as any).jobs?.titel || "den Job";
    const firma    = (bew as any).jobs?.firmenname || "uns";
    const nachricht = newStatus === "angenommen"
      ? `Herzlichen Glückwunsch! Deine Bewerbung für ${jobTitel} bei ${firma} wurde angenommen! Wir freuen uns auf deinen Einsatz. Bei Fragen kannst du uns hier direkt schreiben. Bis bald!`
      : `Vielen Dank für deine Bewerbung für ${jobTitel}. Leider müssen wir dir mitteilen, dass wir deine Bewerbung diesmal nicht berücksichtigen können. Wir wünschen dir viel Erfolg bei deiner weiteren Jobsuche!`;

    await auth.adminClient.from("nachrichten").insert({
      bewerbung_id: bewId, sender_id: targetUserId, empfaenger_id: bew.jobber_id,
      nachricht, gelesen: false, erstellt_am: new Date().toISOString(),
    });

    await logAktion(auth.adminClient, sess.session.id, aktion, "bewerbungen", bewId, null);
    return json({ ok: true, jobberId: bew.jobber_id }, 200);
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
