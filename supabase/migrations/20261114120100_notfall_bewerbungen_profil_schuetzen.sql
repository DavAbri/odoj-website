-- NOTFALL Teil 2 (14.11.2026): Gefälschte Bewerbungen und Selbst-Freischaltung verhindern.
-- NUR NEUE Prüf-Regeln (Trigger). Keine Nutzerdaten werden verändert.
--
-- Lücke A: Jeder angemeldete Nutzer konnte eine Bewerbung mit sich selbst als
--   "Arbeitgeber" und einer fremden Person als "Bewerber" anlegen - und dadurch
--   deren Profil (inkl. SV-Nr., IBAN) und Lebenslauf lesen.
-- Lücke B: Ein Bewerber konnte seine eigene Bewerbung auf "angenommen" setzen
--   oder andere Felder (Anwesenheit, Zahlung, ...) ändern.
-- Lücke C: Ein Nutzer konnte bei sich selbst "gesperrt" aufheben oder sich
--   "Vorschau-Zugriff" geben.
--
-- Ausgenommen sind immer: Plattform-Automatik (service_role), Datenbank-Admin, ODOJ-Admins.
--
-- Zurück (nur im Notfall):
--   drop trigger if exists trg_schuetze_bewerbung on public.bewerbungen;
--   drop trigger if exists trg_schuetze_profil_felder on public."Profile";

create or replace function public.schuetze_bewerbung()
returns trigger
language plpgsql
-- bewusst OHNE "security definer": die Prüfung muss mit den Rechten des
-- anfragenden Nutzers laufen, sonst gilt jeder als Datenbank-Admin.
as $$
declare
  v_uid uuid := auth.uid();
  v_ag  uuid;
  v_jobber_erlaubt text[] := array['status', 'zurueckgezogen', 'annahme_gesehen'];
begin
  if public.odoj_darf_vergangenes_aendern() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if v_uid is null or new.jobber_id is distinct from v_uid then
      raise exception 'Du kannst dich nur selbst bewerben.';
    end if;
    select arbeitgeber_id into v_ag from public.jobs where id = new.job_id;
    if v_ag is null then
      raise exception 'Inserat nicht gefunden.';
    end if;
    -- Arbeitgeber immer aus dem Inserat übernehmen, nie vom Absender
    new.arbeitgeber_id := v_ag;
    if coalesce(new.status, 'ausstehend') <> 'ausstehend' then
      raise exception 'Eine neue Bewerbung ist immer offen.';
    end if;
    new.status := 'ausstehend';
    new.anwesenheit_bestaetigt := false;
    new.nicht_gekommen := false;
    return new;
  end if;

  -- UPDATE: wer/wofür eine Bewerbung ist, ist nicht änderbar
  if new.job_id is distinct from old.job_id
     or new.jobber_id is distinct from old.jobber_id
     or new.arbeitgeber_id is distinct from old.arbeitgeber_id
     or new.termin_id is distinct from old.termin_id then
    raise exception 'Diese Angaben einer Bewerbung können nicht geändert werden.';
  end if;

  -- Bewerber selbst: nur zurückziehen und "Annahme gesehen"
  if v_uid = old.jobber_id and v_uid is distinct from old.arbeitgeber_id then
    if (to_jsonb(new) - v_jobber_erlaubt) is distinct from (to_jsonb(old) - v_jobber_erlaubt) then
      raise exception 'Diese Änderung ist für Bewerber nicht erlaubt.';
    end if;
    if new.status is distinct from old.status
       and not (new.status = 'abgelehnt' or (new.status = 'ausstehend' and old.status = 'angenommen')) then
      raise exception 'Bewerber können ihre Bewerbung nur zurückziehen.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_schuetze_bewerbung on public.bewerbungen;
create trigger trg_schuetze_bewerbung
  before insert or update on public.bewerbungen
  for each row execute function public.schuetze_bewerbung();

create or replace function public.schuetze_profil_felder()
returns trigger
language plpgsql
as $$
begin
  if public.odoj_darf_vergangenes_aendern() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if coalesce(new.gesperrt, false) or coalesce(new.vorschau_zugriff, false) then
      raise exception 'Nicht erlaubt.';
    end if;
    return new;
  end if;
  if new.gesperrt is distinct from old.gesperrt
     or new.vorschau_zugriff is distinct from old.vorschau_zugriff
     or new.user_id is distinct from old.user_id then
    raise exception 'Diese Einstellung kann nur ein Admin ändern.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_schuetze_profil_felder on public."Profile";
create trigger trg_schuetze_profil_felder
  before insert or update on public."Profile"
  for each row execute function public.schuetze_profil_felder();
