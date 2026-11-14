-- SICHERHEIT 14.11.2026: Kontaktdaten von Arbeitgebern wieder anzeigen - aber sicher.
-- NUR NEU: eine Abfrage-Funktion. Keine Nutzerdaten werden verändert.
--
-- Liefert für Arbeitgeber NUR die Felder, die auf der Webseite beim Inserat
-- stehen: Firmenname, Vor-/Nachname, Adresse, PLZ, Ort, Telefon, Website.
-- NIE: E-Mail, SV-Nummer, IBAN, UID-Nummer, Geburtsdatum, Rolle, Sperre usw.
--
-- Und NUR für Arbeitgeber, die mindestens ein Inserat haben, das der Abfragende
-- sehen darf (nach dem Launch: jedes Inserat; im Vorschau-Modus: nur für Admins,
-- Konten mit Vorschau-Zugriff und Personen, die sich dort beworben haben).
-- Arbeitgeber, die nur registriert sind, lassen sich so nicht herausfinden.
--
-- Zurück: drop function if exists public.arbeitgeber_oeffentlich(uuid[]);

create or replace function public.arbeitgeber_oeffentlich(p_ids uuid[])
returns table (user_id uuid, firmenname text, vorname text, nachname text,
               adresse text, plz text, ort text, telefon text, website text)
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id, p.firmenname, p.vorname, p.nachname,
         p.adresse, p.plz::text, p.ort, p.telefon, p.website
  from public."Profile" p
  where p.user_id = any(p_ids)
    and p.rolle = 'arbeitgeber'
    and coalesce(array_length(p_ids, 1), 0) <= 200
    and exists (
      select 1 from public.jobs j
      where j.arbeitgeber_id = p.user_id
        and (
          coalesce((select s.jobs_sichtbar from public.app_settings s where s.id = 1), false)
          or public.is_admin()
          or j.arbeitgeber_id = auth.uid()
          or coalesce((select q.vorschau_zugriff from public."Profile" q where q.user_id = auth.uid()), false)
          or exists (select 1 from public.bewerbungen b where b.job_id = j.id and b.jobber_id = auth.uid())
        )
    );
$$;

revoke all on function public.arbeitgeber_oeffentlich(uuid[]) from public;
grant execute on function public.arbeitgeber_oeffentlich(uuid[]) to anon, authenticated;
