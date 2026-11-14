-- NOTFALL 14.11.2026: Profile nicht mehr ohne Anmeldung lesbar.
-- Ersetzt die Lese-Regel "profile_read_business_relation", die über
-- "rolle = 'arbeitgeber'" ALLE Arbeitgeber-Profile für JEDEN (auch ohne
-- Anmeldung) lesbar gemacht hat. Keine Nutzerdaten werden verändert.
--
-- Zurück (nur im Notfall, das Leck wäre dann wieder offen): siehe 01_backup_profile_regeln_vorher.sql
begin;
drop policy if exists profile_read_business_relation on public."Profile";
drop policy if exists profile_read_auth on public."Profile";
create policy profile_read_auth on public."Profile"
  for select to authenticated
  using (
    (select auth.uid()) = user_id
    or public.is_admin()
    -- Arbeitgeber sieht seine Bewerber
    or exists (select 1 from public.bewerbungen b
               where b.jobber_id = "Profile".user_id and b.arbeitgeber_id = (select auth.uid()))
    -- Bewerber sieht den Arbeitgeber, bei dem er sich beworben hat
    or exists (select 1 from public.bewerbungen b
               where b.arbeitgeber_id = "Profile".user_id and b.jobber_id = (select auth.uid()))
    -- bestehende Verträge (beide Richtungen)
    or exists (select 1 from public.vertraege v
               where (v.jobber_id = "Profile".user_id and v.arbeitgeber_id = (select auth.uid()))
                  or (v.arbeitgeber_id = "Profile".user_id and v.jobber_id = (select auth.uid())))
  );
commit;
