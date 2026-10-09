import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireAdmin, corsHeaders, json, logAktion } from "../_shared/support.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireAdmin(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const { adminId, adminClient } = auth;

  try {
    const { sessionId } = await req.json().catch(() => ({}));
    if (!sessionId) return json({ error: "sessionId fehlt." }, 400);

    const { data: session, error } = await adminClient
      .from("support_sessions")
      .select("id, admin_id, beendet_am")
      .eq("id", sessionId)
      .maybeSingle();
    if (error || !session) return json({ error: "Support-Session nicht gefunden." }, 404);
    if (session.admin_id !== adminId) return json({ error: "Diese Support-Session gehört nicht dir." }, 403);

    if (!session.beendet_am) {
      const { error: updErr } = await adminClient
        .from("support_sessions")
        .update({ beendet_am: new Date().toISOString() })
        .eq("id", sessionId);
      if (updErr) return json({ error: updErr.message }, 500);
      await logAktion(adminClient, sessionId, "session_end", "support_sessions", sessionId, null);
    }

    return json({ success: true }, 200);
  } catch (error) {
    return json({ error: String(error) }, 500);
  }
});
