// Erzeugt das Datenblatt-PDF für eine angenommene Bewerbung on-demand (Download-Button
// in meine-inserate.html). Kein Speichern, keine öffentliche URL - bei jedem Aufruf frisch
// generiert. Nur der Arbeitgeber, dem der zugehörige Job gehört, darf zugreifen.
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchDatenblattData, buildDatenblattPdf } from "../_shared/datenblatt.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return json({ error: "Nicht angemeldet." }, 401);

    // Aufrufer über sein eigenes Token verifizieren (nicht dem Client vertrauen).
    const anonClient = createClient(SUPABASE_URL, ANON_KEY);
    const { data: callerData, error: callerErr } = await anonClient.auth.getUser(token);
    if (callerErr || !callerData?.user) return json({ error: "Ungültige Sitzung." }, 401);
    const callerId = callerData.user.id;

    const body = await req.json().catch(() => ({}));
    const bewId = body?.bewId;
    if (!bewId) return json({ error: "bewId fehlt." }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const result = await fetchDatenblattData(admin, bewId);
    if (!result) return json({ error: "Bewerbung nicht gefunden." }, 404);

    // Zugriffsschutz: nur der Arbeitgeber des zugehörigen Jobs darf dieses Datenblatt sehen -
    // verhindert, dass ein Jobber (oder ein fremder Arbeitgeber) an Daten Dritter kommt.
    if (!result.arbeitgeberId || result.arbeitgeberId !== callerId) {
      return json({ error: "Kein Zugriff auf dieses Datenblatt." }, 403);
    }

    const { bytes, filename } = await buildDatenblattPdf(result.data);
    const pdfBase64 = btoa(String.fromCharCode(...bytes));

    return json({ pdfBase64, filename }, 200);
  } catch (error) {
    // Keine Klartext-Details sensibler Daten in Fehlermeldungen/Logs.
    console.error("generate-datenblatt error:", error?.message || String(error));
    return json({ error: "Interner Fehler." }, 500);
  }
});
