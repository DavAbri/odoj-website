-- ODOJ Punkt 5: Stornieren einer bereits angenommenen Person (durch den Arbeitgeber).
-- NUR NEUES: zwei neue Spalten, eine Prüf-Regel, eine Freigabe-Regel.
-- Bestehende Daten und bestehende Regeln bleiben unverändert.

-- 1) Vermerk an der Bewerbung: wann und warum storniert wurde
alter table public.bewerbungen add column if not exists storniert_am timestamptz;
alter table public.bewerbungen add column if not exists storno_grund text;

-- 2) Prüf-Regel: Eine angenommene Person kann nach Arbeitsbeginn nicht mehr
--    entfernt werden (Stornieren, Ablehnen, Zurückziehen). Danach bleibt nur
--    "Nicht gekommen" bzw. der automatische Abschluss. Stornieren braucht
--    immer einen Grund. Plattform-Automatik und Admins sind ausgenommen.
create or replace function public.pruefe_storno()
returns trigger
language plpgsql
as $$
declare
  v_start timestamptz;
begin
  if public.odoj_darf_vergangenes_aendern() then
    return new;
  end if;

  if new.storniert_am is not null and old.storniert_am is null then
    if old.status is distinct from 'angenommen' then
      raise exception 'Stornieren ist nur bei angenommenen Bewerbungen möglich.';
    end if;
    if coalesce(btrim(new.storno_grund), '') = '' then
      raise exception 'Bitte gib einen Grund für die Stornierung an.';
    end if;
  end if;

  select (coalesce(t.datum, j.datum) + coalesce(t.uhrzeit_von::text, j.uhrzeit_von::text, '00:00')::time) at time zone 'Europe/Vienna'
    into v_start
  from public.jobs j
  left join public.job_termine t on t.id = new.termin_id
  where j.id = new.job_id;

  if v_start is not null and v_start <= now() then
    raise exception 'Der Einsatz hat schon begonnen und kann nicht mehr storniert oder abgesagt werden.';
  end if;

  return new;
end;
$$;

create trigger trg_pruefe_storno
  before update on public.bewerbungen
  for each row
  when (old.status = 'angenommen' and new.status is distinct from 'angenommen' and new.status is distinct from 'abgeschlossen')
  execute function public.pruefe_storno();

-- 3) Freigabe-Regel: Nach dem Stornieren wird ein ausgebuchtes Inserat mit nur
--    einem Termin wieder aktiv (gleiche Logik wie beim Zurückziehen durch den
--    Arbeitnehmer, bestehende Funktion wird nur zusätzlich aufgerufen).
create trigger trg_reaktiviere_job_bei_storno
  after update on public.bewerbungen
  for each row
  when (old.status = 'angenommen' and new.status is distinct from 'angenommen' and new.storniert_am is not null)
  execute function public.reaktiviere_job_bei_ruecktritt();
