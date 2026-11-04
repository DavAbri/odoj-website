-- Auf STAGING testen, dann LIVE. Freigabe "Ja" liegt vor.
-- ========================================================================
-- Die Rolle eines Kontos (Profile.rolle: arbeitgeber/jobber) darf nach dem
-- Anlegen nur noch ein Admin ändern (z.B. der Rollen-Umschalter der
-- Admin-Konten). Normale Nutzer können ihre Rolle nicht mehr selbst
-- umstellen. Registrierung, "Nutzer anlegen" im Admin-Bereich und
-- Server-Funktionen (service_role) bleiben unberührt.
-- Nur Neues: eine Funktion + ein Trigger.
-- ========================================================================
begin;

create or replace function public.profil_rolle_schuetzen()
returns trigger
language plpgsql
as $$
begin
  if new.rolle is distinct from old.rolle
     and old.rolle is not null
     and coalesce(auth.role(), '') <> 'service_role'
     and current_user not in ('postgres', 'supabase_admin')
     and not public.is_admin() then
    raise exception 'Die Rolle eines Kontos kann nur ein Admin ändern.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profil_rolle_schuetzen on public."Profile";
create trigger trg_profil_rolle_schuetzen
  before update on public."Profile"
  for each row execute function public.profil_rolle_schuetzen();

commit;
