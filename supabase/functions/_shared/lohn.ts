// Lohn: Stundensatz x Stunden (gleiche Logik wie odojLohn in auth.js).
// Neue Inserate speichern einen Stundensatz (jobs.stundensatz, optional pro
// Termin job_termine.stundensatz); der Tageslohn wird immer berechnet.
// Alte Inserate ohne Stundensatz behalten ihr bisheriges jobs.tagesgehalt.

export interface LohnJob {
  stundensatz?: number | string | null;
  tagesgehalt?: number | string | null;
  stundenanzahl?: number | string | null;
  uhrzeit_von?: string | null;
  uhrzeit_bis?: string | null;
}

export interface LohnTermin {
  stundensatz?: number | string | null;
  uhrzeit_von?: string | null;
  uhrzeit_bis?: string | null;
}

export interface Lohn {
  satz: number | null;     // null = altes Inserat mit Tagesgehalt
  stunden: number | null;
  betrag: number;
}

export function stundenAus(von?: string | null, bis?: string | null): number | null {
  if (!von || !bis) return null;
  const [h1, m1] = String(von).slice(0, 5).split(":").map(Number);
  const [h2, m2] = String(bis).slice(0, 5).split(":").map(Number);
  if ([h1, m1, h2, m2].some(Number.isNaN)) return null;
  let min = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (min <= 0) min += 24 * 60; // über Mitternacht
  return Math.round(min / 60 * 100) / 100;
}

export function berechneLohn(job: LohnJob | null | undefined, termin?: LohnTermin | null): Lohn {
  const satz = Number(termin?.stundensatz ?? job?.stundensatz) || null;
  if (satz) {
    const stunden = stundenAus(termin?.uhrzeit_von || job?.uhrzeit_von, termin?.uhrzeit_bis || job?.uhrzeit_bis);
    if (stunden) return { satz, stunden, betrag: Math.round(satz * stunden * 100) / 100 };
  }
  return { satz: null, stunden: Number(job?.stundenanzahl) || null, betrag: Number(job?.tagesgehalt) || 0 };
}

export function euro(n: number): string {
  return Number(n || 0).toLocaleString("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// "7 Std. × 15,00 € = 105,00 €" (leer bei alten Tagesgehalt-Inseraten)
export function lohnRechnung(l: Lohn): string {
  if (!l.satz || !l.stunden) return "";
  return `${String(l.stunden).replace(".", ",")} Std. × ${euro(l.satz)} € = ${euro(l.betrag)} €`;
}
