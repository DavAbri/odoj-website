// Vollautomatische Abwicklung des Arbeitstags (ersetzt den früheren Klick
// "Anwesenheit bestätigen", der die Rechnung ausgelöst hat - siehe Prompt
// "automatische Mails zu Arbeitsbeginn/-ende"):
//
// 1) Bei TERMIN-BEGINN: Arbeitgeber bekommt die Zahlungshinweis-Mail (was er
//    dem Jobber schuldet). Ist es der letzte Termin des Inserats, wird
//    zusätzlich die konsolidierte ODOJ-Rechnung (alle Termine des Inserats)
//    erstellt und als PDF an dieselbe Mail angehängt.
// 2) Bei TERMIN-ENDE: Status wird automatisch auf "abgeschlossen" gesetzt
//    (sofern nicht als "nicht gekommen" gemeldet), Jobber bekommt "Job
//    erledigt, bitte bewerten", Arbeitgeber bekommt "Einsatz beendet, bitte
//    bewerten" - beide nutzen die bereits vorhandene Bewertungsfunktion.
//
// Kein manueller Klick mehr nötig. Meldet jemand über "Nichterscheinen
// melden" (nicht-erschienen.html) nachträglich ein No-Show, ist das laut
// Absprache ein rein manueller Korrekturfall (keine automatische Rechnungs-
// Rückbuchung).
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

    // ── 1) Termin-Beginn erreicht: Zahlungshinweis (+ ggf. Rechnung) ──
    const { data: startFaellig, error: startErr } = await admin.rpc("faellige_termin_start_bewerbungen");
    if (startErr) result.fehler.push("faellige-termin-start: " + startErr.message);

    for (const b of (startFaellig as any[]) || []) {
      let invoiceId: string | null = null;
      if (b.ist_letzter_termin) {
        try {
          const { data: invoice, error: rpcErr } = await admin.rpc("rechnung_erstellen_fuer_job", { p_job_id: b.job_id }).single();
          if (rpcErr) throw rpcErr;
          await persistRechnungPdf(admin, (invoice as any).id).catch((e: any) => console.error("persistRechnungPdf fehlgeschlagen:", e?.message || e));
          invoiceId = (invoice as any).id;
          result.rechnungen_erstellt++;
        } catch (e: any) {
          // "Keine abrechenbare Bewerbung" ist kein Fehler, sondern der
          // Normalfall, wenn für diesen Job (noch) niemand angenommen wurde.
          if (!String(e?.message || "").includes("Keine abrechenbare Bewerbung")) {
            result.fehler.push(`rechnung job ${b.job_id}: ${e?.message || e}`);
          }
        }
      }

      await sendEmail(admin, {
        type: "payment_request",
        recipientId: b.arbeitgeber_id,
        bewId: b.bewerbung_id,
        invoiceId,
      });
      await admin.from("bewerbungen").update({ zahlungshinweis_gesendet_am: new Date().toISOString() }).eq("id", b.bewerbung_id);
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

    return new Response(JSON.stringify({ ok: true, ...result }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("anwesenheit-abwicklung error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: cors });
  }
});
