import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const RESEND_API_KEY = "re_QpgBH26G_MnvP3tXvxFaL3sE79sm6bnBK"
const FROM_EMAIL = "info@odoj.at"
const FROM_NAME = "ODOJ – One Day One Job"
const SITE_URL = "https://odoj.at"

serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  }

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const record = body.record

    if (!record) {
      return new Response(JSON.stringify({ error: "No record found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      })
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    )

    // Empfänger E-Mail laden
    const { data: userData, error: userError } = await supabaseClient.auth.admin.getUserById(record.empfaenger_id)
    if (userError || !userData?.user?.email) {
      return new Response(JSON.stringify({ error: "User not found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      })
    }

    const empfaengerEmail = userData.user.email

    // Sender Name aus Profile Tabelle laden
    const { data: senderProfile } = await supabaseClient
      .from("Profile")
      .select("vorname, nachname, firmenname, rolle")
      .eq("user_id", record.sender_id)
      .single()

    let senderName = "Jemand"
    if (senderProfile) {
      if (senderProfile.rolle === "arbeitgeber") {
        senderName = senderProfile.firmenname || "Ein Arbeitgeber"
      } else {
        senderName = `${senderProfile.vorname || ""} ${senderProfile.nachname || ""}`.trim() || "Ein Jobber"
      }
    }

    // Nachricht kürzen für Preview
    const nachrichtPreview = record.nachricht
      ? record.nachricht.substring(0, 200) + (record.nachricht.length > 200 ? "..." : "")
      : ""

    // E-Mail HTML Template
    const htmlContent = `
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Neue Nachricht auf ODOJ</title>
</head>
<body style="margin:0;padding:0;background:#F4F7FB;font-family:'Arial',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F7FB;padding:40px 20px;">
  <tr>
    <td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(11,31,58,0.10);">

        <!-- HEADER -->
        <tr>
          <td style="background:#0B1F3A;padding:32px 40px;text-align:center;">
            <div style="font-size:28px;font-weight:800;color:#ffffff;letter-spacing:-1px;">
              O<span style="color:#E8A020;">D</span>OJ
            </div>
            <div style="font-size:13px;color:rgba(255,255,255,0.5);margin-top:4px;">One Day One Job</div>
          </td>
        </tr>

        <!-- BODY -->
        <tr>
          <td style="padding:40px;">
            <h1 style="font-size:22px;font-weight:700;color:#0B1F3A;margin:0 0 8px 0;">
              Du hast eine neue Nachricht! 💬
            </h1>
            <p style="font-size:15px;color:#7A8FA8;margin:0 0 28px 0;">
              <strong style="color:#0B1F3A;">${senderName}</strong> hat dir eine Nachricht geschickt.
            </p>

            <!-- Nachricht Preview Box -->
            <div style="background:#F4F7FB;border-left:4px solid #E8A020;border-radius:8px;padding:20px;margin-bottom:28px;">
              <p style="font-size:14px;color:#3A5070;margin:0;line-height:1.6;">
                ${nachrichtPreview}
              </p>
            </div>

            <!-- CTA Button -->
            <div style="text-align:center;margin-bottom:28px;">
              <a href="${SITE_URL}/chat.html"
                 style="display:inline-block;background:#E8A020;color:#0B1F3A;font-size:15px;font-weight:700;padding:14px 32px;border-radius:8px;text-decoration:none;">
                Nachricht lesen →
              </a>
            </div>

            <p style="font-size:13px;color:#7A8FA8;text-align:center;margin:0;">
              Du erhältst diese E-Mail weil du auf ODOJ registriert bist.
            </p>
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="background:#F4F7FB;padding:20px 40px;text-align:center;border-top:1px solid #E8EDF5;">
            <p style="font-size:12px;color:#8A9AB5;margin:0;">
              © 2026 ODOJ – One Day One Job |
              <a href="${SITE_URL}/datenschutz.html" style="color:#8A9AB5;">Datenschutz</a> |
              <a href="${SITE_URL}/impressum.html" style="color:#8A9AB5;">Impressum</a>
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`

    // E-Mail über Resend senden
    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: `${FROM_NAME} <${FROM_EMAIL}>`,
        to: [empfaengerEmail],
        subject: `Neue Nachricht von ${senderName} auf ODOJ`,
        html: htmlContent
      })
    })

    const resendData = await resendResponse.json()

    if (!resendResponse.ok) {
      console.error("Resend error:", resendData)
      return new Response(JSON.stringify({ error: resendData }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      })
    }

    return new Response(JSON.stringify({ success: true, data: resendData }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    })

  } catch (error) {
    console.error("Error:", error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    })
  }
})
