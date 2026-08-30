-- Manuelle Zahlungsabwicklung (kein Stripe): Jobber-IBAN + Zahlungsstatus
-- pro Einsatz, damit Arbeitgeber und Jobber den Überweisungsprozess
-- nachvollziehen können. Die tatsächliche Überweisung passiert immer
-- außerhalb der Plattform (Banking des Arbeitgebers).

ALTER TABLE public."Profile" ADD COLUMN IF NOT EXISTS iban text;

ALTER TABLE public.bewerbungen ADD COLUMN IF NOT EXISTS zahlung_status text DEFAULT 'ausstehend';
-- Werte: 'ausstehend' | 'bestaetigt'
ALTER TABLE public.bewerbungen ADD COLUMN IF NOT EXISTS zahlung_bestaetigt_am timestamptz;
ALTER TABLE public.bewerbungen ADD COLUMN IF NOT EXISTS jobber_reminder_gesendet_am timestamptz;
ALTER TABLE public.bewerbungen ADD COLUMN IF NOT EXISTS ag_reminder_gesendet_am timestamptz;
ALTER TABLE public.bewerbungen ADD COLUMN IF NOT EXISTS zahlung_ueberfaellig boolean DEFAULT false;

-- "einstellungen" (siehe schema_einkommen.sql) generalisiert: neben
-- numerischen Werten (Geringfügigkeitsgrenze) jetzt auch Text-Werte
-- (IBAN, Kontoinhaber) möglich.
ALTER TABLE public.einstellungen ALTER COLUMN wert DROP NOT NULL;
ALTER TABLE public.einstellungen ADD COLUMN IF NOT EXISTS wert_text text;

-- WICHTIG: Platzhalter -- vor Live-Betrieb durch echte ODOJ-Bankdaten ersetzen!
INSERT INTO public.einstellungen (schluessel, wert_text, beschreibung)
VALUES ('odoj_iban', 'ATXX XXXX XXXX XXXX XXXX -- BITTE ECHTE IBAN EINTRAGEN', 'IBAN fuer den Einzug der Vermittlungsgebuehr - MUSS vor Live-Betrieb ersetzt werden')
ON CONFLICT (schluessel) DO NOTHING;

INSERT INTO public.einstellungen (schluessel, wert_text, beschreibung)
VALUES ('odoj_kontoinhaber', 'ODOJ -- One Day One Job', 'Kontoinhaber fuer die Vermittlungsgebuehr-Ueberweisung')
ON CONFLICT (schluessel) DO NOTHING;

-- pg_cron für tägliche Zahlungs-Reminder (siehe check-geringfuegigkeit
-- als Vorbild für Trigger-basierte Funktionen; hier zeitgesteuert statt
-- ereignisgesteuert, da die Fristen 3/5/10 Tage nach Einsatzdatum sind).
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
