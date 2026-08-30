-- Fix: confirmPresence() in meine-inserate.html schreibt beim Bestätigen
-- der Anwesenheit u.a. lohn_betrag, vermittlungsgebuehr, gesamt_betrag und
-- rechnungsnummer in "rechnungen" -- diese Spalten fehlten in der Tabelle,
-- wodurch der Insert seit Einführung dieser Felder durchgehend fehlschlug
-- (Fehler wurde im Code nicht abgefangen). Betroffen war dadurch auch die
-- Anzeige "Gesamt verdient" in profil.html (loadAuszahlungen), die immer
-- € 0,00 zeigte, da r.lohn_betrag nie befüllt wurde.
ALTER TABLE public.rechnungen ADD COLUMN IF NOT EXISTS lohn_betrag numeric;
ALTER TABLE public.rechnungen ADD COLUMN IF NOT EXISTS vermittlungsgebuehr numeric DEFAULT 15;
ALTER TABLE public.rechnungen ADD COLUMN IF NOT EXISTS gesamt_betrag numeric;
ALTER TABLE public.rechnungen ADD COLUMN IF NOT EXISTS rechnungsnummer text;
