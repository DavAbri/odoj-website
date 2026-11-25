-- ODOJ: Registrierungsdaten sofort im Profil speichern (25.11.2026).
-- NUR NEU: eine Funktion. Keine bestehenden Daten werden verändert.
--
-- Problem: Bei der Registrierung ist der Nutzer wegen der E-Mail-Bestätigung
-- noch nicht angemeldet - die Datenbank lehnt das Speichern von Name,
-- Geburtsdatum usw. ab. Die Daten blieben nur im Browser und gingen verloren,
-- wenn die Bestätigung auf einem anderen Gerät/Browser erfolgte.
--
-- Diese Funktion trägt die Registrierungsdaten direkt ein - aber nur:
--  * für ein Konto, das in der letzten Stunde angelegt wurde,
--  * nur in Felder, die noch leer sind (überschreibt nie etwas),
--  * nur die Registrierungsfelder (nie Rolle, Sperre, Vorschau-Zugriff usw.).
--
-- Zurück: drop function if exists public.registrierung_profil_nachtragen(uuid, jsonb);

create or replace function public.registrierung_profil_nachtragen(p_user_id uuid, p_daten jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_neu boolean;
begin
  select (u.created_at > now() - interval '1 hour') into v_neu from auth.users u where u.id = p_user_id;
  if v_neu is distinct from true then
    return false;
  end if;

  update public."Profile" p set
    vorname              = coalesce(nullif(p.vorname, ''),              nullif(btrim(p_daten->>'vorname'), '')),
    nachname             = coalesce(nullif(p.nachname, ''),             nullif(btrim(p_daten->>'nachname'), '')),
    geburtsdatum         = coalesce(p.geburtsdatum,                     nullif(p_daten->>'geburtsdatum', '')::date),
    svnummer             = coalesce(nullif(p.svnummer, ''),             nullif(btrim(p_daten->>'svnummer'), '')),
    staatsangehoerigkeit = coalesce(nullif(p.staatsangehoerigkeit, ''), nullif(btrim(p_daten->>'staatsangehoerigkeit'), '')),
    firmenname           = coalesce(nullif(p.firmenname, ''),           nullif(btrim(p_daten->>'firmenname'), '')),
    telefon              = coalesce(nullif(p.telefon, ''),              nullif(btrim(p_daten->>'telefon'), '')),
    adresse              = coalesce(nullif(p.adresse, ''),              nullif(btrim(p_daten->>'adresse'), '')),
    plz                  = coalesce(nullif(p.plz, ''),                  nullif(btrim(p_daten->>'plz'), '')),
    ort                  = coalesce(nullif(p.ort, ''),                  nullif(btrim(p_daten->>'ort'), '')),
    uid_nummer           = coalesce(nullif(p.uid_nummer, ''),           nullif(btrim(p_daten->>'uid_nummer'), '')),
    website              = coalesce(nullif(p.website, ''),              nullif(btrim(p_daten->>'website'), '')),
    ref_code             = coalesce(nullif(p.ref_code, ''),             nullif(btrim(p_daten->>'ref_code'), '')),
    datenschutz_akzeptiert_am = coalesce(p.datenschutz_akzeptiert_am,   nullif(p_daten->>'datenschutz_akzeptiert_am', '')::timestamptz)
  where p.user_id = p_user_id;

  return found;
end;
$$;

revoke all on function public.registrierung_profil_nachtragen(uuid, jsonb) from public;
grant execute on function public.registrierung_profil_nachtragen(uuid, jsonb) to anon, authenticated;
