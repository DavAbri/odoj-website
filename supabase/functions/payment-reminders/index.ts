import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function isoDateDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().split("T")[0];
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

  const jobberReminderDatum = isoDateDaysAgo(3);
  const agReminderDatum     = isoDateDaysAgo(5);
  const ueberfaelligDatum   = isoDateDaysAgo(10);

  const result = { jobber_reminder: 0, ag_reminder: 0, ueberfaellig: 0, fehler: [] as string[] };

  try {
    // ── 1) Jobber-Reminder: 3 Tage nach Einsatz, Zahlung noch ausstehend ──
    const { data: jobberFaellig, error: jErr } = await admin
      .from("bewerbungen")
      .select("id, jobber_id, jobs!inner(titel, datum)")
      .eq("anwesenheit_bestaetigt", true)
      .eq("zahlung_status", "ausstehend")
      .is("jobber_reminder_gesendet_am", null)
      .eq("jobs.datum", jobberReminderDatum);
    if (jErr) result.fehler.push("jobber-query: " + jErr.message);

    for (const b of jobberFaellig || []) {
      const { data: { user } } = await admin.auth.admin.getUserById(b.jobber_id);
      if (!user?.email) continue;
      const { data: profile } = await admin.from("Profile").select("vorname").eq("user_id", b.jobber_id).single();
      await sendEmail(admin, {
        type: "payment_reminder_jobber",
        recipientId: b.jobber_id,
        jobTitel: (b as any).jobs?.titel || "Tagesjob",
        bewId: b.id,
      });
      await admin.from("bewerbungen").update({ jobber_reminder_gesendet_am: new Date().toISOString() }).eq("id", b.id);
      result.jobber_reminder++;
    }

    // ── 2) Arbeitgeber-Reminder: 5 Tage nach Einsatz, Zahlung noch ausstehend ──
    const { data: agFaellig, error: aErr } = await admin
      .from("bewerbungen")
      .select("id, jobber_id, arbeitgeber_id, jobber_name, job_id, jobs!inner(titel, datum, tagesgehalt)")
      .eq("anwesenheit_bestaetigt", true)
      .eq("zahlung_status", "ausstehend")
      .is("ag_reminder_gesendet_am", null)
      .eq("jobs.datum", agReminderDatum);
    if (aErr) result.fehler.push("ag-query: " + aErr.message);

    for (const b of agFaellig || []) {
      const jobTitel = (b as any).jobs?.titel || "Tagesjob";
      const betrag   = Number((b as any).jobs?.tagesgehalt || 0);
      await sendEmail(admin, {
        type: "payment_reminder_ag",
        recipientId: b.arbeitgeber_id,
        jobTitel,
        jobberName: b.jobber_name || "der Jobber",
        betrag,
      });
      await admin.from("notifications").insert({
        user_id: b.arbeitgeber_id,
        type: "zahlung_erinnerung",
        message: `Erinnerung: Zahlung für "${jobTitel}" (${b.jobber_name || "Jobber"}) steht noch aus.`,
        link: "meine-inserate.html",
        read: false,
      });
      await admin.from("bewerbungen").update({ ag_reminder_gesendet_am: new Date().toISOString() }).eq("id", b.id);
      result.ag_reminder++;
    }

    // ── 3) Überfällig-Flag: 10+ Tage nach Einsatz, Zahlung noch ausstehend ──
    const { data: ueberfaellig, error: uErr } = await admin
      .from("bewerbungen")
      .select("id, jobs!inner(datum)")
      .eq("anwesenheit_bestaetigt", true)
      .eq("zahlung_status", "ausstehend")
      .eq("zahlung_ueberfaellig", false)
      .lte("jobs.datum", ueberfaelligDatum);
    if (uErr) result.fehler.push("ueberfaellig-query: " + uErr.message);

    if (ueberfaellig?.length) {
      const ids = ueberfaellig.map((b: any) => b.id);
      await admin.from("bewerbungen").update({ zahlung_ueberfaellig: true }).in("id", ids);
      result.ueberfaellig = ids.length;
    }

    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("payment-reminders error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: cors });
  }
});
