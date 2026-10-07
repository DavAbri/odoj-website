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

// Liefert ausschließlich die zwei Felder, die nirgends sonst über die normale
// Schnittstelle abrufbar sind (liegen in auth.users, nicht in Profile) - für
// die Nutzer-Detailansicht im Admin-Bereich. Keine Tokens, kein Passwort-Hash,
// keine sonstigen auth.users-Felder.
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

    // Aufrufer über sein eigenes Token verifizieren (nicht nur vertrauen, was der Client behauptet)
    const anonClient = createClient(SUPABASE_URL, ANON_KEY)
    const { data: callerData, error: callerErr } = await anonClient.auth.getUser(token)
    if (callerErr || !callerData?.user) return json({ error: "Ungültige Sitzung." }, 401, corsHeaders)

    const callerEmail = (callerData.user.email || "").toLowerCase()
    if (!ADMIN_EMAILS.includes(callerEmail)) {
      return json({ error: "Kein Zugriff auf diese Funktion." }, 403, corsHeaders)
    }

    const body = await req.json().catch(() => ({}))
    const targetUserId = body?.userId
    if (!targetUserId) return json({ error: "Keine userId angegeben." }, 400, corsHeaders)

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const { data: targetUserRes, error: targetErr } = await adminClient.auth.admin.getUserById(targetUserId)
    if (targetErr || !targetUserRes?.user) return json({ error: "Nutzer nicht gefunden." }, 404, corsHeaders)

    return json({
      email_confirmed_at: targetUserRes.user.email_confirmed_at || null,
      last_sign_in_at: targetUserRes.user.last_sign_in_at || null
    }, 200, corsHeaders)

  } catch (error) {
    return json({ error: error.message }, 500, corsHeaders)
  }
})
