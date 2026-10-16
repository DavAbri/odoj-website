// Vollautomatische Abwicklung des Arbeitstags (siehe Prompts "automatische
// Mails zu Arbeitsbeginn/-ende" und "Rechnung getrennt"):
//
// 1) Bei TERMIN-BEGINN: Arbeitgeber bekommt EINE Zahlungshinweis-Mail pro
//    Termin (nicht pro Bewerbung!) mit allen angenommenen Jobbern dieses
//    Termins. Reiner Lohn-Teil, OHNE ODOJ-Rechnung.
// 2) Bei TERMIN-ENDE: Status wird automatisch auf "abgeschlossen" gesetzt
//    (sofern nicht als "nicht gekommen" gemeldet), Jobber bekommt "Job
//    erledigt, bitte bewerten", Arbeitgeber bekommt "Einsatz beendet, bitte
//    bewerten" - beide nutzen die bereits vorhandene Bewertungsfunktion.
// 3) Ist für ein Inserat der LETZTE Termin zu Ende und wurde noch keine
//    Rechnung erstellt, wird jetzt (unabhängig/entkoppelt von Schritt 1+2)
//    die konsolidierte ODOJ-Rechnung (alle Termine dieses Inserats) als
//    eigene, separate Mail erstellt und verschickt.
//
// Kein manueller Klick mehr nötig. Meldet jemand über "Nichterscheinen
// melden" (nicht-erschienen.html) nachträglich ein No-Show, ist das laut
// Absprache ein rein manueller Korrekturfall (keine automatische Rechnungs-
// Rückbuchung). Nach Terminbeginn kann ohnehin niemand mehr angenommen
// werden (siehe DB-Trigger pruefe_termin_nicht_begonnen), die Jobber-Liste
// eines Termins steht beim Versand der Zahlungshinweis-Mail also fest.
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { persistRechnungPdf } from "../_shared/rechnung.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function todayIso(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Vienna" }); // YYYY-MM-DD
}

async function sendEmail(admin: any, body: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error("send-email fehlgeschlagen:", await res.text());
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const heute = todayIso();

  const result = { auto_abgelehnt: 0, zahlungshinweis_mails: 0, rechnungen_erstellt: 0, ende_mails: 0, fehler: [] as string[] };

  try {
    // ── 0) E2: unbeantwortete Bewerbungen nach Ablauf des Einsatzdatums ──
    // (unverändert - nur status='ausstehend' wird angefasst, 'angenommen' bleibt unberührt)
    const [rLegacy, rMulti] = await Promise.all([
      admin.from("bewerbungen")
        .select("id, jobs!inner(datum)")
        .is("termin_id", null)
        .eq("status", "ausstehend")
        .lt("jobs.datum", heute),
      admin.from("bewerbungen")
        .select("id, job_termine!inner(datum)")
        .not("termin_id", "is", null)
        .eq("status", "ausstehend")
        .lt("job_termine.datum", heute),
    ]);
    if (rLegacy.error) result.fehler.push("auto-reject-query (einzeltag): " + rLegacy.error.message);
    if (rMulti.error)  result.fehler.push("auto-reject-query (mehrtermin): " + rMulti.error.message);

    const autoRejectIds = [...(rLegacy.data || []).map((b: any) => b.id), ...(rMulti.data || []).map((b: any) => b.id)];
    if (autoRejectIds.length) {
      const { error: rejErr } = await admin.from("bewerbungen").update({ status: "abgelehnt" }).in("id", autoRejectIds);
      if (rejErr) result.fehler.push("auto-reject-update: " + rejErr.message);
      else result.auto_abgelehnt = autoRejectIds.length;
    }

    // ── 1) Termin-Beginn erreicht: EIN Zahlungshinweis pro Termin ──
    // (alle angenommenen Jobber dieses Termins zusammen in einer Mail,
    // kein ODOJ-Rechnungsteil mehr - die Rechnung läuft jetzt entkoppelt
    // als Schritt 3 unten).
    const { data: startFaellig, error: startErr } = await admin.rpc("faellige_termin_start_bewerbungen");
    if (startErr) result.fehler.push("faellige-termin-start: " + startErr.message);

    const terminGruppen = new Map<string, { arbeitgeberId: string; bewIds: string[] }>();
    for (const b of (startFaellig as any[]) || []) {
      const key = `${b.job_id}|${b.termin_id || "single"}`;
      if (!terminGruppen.has(key)) terminGruppen.set(key, { arbeitgeberId: b.arbeitgeber_id, bewIds: [] });
      terminGruppen.get(key)!.bewIds.push(b.bewerbung_id);
    }

    for (const { arbeitgeberId, bewIds } of terminGruppen.values()) {
      await sendEmail(admin, {
        type: "payment_request",
        recipientId: arbeitgeberId,
        bewIds,
      });
      await admin.from("bewerbungen").update({ zahlungshinweis_gesendet_am: new Date().toISOString() }).in("id", bewIds);
      result.zahlungshinweis_mails++;
    }

    // ── 2) Termin-Ende erreicht: abschließen + beide um Bewertung bitten ──
    const { data: endeFaellig, error: endeErr } = await admin.rpc("faellige_termin_ende_bewerbungen");
    if (endeErr) result.fehler.push("faellige-termin-ende: " + endeErr.message);

    for (const b of (endeFaellig as any[]) || []) {
      const nowIso = new Date().toISOString();
      await admin.from("bewerbungen").update({
        anwesenheit_bestaetigt: true,
        bestaetigt_am: nowIso,
        status: "abgeschlossen",
        ende_mail_gesendet_am: nowIso,
      }).eq("id", b.bewerbung_id);

      const [{ data: job }, { data: agProfile }] = await Promise.all([
        admin.from("jobs").select("titel").eq("id", b.job_id).maybeSingle(),
        admin.from("Profile").select("firmenname").eq("user_id", b.arbeitgeber_id).maybeSingle(),
      ]);
      const jobTitel   = (job as any)?.titel || "Tagesjob";
      const firmenname = (agProfile as any)?.firmenname || "";

      // System-Chatnachricht + BEW_REQ (gleiche Logik wie bisher der manuelle Klick)
      const systemMsg = `Einsatz erfolgreich abgeschlossen!\n\nVielen Dank für deinen Einsatz heute – du hast großartige Arbeit geleistet! Deine Anwesenheit wurde von uns offiziell bestätigt.\n\nWir freuen uns, dich bald wieder bei einem Einsatz dabei zu haben!\n\n– Team ODOJ`;
      await admin.from("nachrichten").insert({
        bewerbung_id: b.bewerbung_id, sender_id: b.arbeitgeber_id, empfaenger_id: b.jobber_id,
        nachricht: systemMsg, gelesen: false, erstellt_am: nowIso,
      });
      const bewReqPayload = JSON.stringify({ jobId: b.job_id, bewId: b.bewerbung_id, agId: b.arbeitgeber_id, firmenname });
      await admin.from("nachrichten").insert({
        bewerbung_id: b.bewerbung_id, sender_id: b.arbeitgeber_id, empfaenger_id: b.jobber_id,
        nachricht: "[BEW_REQ:" + bewReqPayload + "]", gelesen: false, erstellt_am: nowIso,
      });

      await sendEmail(admin, { type: "work_confirmed", recipientId: b.jobber_id, firmenname, jobTitel, bewId: b.bewerbung_id });
      await sendEmail(admin, { type: "einsatz_erledigt_arbeitgeber", recipientId: b.arbeitgeber_id, jobTitel, bewId: b.bewerbung_id, jobId: b.job_id, jobberId: b.jobber_id });
      result.ende_mails++;
    }

    // ── 3) Letzter Termin eines Inserats zu Ende: ODOJ-Rechnung (eigene Mail) ──
    const { data: rechnungFaellig, error: rechErr } = await admin.rpc("faellige_rechnung_jobs");
    if (rechErr) result.fehler.push("faellige-rechnung-jobs: " + rechErr.message);

    for (const j of (rechnungFaellig as any[]) || []) {
      try {
        const { data: invoice, error: rpcErr } = await admin.rpc("rechnung_erstellen_fuer_job", { p_job_id: j.job_id }).single();
        if (rpcErr) throw rpcErr;
        await persistRechnungPdf(admin, (invoice as any).id).catch((e: any) => console.error("persistRechnungPdf fehlgeschlagen:", e?.message || e));
        await sendEmail(admin, { type: "rechnung_erstellt", recipientId: j.arbeitgeber_id, invoiceId: (invoice as any).id });
        result.rechnungen_erstellt++;
      } catch (e: any) {
        // "Keine abrechenbare Bewerbung" kommt hier praktisch nie vor (die
        // RPC filtert das schon), aber sicherheitshalber gleich behandelt
        // wie zuvor - kein Fehler, nur kein Rechnungs-Versand.
        if (!String(e?.message || "").includes("Keine abrechenbare Bewerbung")) {
          result.fehler.push(`rechnung job ${j.job_id}: ${e?.message || e}`);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, ...result }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("anwesenheit-abwicklung error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: cors });
  }
});
