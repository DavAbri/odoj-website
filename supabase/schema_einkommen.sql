-- Konfigurierbare Geringfügigkeitsgrenze (ändert sich jährlich).
-- Schlüssel-Format: geringfuegigkeitsgrenze_<jahr>, damit alte Jahre
-- nachvollziehbar bleiben. Neues Jahr einfach per INSERT ergänzen.
CREATE TABLE IF NOT EXISTS public.einstellungen (
  schluessel text PRIMARY KEY,
  wert numeric NOT NULL,
  beschreibung text,
  aktualisiert_am timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.einstellungen ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Einstellungen lesen" ON public.einstellungen FOR SELECT USING (true);

INSERT INTO public.einstellungen (schluessel, wert, beschreibung)
VALUES ('geringfuegigkeitsgrenze_2026', 551.10, 'Monatliche ASVG-Geringfuegigkeitsgrenze 2026 (Euro)')
ON CONFLICT (schluessel) DO NOTHING;

-- Verhindert, dass ein Jobber im selben Kalendermonat mehrfach die
-- Geringfügigkeits-Warn-E-Mail erhält (ein Eintrag pro Jobber/Monat).
-- Nur per Service-Role beschreibbar (Edge Function), daher keine
-- Client-Policies.
CREATE TABLE IF NOT EXISTS public.geringfuegigkeit_meldungen (
  jobber_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  jahr          int NOT NULL,
  monat         int NOT NULL,
  betrag        numeric NOT NULL,
  grenze        numeric NOT NULL,
  versendet_am  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (jobber_id, jahr, monat)
);
ALTER TABLE public.geringfuegigkeit_meldungen ENABLE ROW LEVEL SECURITY;
