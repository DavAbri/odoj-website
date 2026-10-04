// Legt für einen erfolgreich abgeschlossenen Einsatz (bewerbungen-Zeile) genau
// eine Rechnung an - aufgerufen vom Arbeitgeber beim Bestätigen der Anwesenheit
// (meine-inserate.html). Die eigentliche Nummerierung + das Anlegen laufen
// atomar in der Datenbankfunktion rechnung_erstellen() (siehe Migration), die
// hier als der AUFRUFENDE Arbeitgeber (nicht als service_role) ausgeführt wird,
// damit auth.uid() und RLS korrekt greifen.
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

// Grobe, serverseitige Gültigkeitsprüfung statt auf den exakten Platzhalter-Text
// zu prüfen - erkennt auch künftige abweichende Platzhalter-Formulierungen.
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
    const bewerbungId = body?.bewerbungId;
    if (!bewerbungId) return json({ error: "bewerbungId fehlt." }, 400);

    // Als der aufrufende Arbeitgeber selbst (nicht service_role) - RLS und
    // auth.uid() innerhalb der SQL-Funktion greifen dadurch korrekt.
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: invoice, error: rpcErr } = await callerClient
      .rpc("rechnung_erstellen", { p_bewerbung_id: bewerbungId })
      .single();

    if (rpcErr || !invoice) {
      console.error("rechnung_erstellen RPC error:", rpcErr?.message);
      return json({ error: rpcErr?.message || "Rechnung konnte nicht angelegt werden." }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: settings } = await admin
      .from("einstellungen")
      .select("schluessel, wert_text")
      .in("schluessel", ["odoj_iban", "odoj_uid_nummer"]);
    const iban = settings?.find((s: any) => s.schluessel === "odoj_iban")?.wert_text || null;
    const uid = settings?.find((s: any) => s.schluessel === "odoj_uid_nummer")?.wert_text || null;
    const versandBereit = isRealIban(iban) && isRealUid(uid);

    return json({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
      versandBereit,
    }, 200);
  } catch (error) {
    console.error("rechnung-erstellen error:", error?.message || String(error));
    return json({ error: "Interner Fehler." }, 500);
  }
});
