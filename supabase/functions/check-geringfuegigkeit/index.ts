import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY       = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_URL             = Deno.env.get("SITE_URL") || "https://odoj.at";
const FROM                 = Deno.env.get("FROM_EMAIL") || "onboarding@resend.dev";
const DEFAULT_GRENZE       = 551.10;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function esc(s: string): string {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtEuro(n: number): string {
  return n.toLocaleString("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function warnungTemplate(vorname: string, betrag: number, grenze: number): string {
  const greeting = vorname ? `Hallo ${esc(vorname)},` : "Hallo,";
  return `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:40px 16px">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 6px 30px rgba(0,0,0,.10)">
  <tr><td style="background:#0f1f3d;padding:22px 32px;text-align:center">
    <span style="font-size:28px;font-weight:800;color:#ffffff;letter-spacing:-0.5px">O<span style="color:#E8A020">D</span>O<span style="color:#E8A020">J</span></span>
  </td></tr>
  <tr><td style="padding:36px 32px 28px">
    <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#E8A020;text-transform:uppercase;letter-spacing:.8px">Wichtiger Hinweis</p>
    <h2 style="margin:0 0 20px;font-size:22px;font-weight:800;color:#0f1f3d;line-height:1.3">${greeting}</h2>
    <p style="margin:0 0 16px;font-size:15px;color:#444;line-height:1.7">
      du hast diesen Monat über ODOJ bereits <strong style="color:#0f1f3d">€ ${fmtEuro(betrag)}</strong> verdient und damit die Geringfügigkeitsgrenze von <strong style="color:#0f1f3d">€ ${fmtEuro(grenze)}</strong> überschritten.
    </p>
    <p style="margin:0 0 16px;font-size:15px;color:#444;line-height:1.7">
      Falls du ausschließlich über ODOJ Einkünfte hast, kann dadurch Sozialversicherungspflicht entstehen. Falls du zusätzlich noch andere (geringfügige) Beschäftigungen hast, kann die Grenze bereits durch die Summe all deiner Einkünfte überschritten worden sein – auch wenn dein ODOJ-Einkommen allein niedriger ist.
    </p>
    <div style="background:#fffbf0;border:1.5px solid #f5be5a;border-radius:10px;padding:16px 20px;margin:0 0 24px;font-size:14px;color:#7a5500;line-height:1.6">
      Was das für dich bedeutet: Es kann bei der Jahresabrechnung zu einer Nachzahlung von Sozialversicherungsbeiträgen kommen. Diese Übersicht bezieht sich ausschließlich auf deine Einsätze über ODOJ – bitte berücksichtige zusätzlich alle anderen Einkommensquellen, die du hast.
    </div>
    <p style="margin:0 0 24px;font-size:15px;color:#444;line-height:1.7">
      Bei Fragen wende dich am besten an die ÖGK oder einen Steuerberater.
    </p>
    <table cellpadding="0" cellspacing="0"><tr><td style="background:#0f1f3d;border-radius:8px">
      <a href="${SITE_URL}/profil.html" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none">
        Meine Einkommensübersicht ansehen &rarr;
      </a>
    </td></tr></table>
    <p style="margin:24px 0 0;font-size:13px;color:#aaa">Dein ODOJ-Team</p>
  </td></tr>
  <tr><td style="background:#f8f9fb;border-top:1px solid #eaeaea;padding:20px 32px;text-align:center">
    <p style="margin:0;font-size:12px;color:#999;line-height:1.6">
      Diese E-Mail wurde automatisch von ODOJ gesendet.<br>
      <a href="${SITE_URL}" style="color:#E8A020;text-decoration:none;font-weight:600">odoj.at</a>
    </p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const body = await req.json();
    const record = body.record;
    if (!record?.jobber_id || !record?.job_id) {
      return new Response(JSON.stringify({ ok: true, skipped: "kein jobber_id/job_id" }), { headers: cors });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

    // Datum des betroffenen Jobs laden -> bestimmt den relevanten Kalendermonat
    const { data: job } = await admin.from("jobs").select("datum").eq("id", record.job_id).single();
    if (!job?.datum) return new Response(JSON.stringify({ ok: true, skipped: "kein Job-Datum" }), { headers: cors });

    const jobDate = new Date(job.datum + "T00:00:00Z");
    const jahr  = jobDate.getUTCFullYear();
    const monat = jobDate.getUTCMonth() + 1; // 1-12
    const monatStart = `${jahr}-${String(monat).padStart(2, "0")}-01`;
    const monatEndeTag = new Date(Date.UTC(jahr, monat, 0)).getUTCDate();
    const monatEnde = `${jahr}-${String(monat).padStart(2, "0")}-${String(monatEndeTag).padStart(2, "0")}`;

    // Alle bestätigten Einsätze des Jobbers in diesem Kalendermonat summieren
    const { data: bews } = await admin
      .from("bewerbungen")
      .select("jobs!inner(tagesgehalt, datum)")
      .eq("jobber_id", record.jobber_id)
      .eq("anwesenheit_bestaetigt", true)
      .gte("jobs.datum", monatStart)
      .lte("jobs.datum", monatEnde);

    const summe = (bews || []).reduce((s: number, b: any) => s + Number(b.jobs?.tagesgehalt || 0), 0);

    // Konfigurierte Grenze für das jeweilige Jahr laden (mit Fallback)
    const { data: setting } = await admin
      .from("einstellungen")
      .select("wert")
      .eq("schluessel", `geringfuegigkeitsgrenze_${jahr}`)
      .maybeSingle();
    const grenze = Number(setting?.wert || DEFAULT_GRENZE);

    if (summe <= grenze) {
      return new Response(JSON.stringify({ ok: true, summe, grenze, ueberschritten: false }), { headers: cors });
    }

    // Bereits diesen Monat benachrichtigt? -> keine erneute E-Mail
    const { data: existing } = await admin
      .from("geringfuegigkeit_meldungen")
      .select("jobber_id")
      .eq("jobber_id", record.jobber_id)
      .eq("jahr", jahr)
      .eq("monat", monat)
      .maybeSingle();

    if (existing) {
      return new Response(JSON.stringify({ ok: true, summe, grenze, bereits_gemeldet: true }), { headers: cors });
    }

    // Meldung eintragen (verhindert Duplikate bei künftigen Bestätigungen diesen Monat)
    await admin.from("geringfuegigkeit_meldungen").insert({
      jobber_id: record.jobber_id,
      jahr, monat,
      betrag: summe,
      grenze,
    });

    // Jobber-Daten für die E-Mail laden
    const { data: { user } } = await admin.auth.admin.getUserById(record.jobber_id);
    if (!user?.email) return new Response(JSON.stringify({ ok: true, summe, grenze, warn: "kein E-Mail-Empfaenger" }), { headers: cors });

    const { data: profile } = await admin.from("Profile").select("vorname").eq("user_id", record.jobber_id).single();

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: user.email,
        subject: "Wichtiger Hinweis zu deinem Einkommen über ODOJ",
        html: warnungTemplate(profile?.vorname || "", summe, grenze),
      }),
    });
    const resBody = await res.json();
    if (!res.ok) throw new Error(resBody?.message || "Resend-Fehler");

    return new Response(JSON.stringify({ ok: true, summe, grenze, email_gesendet: true }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("check-geringfuegigkeit error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: cors });
  }
});
