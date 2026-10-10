// Legt für einen Job eine konsolidierte Rechnung an (eine Position pro
// abgerechneter Bewerbung, siehe rechnung_erstellen_fuer_job() in der
// Migration). Normalerweise löst das die geplante Funktion
// "anwesenheit-abwicklung" automatisch aus, sobald der letzte Arbeitstag
// vorbei und für alle Bewerbungen entschieden ist. Diese Funktion dient als
// manueller Weg für den Admin, falls eine Rechnung automatisch blockiert
// wurde (jobs.rechnung_blockiert, siehe Block B2) und nach Prüfung doch
// erstellt werden soll - läuft als der aufrufende Nutzer (nicht
// service_role), damit auth.uid()/RLS innerhalb der Datenbankfunktion
// korrekt greifen.
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

function isRealIban(v: string | null): boolean {
  return !!v && /^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(v.replace(/\s+/g, "").toUpperCase());
}
function isRealUid(v: string | null): boolean {
  return !!v && /^ATU\d{8}$/i.test(v.replace(/\s+/g, ""));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return json({ error: "Nicht angemeldet." }, 401);

    const body = await req.json().catch(() => ({}));
    const jobId = body?.jobId;
    if (!jobId) return json({ error: "jobId fehlt." }, 400);

    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: invoice, error: rpcErr } = await callerClient
      .rpc("rechnung_erstellen_fuer_job", { p_job_id: jobId })
      .single();

    if (rpcErr || !invoice) {
      console.error("rechnung_erstellen_fuer_job RPC error:", rpcErr?.message);
      return json({ error: rpcErr?.message || "Rechnung konnte nicht angelegt werden." }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    // Blockade aufheben, falls dies der manuelle Weg nach B2-Stopp war.
    await admin.from("jobs").update({ rechnung_blockiert: false }).eq("id", jobId);

    const { data: settings } = await admin
      .from("einstellungen")
      .select("schluessel, wert_text")
      .in("schluessel", ["odoj_iban", "odoj_uid_nummer"]);
    const iban = settings?.find((s: any) => s.schluessel === "odoj_iban")?.wert_text || null;
    const uid = settings?.find((s: any) => s.schluessel === "odoj_uid_nummer")?.wert_text || null;
    const versandBereit = isRealIban(iban) && isRealUid(uid);

    return json({
      invoiceId: (invoice as any).id,
      invoiceNumber: (invoice as any).invoice_number,
      versandBereit,
    }, 200);
  } catch (error) {
    console.error("rechnung-erstellen error:", error?.message || String(error));
    return json({ error: "Interner Fehler." }, 500);
  }
});
