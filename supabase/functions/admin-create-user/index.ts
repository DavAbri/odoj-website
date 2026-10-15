import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// Muss mit der Liste in admin/index.html und admin/login.html übereinstimmen.
const ADMIN_EMAILS = ["mail4david85@gmail.com", "admin@odoj.at"]

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

function json(body: unknown, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  })
}

// Legt einen bereits per E-Mail bestätigten Nutzer direkt an (umgeht den
// Supabase-Auth-Mailversand komplett) - für Admins, wenn das eingebaute
// Rate-Limit für Bestätigungsmails erreicht ist oder ein Testkonto ohne
// Mail-Umweg gebraucht wird.
serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  }
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  try {
    const authHeader = req.headers.get("Authorization") || ""
    const token = authHeader.replace("Bearer ", "")
    if (!token) return json({ error: "Nicht angemeldet." }, 401, corsHeaders)

    const anonClient = createClient(SUPABASE_URL, ANON_KEY)
    const { data: callerData, error: callerErr } = await anonClient.auth.getUser(token)
    if (callerErr || !callerData?.user) return json({ error: "Ungültige Sitzung." }, 401, corsHeaders)

    const callerEmail = (callerData.user.email || "").toLowerCase()
    if (!ADMIN_EMAILS.includes(callerEmail)) {
      return json({ error: "Kein Zugriff auf diese Funktion." }, 403, corsHeaders)
    }

    const body = await req.json().catch(() => ({}))
    const email = (body?.email || "").trim().toLowerCase()
    const password = body?.password || ""
    const rolle = body?.rolle === "arbeitgeber" ? "arbeitgeber" : "jobber"
    if (!email || !password) return json({ error: "email und password erforderlich." }, 400, corsHeaders)

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { rolle }
    })
    if (createErr) return json({ error: createErr.message }, 400, corsHeaders)

    // handle_new_user() legt per DB-Trigger bereits eine Profile-Zeile
    // (user_id/email/rolle) an - zur Sicherheit per upsert nachziehen,
    // falls der Trigger (noch) nicht existiert.
    await adminClient.from("Profile").upsert(
      { user_id: created.user.id, email, rolle, profil_vollstaendig: false },
      { onConflict: "user_id" }
    )

    return json({ success: true, userId: created.user.id }, 200, corsHeaders)

  } catch (error) {
    return json({ error: error.message }, 500, corsHeaders)
  }
})
