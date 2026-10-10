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

// ODOJ-Stammdaten (Rechnungssteller) - Name/Adresse fix (ändern sich faktisch
// nie), Firmenbuchnummer/-gericht und ein optionaler USt-Hinweistext kommen
// dagegen aus "einstellungen" (Block B4 - zentral korrigierbar ohne Code-
// Änderung, z.B. falls das Firmenbuchgericht noch bestätigt werden muss).
const ODOJ_FIRMENNAME = "ODOJ OG";
const ODOJ_ADRESSE = "Rheinfähre 22, 6845 Hohenems";

export interface RechnungPosition {
  beschreibung: string;
  einsatzdatum: string | null;
  betrag: number;
}

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
  };
  positionen: RechnungPosition[];
  odojUidNummer: string | null;
  odojIban: string | null;
  odojKontoinhaber: string | null;
  odojFirmenbuchnummer: string | null;
  odojFirmenbuchgericht: string | null;
  odojUstHinweis: string | null;
}

export async function fetchRechnungData(admin: any, invoiceId: string): Promise<{ data: RechnungData; arbeitgeberId: string } | null> {
  const { data: invoice } = await admin
    .from("invoices")
    .select("id, invoice_number, job_id, arbeitgeber_id, amount, issued_at, due_at")
    .eq("id", invoiceId)
    .single();
  if (!invoice) return null;

  const [{ data: job }, { data: items }] = await Promise.all([
    admin.from("jobs").select("titel").eq("id", invoice.job_id).maybeSingle(),
    admin.from("invoice_items").select("beschreibung, einsatzdatum, betrag").eq("invoice_id", invoice.id).order("einsatzdatum"),
  ]);

  const positionen: RechnungPosition[] = (items || []).map((it: any) => ({
    beschreibung: it.beschreibung,
    einsatzdatum: it.einsatzdatum,
    betrag: Number(it.betrag),
  }));

  const { data: agProfile } = await admin
    .from("Profile")
    .select("firmenname, adresse, adresse_plz, adresse_ort")
    .eq("user_id", invoice.arbeitgeber_id)
    .single();

  const { data: settings } = await admin
    .from("einstellungen")
    .select("schluessel, wert_text")
    .in("schluessel", ["odoj_iban", "odoj_kontoinhaber", "odoj_uid_nummer", "odoj_firmenbuchnummer", "odoj_firmenbuchgericht", "odoj_ust_hinweis"]);
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
      job: { titel: job?.titel || null },
      positionen,
      odojUidNummer: settingsMap["odoj_uid_nummer"] || null,
      odojIban: settingsMap["odoj_iban"] || null,
      odojKontoinhaber: settingsMap["odoj_kontoinhaber"] || null,
      odojFirmenbuchnummer: settingsMap["odoj_firmenbuchnummer"] || null,
      odojFirmenbuchgericht: settingsMap["odoj_firmenbuchgericht"] || null,
      odojUstHinweis: settingsMap["odoj_ust_hinweis"] || null,
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

  // B4: jede Nicht-"ODOJ-"-Rechnungsnummer (z.B. Staging-Praefix "TEST-")
  // bekommt einen deutlich sichtbaren, roten Hinweis - verhindert, dass eine
  // Testrechnung je mit einer echten verwechselt werden kann.
  if (!d.invoiceNumber.startsWith("ODOJ-")) {
    const warnH = 26;
    page.drawRectangle({ x: 0, y: y - warnH + lineGap, width, height: warnH, color: rgb(0.75, 0.11, 0.17) });
    page.drawText("TESTRECHNUNG – UNGÜLTIG", { x: marginX, y: y - warnH + lineGap + 8, size: 12, font: fontBold, color: WHITE });
    y -= warnH + 10;
  }

  // Rechnungssteller / Rechnungsempfänger nebeneinander
  page.drawText("Rechnungssteller", { x: marginX, y, size: 10, font: fontBold, color: TEXT_MUTED });
  page.drawText("Rechnungsempfänger", { x: marginX + 300, y, size: 10, font: fontBold, color: TEXT_MUTED });
  y -= 16;

  const agAdresse = d.arbeitgeber.adresse
    ? `${d.arbeitgeber.adresse}, ${nv(d.arbeitgeber.adresse_plz)} ${nv(d.arbeitgeber.adresse_ort)}`
    : "nicht angegeben";
  // Kleinunternehmerregelung: UID-Nummer ist optional und erscheint nur,
  // wenn sie als Einstellung gepflegt ist - kein Platzhaltertext (B4).
  // Firmenbuchnummer/-gericht kommen jetzt ebenfalls aus den Einstellungen;
  // ein Fallback-Platzhalter macht eine fehlende Pflege sofort sichtbar,
  // statt sie stillschweigend wegzulassen (anders als bei der UID, die laut
  // Prompt tatsächlich optional ist).
  const stellerLines = [
    ODOJ_FIRMENNAME,
    ODOJ_ADRESSE,
    nv(d.odojFirmenbuchnummer),
    d.odojFirmenbuchgericht ? `Firmenbuchgericht: ${d.odojFirmenbuchgericht}` : "Firmenbuchgericht: nicht angegeben",
  ];
  if (d.odojUidNummer && d.odojUidNummer.trim()) stellerLines.push(`UID-Nummer: ${d.odojUidNummer.trim()}`);
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
  sectionTitle("Leistungspositionen");
  row("Tätigkeit:", nv(d.job.titel));
  y -= 6;

  const colDatum = marginX;
  const colBeschr = marginX + 90;
  const colBetrag = width - marginX - 70;
  page.drawText("Datum", { x: colDatum, y, size: 9, font: fontBold, color: TEXT_MUTED });
  page.drawText("Leistung", { x: colBeschr, y, size: 9, font: fontBold, color: TEXT_MUTED });
  page.drawText("Betrag", { x: colBetrag, y, size: 9, font: fontBold, color: TEXT_MUTED });
  y -= 8;
  page.drawLine({ start: { x: marginX, y }, end: { x: width - marginX, y }, thickness: 0.5, color: TEXT_MUTED });
  y -= 14;

  for (const pos of d.positionen) {
    page.drawText(fmtDatum(pos.einsatzdatum), { x: colDatum, y, size: 10, font: fontRegular, color: TEXT_DARK });
    page.drawText(pos.beschreibung, { x: colBeschr, y, size: 10, font: fontRegular, color: TEXT_DARK });
    page.drawText(`€ ${pos.betrag.toLocaleString("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, { x: colBetrag, y, size: 10, font: fontRegular, color: TEXT_DARK });
    y -= 15;
  }
  y -= 4;
  page.drawLine({ start: { x: marginX, y }, end: { x: width - marginX, y }, thickness: 0.5, color: TEXT_MUTED });
  y -= 20;

  const amountFmt = d.amount.toLocaleString("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  page.drawRectangle({ x: marginX, y: y - 34, width: width - marginX * 2, height: 40, color: HINT_BG });
  page.drawText("Rechnungsbetrag gesamt", { x: marginX + 14, y: y - 12, size: 11, font: fontBold, color: TEXT_MUTED });
  page.drawText(`€ ${amountFmt}`, { x: width - marginX - 110, y: y - 14, size: 16, font: fontBold, color: NAVY });
  y -= 60;

  // Optionaler USt-Hinweistext (Standard leer = nichts angezeigt, siehe B4) -
  // nur gesetzt, falls der Steuerberater das später empfiehlt.
  if (d.odojUstHinweis && d.odojUstHinweis.trim()) {
    page.drawText(d.odojUstHinweis.trim(), { x: marginX, y, size: 9, font: fontRegular, color: TEXT_MUTED });
    y -= 20;
  }

  sectionTitle("Zahlungshinweis");
  row("IBAN:", nv(d.odojIban));
  row("Empfänger:", nv(d.odojKontoinhaber));
  row("Verwendungszweck:", d.invoiceNumber);

  const bytes = await pdf.save();
  const safeName = d.invoiceNumber.replace(/[^a-zA-Z0-9-]/g, "") || "Rechnung";
  return { bytes, filename: `Rechnung-${safeName}.pdf` };
}
