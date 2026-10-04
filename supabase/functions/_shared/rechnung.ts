// Geteiltes Modul: lädt alle Daten für das Rechnungs-PDF und baut das PDF selbst.
// Wird sowohl von send-email (E-Mail-Anhang bei Rechnungserstellung) als auch
// von rechnung-pdf (Download-Button im Arbeitgeber-Bereich) verwendet.
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

const NAVY = rgb(0x0B / 255, 0x1F / 255, 0x3A / 255);
const ORANGE = rgb(0xE8 / 255, 0xA0 / 255, 0x20 / 255);
const WHITE = rgb(1, 1, 1);
const TEXT_DARK = rgb(0.15, 0.15, 0.18);
const TEXT_MUTED = rgb(0.4, 0.4, 0.45);
const HINT_BG = rgb(0.965, 0.965, 0.97);

// ODOJ-Stammdaten (Rechnungssteller) - fix, nicht konfigurierbar, da Firmendaten.
const ODOJ_FIRMENNAME = "ODOJ OG";
const ODOJ_ADRESSE = "Rheinfähre 22, 6845 Hohenems";
const ODOJ_FN = "FN 685548i";
const ODOJ_FIRMENBUCHGERICHT = "Firmenbuchgericht Feldkirch";

export interface RechnungData {
  invoiceNumber: string;
  issuedAt: string;
  dueAt: string;
  amount: number;
  arbeitgeber: {
    firmenname: string | null;
    adresse: string | null;
    adresse_plz: string | null;
    adresse_ort: string | null;
  };
  job: {
    titel: string | null;
    datum: string | null;
  };
  odojUidNummer: string | null;
  odojIban: string | null;
  odojKontoinhaber: string | null;
}

export async function fetchRechnungData(admin: any, invoiceId: string): Promise<{ data: RechnungData; arbeitgeberId: string } | null> {
  const { data: invoice } = await admin
    .from("invoices")
    .select("id, invoice_number, bewerbung_id, arbeitgeber_id, amount, issued_at, due_at")
    .eq("id", invoiceId)
    .single();
  if (!invoice) return null;

  const { data: bew } = await admin
    .from("bewerbungen")
    .select("job_id, termin_id")
    .eq("id", invoice.bewerbung_id)
    .single();

  let jobTitel: string | null = null;
  let jobDatum: string | null = null;
  if (bew?.job_id) {
    const { data: job } = await admin.from("jobs").select("titel, datum").eq("id", bew.job_id).single();
    jobTitel = job?.titel || null;
    jobDatum = job?.datum || null;
  }
  if (bew?.termin_id) {
    const { data: termin } = await admin.from("job_termine").select("datum").eq("id", bew.termin_id).single();
    if (termin?.datum) jobDatum = termin.datum;
  }

  const { data: agProfile } = await admin
    .from("Profile")
    .select("firmenname, adresse, adresse_plz, adresse_ort")
    .eq("user_id", invoice.arbeitgeber_id)
    .single();

  const { data: settings } = await admin
    .from("einstellungen")
    .select("schluessel, wert_text")
    .in("schluessel", ["odoj_iban", "odoj_kontoinhaber", "odoj_uid_nummer"]);
  const settingsMap: Record<string, string> = {};
  (settings || []).forEach((s: any) => { settingsMap[s.schluessel] = s.wert_text; });

  return {
    arbeitgeberId: invoice.arbeitgeber_id,
    data: {
      invoiceNumber: invoice.invoice_number,
      issuedAt: invoice.issued_at,
      dueAt: invoice.due_at,
      amount: Number(invoice.amount),
      arbeitgeber: {
        firmenname: agProfile?.firmenname || null,
        adresse: agProfile?.adresse || null,
        adresse_plz: agProfile?.adresse_plz || null,
        adresse_ort: agProfile?.adresse_ort || null,
      },
      job: { titel: jobTitel, datum: jobDatum },
      odojUidNummer: settingsMap["odoj_uid_nummer"] || null,
      odojIban: settingsMap["odoj_iban"] || null,
      odojKontoinhaber: settingsMap["odoj_kontoinhaber"] || null,
    },
  };
}

function fmtDatum(iso: string | null): string {
  if (!iso) return "nicht angegeben";
  try {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return iso;
  }
}

function nv(v: string | null | undefined): string {
  return v && String(v).trim() ? String(v).trim() : "nicht angegeben";
}

export async function buildRechnungPdf(d: RechnungData): Promise<{ bytes: Uint8Array; filename: string }> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();

  const fontRegular = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const headerH = 64;
  page.drawRectangle({ x: 0, y: height - headerH, width, height: headerH, color: NAVY });

  let logoX = 40;
  const logoY = height - 40;
  const logoSize = 22;
  const letters: Array<[string, typeof WHITE]> = [
    ["O", WHITE], ["D", ORANGE], ["O", WHITE], ["J", ORANGE],
  ];
  for (const [ch, color] of letters) {
    page.drawText(ch, { x: logoX, y: logoY, size: logoSize, font: fontBold, color });
    logoX += fontBold.widthOfTextAtSize(ch, logoSize) + 1;
  }
  page.drawText("Rechnung", { x: width - 150, y: logoY + 2, size: 14, font: fontBold, color: WHITE });

  let y = height - headerH - 40;
  const marginX = 40;
  const lineGap = 16;

  // Rechnungssteller / Rechnungsempfänger nebeneinander
  page.drawText("Rechnungssteller", { x: marginX, y, size: 10, font: fontBold, color: TEXT_MUTED });
  page.drawText("Rechnungsempfänger", { x: marginX + 300, y, size: 10, font: fontBold, color: TEXT_MUTED });
  y -= 16;

  const agAdresse = d.arbeitgeber.adresse
    ? `${d.arbeitgeber.adresse}, ${nv(d.arbeitgeber.adresse_plz)} ${nv(d.arbeitgeber.adresse_ort)}`
    : "nicht angegeben";
  const stellerLines = [ODOJ_FIRMENNAME, ODOJ_ADRESSE, ODOJ_FN, ODOJ_FIRMENBUCHGERICHT, `UID-Nummer: ${nv(d.odojUidNummer)}`];
  const empfaengerLines = [nv(d.arbeitgeber.firmenname), agAdresse];

  const startY = y;
  stellerLines.forEach((line, i) => {
    page.drawText(line, { x: marginX, y: startY - i * 14, size: 10, font: fontRegular, color: TEXT_DARK });
  });
  empfaengerLines.forEach((line, i) => {
    page.drawText(line, { x: marginX + 300, y: startY - i * 14, size: 10, font: fontRegular, color: TEXT_DARK });
  });
  y = startY - Math.max(stellerLines.length, empfaengerLines.length) * 14 - 24;

  function sectionTitle(text: string) {
    page.drawText(text, { x: marginX, y, size: 13, font: fontBold, color: NAVY });
    y -= 10;
    page.drawLine({ start: { x: marginX, y }, end: { x: width - marginX, y }, thickness: 1, color: ORANGE });
    y -= 18;
  }

  function row(label: string, value: string) {
    page.drawText(label, { x: marginX, y, size: 10, font: fontBold, color: TEXT_MUTED });
    page.drawText(value, { x: marginX + 160, y, size: 11, font: fontRegular, color: TEXT_DARK });
    y -= lineGap;
  }

  sectionTitle("Rechnungsdetails");
  row("Rechnungsnummer:", d.invoiceNumber);
  row("Rechnungsdatum:", fmtDatum(d.issuedAt));
  row("Fälligkeitsdatum:", fmtDatum(d.dueAt));

  y -= 10;
  sectionTitle("Leistungsbeschreibung");
  row("Leistung:", "Vermittlung eines Einsatzes");
  row("Tätigkeit:", nv(d.job.titel));
  row("Einsatzdatum:", fmtDatum(d.job.datum));

  y -= 10;
  const amountFmt = d.amount.toLocaleString("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  page.drawRectangle({ x: marginX, y: y - 34, width: width - marginX * 2, height: 40, color: HINT_BG });
  page.drawText("Rechnungsbetrag", { x: marginX + 14, y: y - 12, size: 11, font: fontBold, color: TEXT_MUTED });
  page.drawText(`€ ${amountFmt}`, { x: width - marginX - 110, y: y - 14, size: 16, font: fontBold, color: NAVY });
  y -= 60;

  sectionTitle("Zahlungshinweis");
  row("IBAN:", nv(d.odojIban));
  row("Empfänger:", nv(d.odojKontoinhaber));
  row("Verwendungszweck:", d.invoiceNumber);

  const bytes = await pdf.save();
  const safeName = d.invoiceNumber.replace(/[^a-zA-Z0-9-]/g, "") || "Rechnung";
  return { bytes, filename: `Rechnung-${safeName}.pdf` };
}
