import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireAdmin, logAktion, corsHeaders, json } from "../_shared/support.ts";

// Startet einen Support-Zugriff auf EINEN Arbeitgeber. Pro Admin ist immer
// nur eine aktive Session gleichzeitig erlaubt (einfacheres Banner/Modell,
// verhindert vergessene parallele Zugriffe).
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireAdmin(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const { adminId, adminClient } = auth;

  try {
    const { targetUserId, grund } = await req.json().catch(() => ({}));
    if (!targetUserId) return json({ error: "targetUserId fehlt." }, 400);
    if (!grund || !String(grund).trim()) return json({ error: "Bitte einen Grund angeben." }, 400);

    // Zielkonto muss ein Arbeitgeber sein (Support-Zugriff gilt vorerst nur für AG).
    const { data: targetProfile, error: profErr } = await adminClient
      .from("Profile")
      .select("user_id, rolle, firmenname, vorname, nachname, uid_nummer")
      .eq("user_id", targetUserId)
      .maybeSingle();
    if (profErr || !targetProfile) return json({ error: "Zielkonto nicht gefunden." }, 404);
    if (targetProfile.rolle !== "arbeitgeber") {
      return json({ error: "Support-Zugriff ist aktuell nur für Arbeitgeber-Konten möglich." }, 400);
    }

    // Keine zweite gleichzeitig aktive Session desselben Admins erlauben.
    const { data: existing } = await adminClient
      .from("support_sessions")
      .select("id, target_user_id, gestartet_am")
      .eq("admin_id", adminId)
      .is("beendet_am", null);

    const stillActive = (existing || []).filter((s) => {
      const ageMin = (Date.now() - new Date(s.gestartet_am).getTime()) / 60000;
      return ageMin <= 30;
    });
    if (stillActive.length > 0) {
      return json({ error: "Es läuft bereits eine aktive Support-Session. Bitte zuerst beenden.", activeSessionId: stillActive[0].id }, 409);
    }

    const { data: newSession, error: insErr } = await adminClient
      .from("support_sessions")
      .insert({ admin_id: adminId, target_user_id: targetUserId, grund: String(grund).trim() })
      .select()
      .single();
    if (insErr || !newSession) return json({ error: insErr?.message || "Session konnte nicht gestartet werden." }, 500);

    await logAktion(adminClient, newSession.id, "session_start", "support_sessions", newSession.id, { grund });

    return json({
      sessionId: newSession.id,
      gestartetAm: newSession.gestartet_am,
      targetUserId: targetProfile.user_id,
      targetName: targetProfile.firmenname || [targetProfile.vorname, targetProfile.nachname].filter(Boolean).join(" ") || "Arbeitgeber",
    }, 200);
  } catch (error) {
    return json({ error: String(error) }, 500);
  }
});
