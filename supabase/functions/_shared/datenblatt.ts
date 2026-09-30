// Geteiltes Modul: lädt alle Daten für das Datenblatt-PDF und baut das PDF selbst.
// Wird sowohl von send-email (E-Mail-Anhang bei Annahme) als auch von
// generate-datenblatt (Download-Button) verwendet - eine einzige Quelle für Layout/Inhalt.
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

const NAVY = rgb(0x0B / 255, 0x1F / 255, 0x3A / 255);
const ORANGE = rgb(0xE8 / 255, 0xA0 / 255, 0x20 / 255);
const WHITE = rgb(1, 1, 1);
const TEXT_DARK = rgb(0.15, 0.15, 0.18);
const TEXT_MUTED = rgb(0.4, 0.4, 0.45);
const HINT_BG = rgb(0.965, 0.965, 0.97);

export interface DatenblattData {
  jobber: {
    vorname: string | null;
    nachname: string | null;
    geburtsdatum: string | null;
    svnummer: string | null;
    adresse: string | null;
    adresse_plz: string | null;
    adresse_ort: string | null;
    staatsangehoerigkeit: string | null;
    iban: string | null;
    email: string | null;
    telefon: string | null;
  };
  job: {
    titel: string | null;
    ort: string | null;
    tagesgehalt: number | null;
  };
  einsatzDatum: string | null;
  einsatzVon: string | null;
  einsatzBis: string | null;
  firmenname: string | null;
}

export async function fetchDatenblattData(
  admin: any,
  bewId: string
): Promise<{ data: DatenblattData; arbeitgeberId: string | null; jobberId: string | null } | null> {
  const { data: bew } = await admin
    .from("bewerbungen")
    .select("id, job_id, jobber_id, arbeitgeber_id, termin_id, status")
    .eq("id", bewId)
    .single();
  if (!bew) return null;

  const { data: job } = await admin
    .from("jobs")
    .select("titel, ort, tagesgehalt, datum, uhrzeit_von, uhrzeit_bis, arbeitgeber_id")
    .eq("id", bew.job_id)
    .single();

  let einsatzDatum = job?.datum || null;
  let einsatzVon = job?.uhrzeit_von || null;
  let einsatzBis = job?.uhrzeit_bis || null;
  if (bew.termin_id) {
    const { data: termin } = await admin
      .from("job_termine")
      .select("datum, uhrzeit_von, uhrzeit_bis")
      .eq("id", bew.termin_id)
      .single();
    if (termin) {
      einsatzDatum = termin.datum || einsatzDatum;
      einsatzVon = termin.uhrzeit_von || einsatzVon;
      einsatzBis = termin.uhrzeit_bis || einsatzBis;
    }
  }

  const arbeitgeberId = job?.arbeitgeber_id || bew.arbeitgeber_id || null;

  const { data: jobberProfile } = await admin
    .from("Profile")
    .select("vorname, nachname, geburtsdatum, svnummer, adresse, adresse_plz, adresse_ort, staatsangehoerigkeit, iban, email, telefon")
    .eq("user_id", bew.jobber_id)
    .single();

  let firmenname: string | null = null;
  if (arbeitgeberId) {
    const { data: agProfile } = await admin
      .from("Profile")
      .select("firmenname")
      .eq("user_id", arbeitgeberId)
      .single();
    firmenname = agProfile?.firmenname || null;
  }

  return {
    arbeitgeberId,
    jobberId: bew.jobber_id,
    data: {
      jobber: {
        vorname: jobberProfile?.vorname || null,
        nachname: jobberProfile?.nachname || null,
        geburtsdatum: jobberProfile?.geburtsdatum || null,
        svnummer: jobberProfile?.svnummer || null,
        adresse: jobberProfile?.adresse || null,
        adresse_plz: jobberProfile?.adresse_plz || null,
        adresse_ort: jobberProfile?.adresse_ort || null,
        staatsangehoerigkeit: jobberProfile?.staatsangehoerigkeit || null,
        iban: jobberProfile?.iban || null,
        email: jobberProfile?.email || null,
        telefon: jobberProfile?.telefon || null,
      },
      job: {
        titel: job?.titel || null,
        ort: job?.ort || null,
        tagesgehalt: job?.tagesgehalt ?? null,
      },
      einsatzDatum,
      einsatzVon,
      einsatzBis,
      firmenname,
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

function fmtZeit(t: string | null): string {
  if (!t) return "";
  return t.slice(0, 5);
}

function nv(v: string | null | undefined): string {
  return v && String(v).trim() ? String(v).trim() : "nicht angegeben";
}

export async function buildDatenblattPdf(d: DatenblattData): Promise<{ bytes: Uint8Array; filename: string }> {
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
  page.drawText("Datenblatt zur Anmeldung", {
    x: width - 260, y: logoY + 2, size: 12, font: fontRegular, color: WHITE,
  });

  let y = height - headerH - 36;
  const marginX = 40;
  const lineGap = 16;

  function sectionTitle(text: string) {
    page.drawText(text, { x: marginX, y, size: 13, font: fontBold, color: NAVY });
    y -= 10;
    page.drawLine({
      start: { x: marginX, y }, end: { x: width - marginX, y },
      thickness: 1, color: ORANGE,
    });
    y -= 18;
  }

  function row(label: string, value: string) {
    page.drawText(label, { x: marginX, y, size: 10, font: fontBold, color: TEXT_MUTED });
    page.drawText(value, { x: marginX + 150, y, size: 11, font: fontRegular, color: TEXT_DARK });
    y -= lineGap;
  }

  const jobberName = `${nv(d.jobber.vorname)} ${nv(d.jobber.nachname)}`.trim();
  const adresseFull = d.jobber.adresse
    ? `${d.jobber.adresse}, ${nv(d.jobber.adresse_plz)} ${nv(d.jobber.adresse_ort)}`
    : "nicht angegeben";
  const zeitStr = d.einsatzVon && d.einsatzBis ? `${fmtZeit(d.einsatzVon)} – ${fmtZeit(d.einsatzBis)} Uhr` : "nicht angegeben";
  const lohnStr = d.job.tagesgehalt != null
    ? `€ ${Number(d.job.tagesgehalt).toLocaleString("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (Tagesgehalt laut Inserat)`
    : "nicht angegeben";

  sectionTitle("A) Daten des Arbeitnehmers");
  row("Name:", jobberName || "nicht angegeben");
  row("Geburtsdatum:", fmtDatum(d.jobber.geburtsdatum));
  row("Sozialversicherungsnr.:", nv(d.jobber.svnummer));
  row("Wohnadresse:", adresseFull);
  row("Staatsangehörigkeit:", nv(d.jobber.staatsangehoerigkeit));
  row("IBAN:", nv(d.jobber.iban));
  row("E-Mail:", nv(d.jobber.email));
  row("Telefon:", nv(d.jobber.telefon));

  y -= 10;
  sectionTitle("B) Daten des Einsatzes");
  row("Tätigkeit:", nv(d.job.titel));
  row("Datum des Einsatzes:", fmtDatum(d.einsatzDatum));
  row("Arbeitszeit:", zeitStr);
  row("Arbeitsort:", nv(d.job.ort));
  row("Vereinbarter Lohn:", lohnStr);
  row("Arbeitgeber (Firma):", nv(d.firmenname));

  y -= 14;
  const hintTexts = [
    "Die Anmeldung des Arbeitnehmers bei der ÖGK (z. B. über ELDA) muss vor Arbeitsantritt erfolgen.",
    "Der Lohn muss mindestens dem geltenden kollektivvertraglichen Mindestlohn entsprechen.",
    "ODOJ ist reiner Vermittler und nicht Arbeitgeber. Die Lohnverrechnung, Anmeldung und Abgaben liegen beim Arbeitgeber.",
    "Für erfolgreich vermittelte Einsätze fällt eine Vermittlungsgebühr von € 15 an ODOJ an.",
  ];
  const hintBoxTop = y;
  const hintBoxHeight = 16 + hintTexts.length * 14;
  page.drawRectangle({
    x: marginX, y: hintBoxTop - hintBoxHeight, width: width - marginX * 2, height: hintBoxHeight,
    color: HINT_BG,
  });
  y -= 12;
  for (const t of hintTexts) {
    page.drawText(`• ${t}`, { x: marginX + 10, y, size: 9, font: fontRegular, color: TEXT_DARK });
    y -= 14;
  }

  const bytes = await pdf.save();
  const safeName = (jobberName || "Datenblatt").replace(/[^a-zA-Z0-9À-ÿ _-]/g, "").trim() || "Datenblatt";
  return { bytes, filename: `Datenblatt-${safeName}.pdf` };
}
