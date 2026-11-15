-- SICHERHEIT Schritt 2 (15.11.2026): Wer darf was von anderen Nutzern sehen.
-- Es werden NUR Zugriffsregeln und Abfrage-Funktionen geändert, keine Nutzerdaten.
-- Sicherung des vorherigen Stands: die Regel "profile_read_auth" steht in
-- 02_notfall_profile_lesen.sql (damit kann man zurück).
--
-- Neu:
-- 1) kontakt_namen(ids): nur Vorname, Nachname, Firmenname - und nur von
--    Personen, mit denen man über eine Bewerbung/einen Vertrag verbunden ist
--    (für Chat, Bewertungen, Stammkräfte, "Nicht erschienen").
-- 2) bewerber_profile(ids): für Arbeitgeber über SEINE Bewerber.
--    Vor der Annahme: Name, Alter, Kurzbeschreibung, Lebenslauf.
--    Nach der Annahme zusätzlich: Adresse, Telefon, Geburtsdatum,
--    Staatsangehörigkeit, SV-Nummer, IBAN (für Anmeldung und Lohn).
-- 3) Das ganze Profil (alle Felder) darf danach nur noch der Besitzer
--    selbst und ein Admin direkt lesen.

create or replace function public.kontakt_namen(p_ids uuid[])
returns table (user_id uuid, vorname text, nachname text, firmenname text)
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id, p.vorname, p.nachname, p.firmenname
  from public."Profile" p
  where p.user_id = any(p_ids)
    and coalesce(array_length(p_ids, 1), 0) <= 500
    and auth.uid() is not null
    and (
      p.user_id = auth.uid()
      or public.is_admin()
      or exists (select 1 from public.bewerbungen b
                 where (b.jobber_id = p.user_id and b.arbeitgeber_id = auth.uid())
                    or (b.arbeitgeber_id = p.user_id and b.jobber_id = auth.uid()))
      or exists (select 1 from public.vertraege v
                 where (v.jobber_id = p.user_id and v.arbeitgeber_id = auth.uid())
                    or (v.arbeitgeber_id = p.user_id and v.jobber_id = auth.uid()))
    );
$$;
revoke all on function public.kontakt_namen(uuid[]) from public;
grant execute on function public.kontakt_namen(uuid[]) to authenticated;

create or replace function public.bewerber_profile(p_ids uuid[])
returns table (
  user_id uuid, vorname text, nachname text, bio text,
  lebenslauf_pfad text, lebenslauf_dateiname text, alter integer, angenommen boolean,
  geburtsdatum date, adresse text, adresse_plz text, adresse_ort text, telefon text,
  staatsangehoerigkeit text, svnummer text, iban text
)
language sql
stable
security definer
set search_path = public
as $$
  with basis as (
    select p.*,
      (public.is_admin()
       or exists (select 1 from public.bewerbungen b
                  where b.jobber_id = p.user_id and b.arbeitgeber_id = auth.uid()
                    and (b.status in ('angenommen', 'abgeschlossen') or b.anwesenheit_bestaetigt is true or b.nicht_gekommen is true))
       or exists (select 1 from public.vertraege v
                  where v.jobber_id = p.user_id and v.arbeitgeber_id = auth.uid())) as ist_angenommen
    from public."Profile" p
    where p.user_id = any(p_ids)
      and coalesce(array_length(p_ids, 1), 0) <= 500
      and auth.uid() is not null
      and (
        public.is_admin()
        or exists (select 1 from public.bewerbungen b where b.jobber_id = p.user_id and b.arbeitgeber_id = auth.uid())
        or exists (select 1 from public.vertraege v where v.jobber_id = p.user_id and v.arbeitgeber_id = auth.uid())
      )
  )
  select user_id, vorname, nachname, bio, lebenslauf_pfad, lebenslauf_dateiname,
         case when geburtsdatum is null then null else extract(year from age(current_date, geburtsdatum))::integer end,
         ist_angenommen,
         case when ist_angenommen then geburtsdatum end,
         case when ist_angenommen then adresse end,
         case when ist_angenommen then adresse_plz::text end,
         case when ist_angenommen then adresse_ort end,
         case when ist_angenommen then telefon end,
         case when ist_angenommen then staatsangehoerigkeit end,
         case when ist_angenommen then svnummer end,
         case when ist_angenommen then iban end
  from basis;
$$;
revoke all on function public.bewerber_profile(uuid[]) from public;
grant execute on function public.bewerber_profile(uuid[]) to authenticated;

-- 3) Ganzes Profil direkt lesen: nur noch Besitzer und Admin
begin;
drop policy if exists profile_read_auth on public."Profile";
create policy profile_read_auth on public."Profile"
  for select to authenticated
  using ((select auth.uid()) = user_id or public.is_admin());
commit;
