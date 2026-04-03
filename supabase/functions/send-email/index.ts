import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY      = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL        = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_URL            = Deno.env.get("SITE_URL") || "https://odoj.at";
// Für Tests: "onboarding@resend.dev" verwenden (kein Domain-Verify nötig)
// Für Produktion: eigene verifizierte Domain eintragen, z.B. "noreply@odoj.at"
const FROM                = Deno.env.get("FROM_EMAIL") || "onboarding@resend.dev";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── EMAIL TEMPLATES ──────────────────────────────────────────────

function baseTemplate(content: string): string {
  return `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:40px 16px">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 6px 30px rgba(0,0,0,.10)">
  <!-- HEADER -->
  <tr><td style="background:#0f1f3d;padding:22px 32px;text-align:center">
    <span style="font-size:28px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
      O<span style="color:#E8A020">D</span>OJ
    </span>
  </td></tr>
  <!-- BODY -->
  ${content}
  <!-- FOOTER -->
  <tr><td style="background:#f8f9fb;border-top:1px solid #eaeaea;padding:20px 32px;text-align:center">
    <p style="margin:0;font-size:12px;color:#999;line-height:1.6">
      Diese E-Mail wurde automatisch von ODOJ gesendet.<br>
      <a href="${SITE_URL}" style="color:#E8A020;text-decoration:none;font-weight:600">odoj.at</a>
      &nbsp;·&nbsp; One Day One Job – Tagesjobs in Vorarlberg
    </p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function newMessageTemplate(recipientName: string, senderName: string, jobTitel: string, bewId: string): string {
  const chatUrl = `${SITE_URL}/chat.html?bew=${bewId}`;
  const greeting = recipientName ? `Hallo ${recipientName},` : "Hallo,";
  return baseTemplate(`
  <tr><td style="padding:36px 32px 28px">
    <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#E8A020;text-transform:uppercase;letter-spacing:.8px">Neue Nachricht</p>
    <h2 style="margin:0 0 20px;font-size:22px;font-weight:800;color:#0f1f3d;line-height:1.3">${greeting}</h2>
    <p style="margin:0 0 20px;font-size:15px;color:#444;line-height:1.7">
      Du hast eine neue Nachricht von <strong style="color:#0f1f3d">${esc(senderName)}</strong>
      zum Job <strong style="color:#0f1f3d">${esc(jobTitel)}</strong> erhalten.
    </p>
    <table cellpadding="0" cellspacing="0"><tr><td style="background:#0f1f3d;border-radius:8px">
      <a href="${chatUrl}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
        💬 Nachricht ansehen &rarr;
      </a>
    </td></tr></table>
    <p style="margin:24px 0 0;font-size:13px;color:#aaa">Du erhältst diese E-Mail, weil du auf ODOJ registriert bist.</p>
  </td></tr>`);
}

function workConfirmedTemplate(recipientName: string, firmenname: string, jobTitel: string, bewId: string): string {
  const bewertungBase = `${SITE_URL}/bewertung.html?bew=${bewId}&sterne=`;
  const greeting = recipientName ? `Hallo ${recipientName},` : "Hallo,";

  const stars = [1, 2, 3, 4, 5].map(n => {
    const filled  = "⭐".repeat(n);
    const label   = ["Schlecht", "Nicht so gut", "Ok", "Gut", "Sehr gut"][n - 1];
    return `<td style="padding:4px 6px;text-align:center">
      <a href="${bewertungBase}${n}" style="display:block;font-size:22px;line-height:1;text-decoration:none" title="${label}">${filled}</a>
      <span style="font-size:10px;color:#999;display:block;margin-top:4px">${label}</span>
    </td>`;
  }).join("");

  return baseTemplate(`
  <tr><td style="padding:36px 32px 28px">
    <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#1a7a50;text-transform:uppercase;letter-spacing:.8px">Einsatz abgeschlossen</p>
    <h2 style="margin:0 0 20px;font-size:22px;font-weight:800;color:#0f1f3d;line-height:1.3">${greeting}</h2>
    <p style="margin:0 0 8px;font-size:15px;color:#444;line-height:1.7">
      Dein Einsatz bei <strong style="color:#0f1f3d">${esc(firmenname)}</strong>
      als <strong style="color:#0f1f3d">${esc(jobTitel)}</strong> wurde offiziell bestätigt. Großartige Arbeit!
    </p>
    <div style="background:#e6f5ee;border:1.5px solid #a8d9be;border-radius:10px;padding:16px 20px;margin:20px 0;font-size:14px;color:#1a5c3a;line-height:1.6">
      ✅ Deine Anwesenheit & Bezahlung wurde bestätigt.
    </div>

    <!-- BEWERTUNG -->
    <div style="background:#fffbf0;border:1.5px solid #f5be5a;border-radius:10px;padding:22px 24px;margin-top:8px">
      <p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#0f1f3d">Wie war deine Erfahrung mit ODOJ?</p>
      <p style="margin:0 0 18px;font-size:13px;color:#888;line-height:1.6">Wir würden uns sehr über dein Feedback freuen – es hilft uns, unseren Service zu verbessern.</p>
      <table cellpadding="0" cellspacing="0" style="margin:0 auto 16px">
        <tr>${stars}</tr>
      </table>
      <p style="margin:0;text-align:center">
        <a href="${SITE_URL}/bewertung.html?bew=${bewId}" style="font-size:12px;color:#E8A020;text-decoration:none;font-weight:600">
          Oder direkt zur Bewertungsseite &rarr;
        </a>
      </p>
    </div>

    <p style="margin:24px 0 0;font-size:13px;color:#aaa">Wir freuen uns, dich bald wieder bei einem Einsatz dabei zu haben!</p>
  </td></tr>`);
}

function esc(s: string): string {
  return (s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

// ── MAIN ─────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { type, recipientId, senderName, jobTitel, bewId, firmenname } = await req.json();

    if (!recipientId) return new Response(JSON.stringify({ error: "recipientId fehlt" }), { status: 400, headers: cors });

    // Empfänger-E-Mail über Admin-API holen (sicher serverseitig)
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: { user }, error: userErr } = await admin.auth.admin.getUserById(recipientId);
    if (userErr || !user?.email) return new Response(JSON.stringify({ error: "Benutzer nicht gefunden" }), { status: 404, headers: cors });

    // Empfänger-Name aus Profile holen
    const { data: profile } = await admin.from("Profile").select("vorname, nachname").eq("user_id", recipientId).single();
    const recipientName = profile ? `${profile.vorname || ""} ${profile.nachname || ""}`.trim() : "";

    let subject = "";
    let html = "";

    if (type === "new_message") {
      subject = `💬 Neue Nachricht von ${senderName} – ODOJ`;
      html = newMessageTemplate(recipientName, senderName || "", jobTitel || "", bewId || "");
    } else if (type === "work_confirmed") {
      subject = `✅ Einsatz abgeschlossen – Wie war deine Erfahrung?`;
      html = workConfirmedTemplate(recipientName, firmenname || "", jobTitel || "", bewId || "");
    } else {
      return new Response(JSON.stringify({ error: "Unbekannter type" }), { status: 400, headers: cors });
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: user.email, subject, html }),
    });

    const resBody = await res.json();
    if (!res.ok) throw new Error(resBody?.message || "Resend-Fehler");

    return new Response(JSON.stringify({ ok: true, id: resBody.id }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("send-email error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: cors });
  }
});
