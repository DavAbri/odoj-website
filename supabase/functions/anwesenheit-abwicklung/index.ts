// Geplante Funktion (wie payment-reminders) - läuft periodisch, ersetzt den
// früheren Zusammenhang "Anwesenheit bestätigen -> sofort Rechnung" durch
// zwei entkoppelte Schritte (Block A2/A4/A5 + B1/B2/B5):
//
// 1) Sobald der Einsatzbeginn eines Arbeitstags erreicht ist und für die
//    jeweilige Bewerbung noch keine Entscheidung vorliegt, bekommt der
//    Arbeitgeber die Mail "Anwesenheit bestätigen / nicht gekommen".
// 2) Erst sobald der letzte Arbeitstag eines Jobs vorbei ist UND für ALLE
//    angenommenen Bewerbungen dieses Jobs eine Entscheidung vorliegt, wird
//    EINE konsolidierte Rechnung für den ganzen Job erstellt und versendet
//    (rechnung_erstellen_fuer_job, itemisiert - siehe Migration).
// 3) Fehlt die Entscheidung einen Tag nach dem letzten Arbeitstag noch,
//    bekommt der Arbeitgeber eine Erinnerungsmail.
// 4) Fehlt sie noch immer 3+ Tage danach, wird NICHT automatisch abgerechnet
//    - stattdessen eine Mail an info@odoj.at und eine Sperre (rechnung_blockiert),
//    die im Admin sichtbar ist. Eine falsche automatische Rechnung ist
//    schlimmer als eine verspätete (Nutzerentscheidung, siehe Prompt-Antwort 4).
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function todayIso(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Vienna" }); // YYYY-MM-DD
}
function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().split("T")[0];
}
function einsatzStart(datum: string, uhrzeitVon: string | null): Date {
  return new Date(`${datum}T${(uhrzeitVon || "00:00").slice(0, 5)}:00+01:00`);
  // Hinweis: feste UTC+1-Näherung wie an anderen Stellen dieses Projekts nicht
  // vorhanden - um DST-Fehler zu vermeiden, wird unten zusätzlich grob mit
  // 2h Toleranz gegen "jetzt" verglichen (lieber einmal zu früh als nie).
}

async function sendEmail(admin: ReturnType<typeof createClient>, body: Record<string, unknown>) {
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
  const gesternIso = isoDaysAgo(1);
  const dreiTageVorIso = isoDaysAgo(3);

  const result = { einsatzbeginn_mails: 0, rechnungen_erstellt: 0, rechnung_erinnerungen: 0, rechnung_blockiert: 0, fehler: [] as string[] };

  try {
    // ── 1) Einsatzbeginn erreicht, noch keine Entscheidung + noch keine Mail ──
    const [eLegacy, eMulti] = await Promise.all([
      admin.from("bewerbungen")
        .select("id, jobber_id, jobs!inner(id, titel, datum, uhrzeit_von, arbeitgeber_id)")
        .is("termin_id", null)
        .eq("status", "angenommen")
        .eq("anwesenheit_bestaetigt", false)
        .eq("nicht_gekommen", false)
        .is("einsatzbeginn_mail_gesendet_am", null)
        .lte("jobs.datum", heute),
      admin.from("bewerbungen")
        .select("id, jobber_id, jobs(id, titel, arbeitgeber_id), job_termine!inner(datum, uhrzeit_von)")
        .not("termin_id", "is", null)
        .eq("status", "angenommen")
        .eq("anwesenheit_bestaetigt", false)
        .eq("nicht_gekommen", false)
        .is("einsatzbeginn_mail_gesendet_am", null)
        .lte("job_termine.datum", heute),
    ]);
    if (eLegacy.error) result.fehler.push("einsatzbeginn-query (einzeltag): " + eLegacy.error.message);
    if (eMulti.error)  result.fehler.push("einsatzbeginn-query (mehrtermin): " + eMulti.error.message);

    const jetzt = Date.now();
    const einsatzbeginnFaellig = [
      ...(eLegacy.data || []).map((b: any) => ({ ...b, datum: b.jobs?.datum, uhrzeit_von: b.jobs?.uhrzeit_von, arbeitgeber_id: b.jobs?.arbeitgeber_id, job_titel: b.jobs?.titel })),
      ...(eMulti.data || []).map((b: any) => ({ ...b, datum: b.job_termine?.datum, uhrzeit_von: b.job_termine?.uhrzeit_von, arbeitgeber_id: b.jobs?.arbeitgeber_id, job_titel: b.jobs?.titel })),
    ].filter((b: any) => b.datum && einsatzStart(b.datum, b.uhrzeit_von).getTime() - 2 * 3600_000 <= jetzt);

    for (const b of einsatzbeginnFaellig) {
      if (!b.arbeitgeber_id) continue;
      await sendEmail(admin, {
        type: "einsatzbeginn_anwesenheit",
        recipientId: b.arbeitgeber_id,
        jobTitel: b.job_titel || "Tagesjob",
        bewId: b.id,
      });
      await admin.from("bewerbungen").update({ einsatzbeginn_mail_gesendet_am: new Date().toISOString() }).eq("id", b.id);
      await admin.from("notifications").insert({
        user_id: b.arbeitgeber_id,
        type: "anwesenheit_faellig",
        message: `Bitte Anwesenheit für "${b.job_titel || "Tagesjob"}" bestätigen.`,
        link: "meine-inserate.html",
        read: false,
      });
      result.einsatzbeginn_mails++;
    }

    // ── 2-4) Rechnungs-Abwicklung je Job ──────────────────────────────────
    const { data: alleAngenommen, error: angErr } = await admin
      .from("bewerbungen")
      .select("id, job_id, anwesenheit_bestaetigt, nicht_gekommen, termin_id, jobs!inner(id, titel, datum, arbeitgeber_id, rechnung_blockiert, rechnung_erinnerung_gesendet_am), job_termine(datum)")
      .eq("status", "angenommen");
    if (angErr) result.fehler.push("job-abwicklung-query: " + angErr.message);

    const { data: bestehendeRechnungen } = await admin.from("invoices").select("job_id");
    const jobsMitRechnung = new Set((bestehendeRechnungen || []).map((r: any) => r.job_id));

    const jobsMap = new Map<string, { job: any; bewerbungen: any[]; letzterTag: string | null }>();
    for (const b of alleAngenommen || []) {
      const job = (b as any).jobs;
      if (!job || jobsMitRechnung.has(job.id)) continue;
      const tag = (b as any).job_termine?.datum || job.datum || null;
      if (!jobsMap.has(job.id)) jobsMap.set(job.id, { job, bewerbungen: [], letzterTag: null });
      const entry = jobsMap.get(job.id)!;
      entry.bewerbungen.push(b);
      if (tag && (!entry.letzterTag || tag > entry.letzterTag)) entry.letzterTag = tag;
    }

    for (const [jobId, entry] of jobsMap) {
      if (!entry.letzterTag || entry.letzterTag >= heute) continue; // letzter Tag noch nicht vorbei
      const vollstaendigEntschieden = entry.bewerbungen.every((b: any) => b.anwesenheit_bestaetigt || b.nicht_gekommen);
      const tageSeitLetztemTag = Math.floor((new Date(heute).getTime() - new Date(entry.letzterTag).getTime()) / 86_400_000);

      if (vollstaendigEntschieden) {
        // ── 2) Rechnung erstellen + senden ──
        try {
          const { data: invoice, error: rpcErr } = await admin.rpc("rechnung_erstellen_fuer_job", { p_job_id: jobId }).single();
          if (rpcErr) throw rpcErr;
          const { data: settings } = await admin.from("einstellungen").select("schluessel, wert_text").in("schluessel", ["odoj_iban", "odoj_uid_nummer"]);
          const iban = settings?.find((s: any) => s.schluessel === "odoj_iban")?.wert_text || "";
          const uid  = settings?.find((s: any) => s.schluessel === "odoj_uid_nummer")?.wert_text || "";
          const ibanGueltig = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(iban.replace(/\s+/g, "").toUpperCase());
          if (ibanGueltig) {
            await sendEmail(admin, { type: "rechnung_erstellt", recipientId: (invoice as any).arbeitgeber_id, invoiceId: (invoice as any).id });
          } else {
            // B4: Versand stoppt, solange die IBAN noch ein Platzhalter ist - Admin sieht die Warnung.
            await admin.from("notifications").insert({
              user_id: (invoice as any).arbeitgeber_id,
              type: "rechnung_iban_fehlt",
              message: `Rechnung ${(invoice as any).invoice_number} wurde erstellt, aber NICHT versendet - ODOJ-IBAN ist noch nicht hinterlegt.`,
              link: "admin/index.html",
              read: false,
            });
          }
          result.rechnungen_erstellt++;
        } catch (e: any) {
          // "Keine abrechenbare Bewerbung" ist kein Fehler, sondern der
          // Normalfall, wenn alle Bewerbungen dieses Jobs abgesagt/nicht
          // gekommen sind - dann entsteht bewusst keine Rechnung (B5).
          if (!String(e?.message || "").includes("Keine abrechenbare Bewerbung")) {
            result.fehler.push(`rechnung job ${jobId}: ${e?.message || e}`);
          }
        }
      } else if (tageSeitLetztemTag >= 3 && !entry.job.rechnung_blockiert) {
        // ── 4) Stopp + Admin benachrichtigen ──
        await admin.from("jobs").update({ rechnung_blockiert: true, rechnung_blockiert_am: new Date().toISOString() }).eq("id", jobId);
        await sendEmail(admin, {
          type: "rechnung_blockiert_intern",
          recipientId: entry.job.arbeitgeber_id,
          jobTitel: entry.job.titel || "Tagesjob",
        });
        result.rechnung_blockiert++;
      } else if (tageSeitLetztemTag >= 1 && !entry.job.rechnung_erinnerung_gesendet_am) {
        // ── 3) Erinnerung einen Tag nach dem letzten Arbeitstag ──
        await sendEmail(admin, {
          type: "rechnung_erinnerung",
          recipientId: entry.job.arbeitgeber_id,
          jobTitel: entry.job.titel || "Tagesjob",
        });
        await admin.from("jobs").update({ rechnung_erinnerung_gesendet_am: new Date().toISOString() }).eq("id", jobId);
        result.rechnung_erinnerungen++;
      }
    }

    return new Response(JSON.stringify({ ok: true, ...result }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("anwesenheit-abwicklung error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: cors });
  }
});
