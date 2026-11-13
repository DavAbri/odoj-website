-- ODOJ Punkt 4: Vergangene Inserate auch in der Datenbank gegen Änderungen sperren.
-- NUR NEUES: eine Prüf-Funktion + Sperr-Regeln (Trigger). Es wird nichts geändert
-- oder gelöscht, bestehende Daten bleiben unberührt.
--
-- "Vergangen" = das Ende des letzten Termins ist vorbei (Wiener Zeit, Termine
-- über Mitternacht enden am Folgetag).
--
-- Gesperrt für normale Konten (Arbeitgeber/Jobber), sobald ein Inserat vergangen ist:
--   * Inserat bearbeiten oder löschen
--   * Termine hinzufügen, ändern oder löschen
--   * Bewerbungen annehmen/ablehnen/stornieren/zurückziehen, Nichterscheinen melden,
--     Bewerbungen löschen
-- Weiterhin erlaubt:
--   * Bewertungen (ag_/jb_bewertung_abgegeben, Sterne/Kommentar in der Bewerbung)
--   * Chat, "Annahme gesehen", Zahlungsstatus
--   * alles, was die Plattform selbst automatisch macht (5-Minuten-Lauf, Rechnung)
--     und Admins/Support

create or replace function public.job_ist_vergangen(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select max((t.datum
                 + coalesce(t.uhrzeit_bis::text, j.uhrzeit_bis::text, '23:59')::time
                 + case when coalesce(t.uhrzeit_von::text, j.uhrzeit_von::text) is not null
                         and coalesce(t.uhrzeit_bis::text, j.uhrzeit_bis::text) is not null
                         and coalesce(t.uhrzeit_bis::text, j.uhrzeit_bis::text)::time
                             <= coalesce(t.uhrzeit_von::text, j.uhrzeit_von::text)::time
                        then interval '1 day' else interval '0' end
                ) at time zone 'Europe/Vienna')
     from public.job_termine t join public.jobs j on j.id = t.job_id
     where t.job_id = p_job_id),
    (select (j.datum
             + coalesce(j.uhrzeit_bis::text, '23:59')::time
             + case when j.uhrzeit_von is not null and j.uhrzeit_bis is not null
                     and j.uhrzeit_bis::text::time <= j.uhrzeit_von::text::time
                    then interval '1 day' else interval '0' end
            ) at time zone 'Europe/Vienna'
     from public.jobs j where j.id = p_job_id and j.datum is not null)
  ) <= now();
$$;

-- Wer darf trotzdem? Plattform-Automatik (service_role), Datenbank-Admin, ODOJ-Admins.
create or replace function public.odoj_darf_vergangenes_aendern()
returns boolean
language sql
stable
as $$
  select coalesce(auth.role(), '') = 'service_role'
      or current_user in ('postgres', 'supabase_admin')
      or public.is_admin();
$$;

-- Inserat (jobs)
create or replace function public.sperre_vergangenes_inserat()
returns trigger
language plpgsql
as $$
declare
  v_erlaubt text[] := array['ag_bewertung_abgegeben', 'jb_bewertung_abgegeben', 'ablauf_nachricht_gesendet',
                            'rechnung_erinnerung_gesendet_am', 'rechnung_blockiert', 'rechnung_blockiert_am',
                            'rechnung_uebersprungen_am'];
begin
  if public.odoj_darf_vergangenes_aendern() or not public.job_ist_vergangen(old.id) then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Dieses Inserat ist abgeschlossen und kann nicht mehr gelöscht werden.';
  end if;
  if (to_jsonb(new) - v_erlaubt) is distinct from (to_jsonb(old) - v_erlaubt) then
    raise exception 'Dieses Inserat ist abgeschlossen und kann nicht mehr geändert werden.';
  end if;
  return new;
end;
$$;

create trigger trg_sperre_vergangenes_inserat
  before update or delete on public.jobs
  for each row execute function public.sperre_vergangenes_inserat();

-- Termine (job_termine)
create or replace function public.sperre_termine_vergangenes_inserat()
returns trigger
language plpgsql
as $$
begin
  if public.odoj_darf_vergangenes_aendern() then
    return coalesce(new, old);
  end if;
  if public.job_ist_vergangen(coalesce(new.job_id, old.job_id))
     or (tg_op = 'UPDATE' and new.job_id is distinct from old.job_id and public.job_ist_vergangen(old.job_id)) then
    raise exception 'Dieses Inserat ist abgeschlossen. Termine können nicht mehr geändert werden.';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger trg_sperre_termine_vergangenes_inserat
  before insert or update or delete on public.job_termine
  for each row execute function public.sperre_termine_vergangenes_inserat();

-- Bewerbungen: Status/Termin/Nichterscheinen nicht mehr änderbar, nicht mehr löschbar
create or replace function public.sperre_bewerbung_vergangenes_inserat()
returns trigger
language plpgsql
as $$
begin
  if public.odoj_darf_vergangenes_aendern() or not public.job_ist_vergangen(old.job_id) then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Dieses Inserat ist abgeschlossen. Bewerbungen können nicht mehr gelöscht werden.';
  end if;
  if new.status is distinct from old.status
     or new.termin_id is distinct from old.termin_id
     or new.job_id is distinct from old.job_id
     or new.nicht_gekommen is distinct from old.nicht_gekommen then
    raise exception 'Dieses Inserat ist abgeschlossen und kann nicht mehr geändert werden.';
  end if;
  return new;
end;
$$;

create trigger trg_sperre_bewerbung_vergangenes_inserat
  before update or delete on public.bewerbungen
  for each row execute function public.sperre_bewerbung_vergangenes_inserat();
