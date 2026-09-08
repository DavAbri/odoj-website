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

    const { data: targetUserRes } = await adminClient.auth.admin.getUserById(targetUserId)
    const targetEmail = (targetUserRes?.user?.email || "").toLowerCase()
    if (!targetUserRes?.user) return json({ error: "Nutzer nicht gefunden." }, 404, corsHeaders)
    if (ADMIN_EMAILS.includes(targetEmail)) {
      return json({ error: "Admin-Konten können hierüber nicht gelöscht werden." }, 400, corsHeaders)
    }

    // Nutzer mit bestehender Aktivität (Jobs, Bewerbungen, Rechnungen, Verträge,
    // Nachrichten, Bewertungen) werden NICHT endgültig gelöscht, damit
    // Geschäftsunterlagen (z.B. Rechnungen) nicht plötzlich verwaisen oder
    // verschwinden. In diesem Fall bitte stattdessen sperren.
    const or = `jobber_id.eq.${targetUserId},arbeitgeber_id.eq.${targetUserId}`
    const [jobs, bew, rech, vert, nach, bewert] = await Promise.all([
      adminClient.from("jobs").select("id", { count: "exact", head: true }).eq("arbeitgeber_id", targetUserId),
      adminClient.from("bewerbungen").select("id", { count: "exact", head: true }).or(or),
      adminClient.from("rechnungen").select("id", { count: "exact", head: true }).or(or),
      adminClient.from("vertraege").select("id", { count: "exact", head: true }).or(or),
      adminClient.from("nachrichten").select("id", { count: "exact", head: true }).or(`sender_id.eq.${targetUserId},empfaenger_id.eq.${targetUserId}`),
      adminClient.from("bewertungen").select("id", { count: "exact", head: true }).or(`bewerter_id.eq.${targetUserId},bewertet_id.eq.${targetUserId}`),
    ])
    const totalActivity = [jobs, bew, rech, vert, nach, bewert].reduce((sum, r) => sum + (r.count || 0), 0)
    if (totalActivity > 0) {
      return json({
        error: "Dieser Nutzer hat bereits Aktivität auf der Plattform (Jobs, Bewerbungen, Rechnungen, Verträge, Nachrichten oder Bewertungen) und kann deshalb nicht endgültig gelöscht werden - das würde eure Geschäftsunterlagen beschädigen. Bitte stattdessen sperren."
      }, 400, corsHeaders)
    }

    await adminClient.from("Profile").delete().eq("user_id", targetUserId)
    const { error: delErr } = await adminClient.auth.admin.deleteUser(targetUserId)
    if (delErr) return json({ error: delErr.message }, 500, corsHeaders)

    return json({ success: true }, 200, corsHeaders)

  } catch (error) {
    return json({ error: error.message }, 500, corsHeaders)
  }
})
