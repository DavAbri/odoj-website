// Erzeugt das Rechnungs-PDF für eine bestehende Rechnung on-demand (Download-
// Button im Arbeitgeber-Bereich). Kein Speichern, keine öffentliche URL - bei
// jedem Aufruf frisch generiert, analog zu generate-datenblatt. Nur der
// Arbeitgeber, dem die Rechnung gehört (oder ein Admin), darf zugreifen.
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchRechnungData, buildRechnungPdf, persistRechnungPdf } from "../_shared/rechnung.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Gleiche Admin-Erkennung wie admin-delete-user - Admin-Zugang läuft über
// eine feste E-Mail-Allowlist, nicht über Profile.rolle.
const ADMIN_EMAILS = ["mail4david85@gmail.com", "admin@odoj.at"];

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

    const anonClient = createClient(SUPABASE_URL, ANON_KEY);
    const { data: callerData, error: callerErr } = await anonClient.auth.getUser(token);
    if (callerErr || !callerData?.user) return json({ error: "Ungültige Sitzung." }, 401);
    const callerId = callerData.user.id;

    const body = await req.json().catch(() => ({}));
    const invoiceId = body?.invoiceId;
    if (!invoiceId) return json({ error: "invoiceId fehlt." }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const result = await fetchRechnungData(admin, invoiceId);
    if (!result) return json({ error: "Rechnung nicht gefunden." }, 404);

    if (result.arbeitgeberId !== callerId && !ADMIN_EMAILS.includes((callerData.user.email || "").toLowerCase())) {
      return json({ error: "Kein Zugriff auf diese Rechnung." }, 403);
    }

    // B3: eine einmal ausgestellte Rechnung bleibt unveränderlich - die
    // gespeicherte Kopie wird bevorzugt statt bei jedem Download neu aus
    // den AKTUELLEN Daten erzeugt zu werden. Fehlt sie (z.B. bei einer
    // Rechnung von vor dieser Umstellung), wird sie jetzt nachträglich
    // einmalig abgelegt (selbstheilend).
    const safeName = result.data.invoiceNumber.replace(/[^a-zA-Z0-9-]/g, "") || "Rechnung";
    const filename = `Rechnung-${safeName}.pdf`;

    if (result.pdfPfad) {
      const { data: stored, error: dlErr } = await admin.storage.from("rechnungen").download(result.pdfPfad);
      if (stored && !dlErr) {
        const bytes = new Uint8Array(await stored.arrayBuffer());
        const pdfBase64 = btoa(String.fromCharCode(...bytes));
        return json({ pdfBase64, filename }, 200);
      }
      console.error("rechnung-pdf: gespeicherte Datei nicht lesbar, erzeuge neu:", dlErr?.message);
    }

    const { bytes } = await buildRechnungPdf(result.data);
    await persistRechnungPdf(admin, invoiceId).catch((e: any) => console.error("Nachträgliches Speichern fehlgeschlagen:", e?.message || e));
    const pdfBase64 = btoa(String.fromCharCode(...bytes));

    return json({ pdfBase64, filename }, 200);
  } catch (error) {
    console.error("rechnung-pdf error:", error?.message || String(error));
    return json({ error: "Interner Fehler." }, 500);
  }
});
