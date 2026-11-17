-- ODOJ: Andere Bewerber informieren, wenn alle Plätze vergeben sind -
-- und wieder informieren, wenn ein Platz frei wird (17.11.2026).
-- NUR NEUES: eine Spalte, zwei Funktionen, zwei Trigger. Keine bestehenden
-- Daten werden verändert.
--
-- 1) Sobald für einen Termin (bzw. ein Inserat ohne Termine) alle Plätze
--    vergeben sind, werden alle noch offenen Bewerbungen für genau diesen
--    Termin auf "nicht berücksichtigt" gesetzt (mit Vermerk "Platz vergeben")
--    und bekommen eine Chat-Nachricht (-> automatisch auch eine Mail).
-- 2) Wird danach wieder ein Platz frei (Stornieren, Zurückziehen) und der
--    Termin hat noch nicht begonnen, werden genau diese Bewerbungen wieder
--    geöffnet ("ausstehend") und bekommen eine Chat-Nachricht + Mail.
--
-- Zurück: drop trigger if exists trg_platz_voll on public.bewerbungen;
--         drop trigger if exists trg_platz_wieder_frei on public.bewerbungen;

alter table public.bewerbungen add column if not exists platz_vergeben_am timestamptz;

create or replace function public.bei_platz_voll()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job     record;
  v_datum   date;
  v_anzahl  integer;
  v_b       record;
  v_datum_txt text;
begin
  select id, titel, plaetze, arbeitgeber_id, datum, firmenname into v_job from public.jobs where id = new.job_id;
  if v_job.id is null then return new; end if;

  if new.termin_id is not null then
    select datum into v_datum from public.job_termine where id = new.termin_id;
    select count(*) into v_anzahl from public.bewerbungen
      where termin_id = new.termin_id and status = 'angenommen';
  else
    v_datum := v_job.datum;
    select count(*) into v_anzahl from public.bewerbungen
      where job_id = new.job_id and termin_id is null and status = 'angenommen';
  end if;

  if v_anzahl < coalesce(v_job.plaetze, 1) then
    return new;
  end if;

  v_datum_txt := coalesce(to_char(v_datum, 'DD.MM.YYYY'), '');

  for v_b in
    select id, jobber_id from public.bewerbungen
    where job_id = new.job_id
      and termin_id is not distinct from new.termin_id
      and status = 'ausstehend'
      and id <> new.id
  loop
    update public.bewerbungen
      set status = 'abgelehnt', platz_vergeben_am = now()
      where id = v_b.id;
    insert into public.nachrichten (bewerbung_id, sender_id, empfaenger_id, nachricht, gelesen, erstellt_am)
    values (v_b.id, v_job.arbeitgeber_id, v_b.jobber_id,
      'Vielen Dank für deine Bewerbung für „' || coalesce(v_job.titel, 'den Job') || '“'
      || case when v_datum_txt <> '' then ' am ' || v_datum_txt else '' end
      || '. Leider wurden inzwischen alle Plätze vergeben. Falls wieder ein Platz frei wird, melden wir uns automatisch bei dir. Schau gern in der Jobbörse nach weiteren Jobs!',
      false, now());
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_platz_voll on public.bewerbungen;
create trigger trg_platz_voll
  after update on public.bewerbungen
  for each row
  when (new.status = 'angenommen' and old.status is distinct from 'angenommen')
  execute function public.bei_platz_voll();

create or replace function public.bei_platz_wieder_frei()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job     record;
  v_datum   date;
  v_von     text;
  v_start   timestamptz;
  v_anzahl  integer;
  v_b       record;
  v_datum_txt text;
begin
  select id, titel, plaetze, arbeitgeber_id, datum, uhrzeit_von into v_job from public.jobs where id = new.job_id;
  if v_job.id is null then return new; end if;

  if new.termin_id is not null then
    select t.datum, coalesce(t.uhrzeit_von::text, v_job.uhrzeit_von::text) into v_datum, v_von
      from public.job_termine t where t.id = new.termin_id;
    select count(*) into v_anzahl from public.bewerbungen
      where termin_id = new.termin_id and status = 'angenommen';
  else
    v_datum := v_job.datum;
    v_von := v_job.uhrzeit_von::text;
    select count(*) into v_anzahl from public.bewerbungen
      where job_id = new.job_id and termin_id is null and status = 'angenommen';
  end if;

  -- nur vor Beginn des Termins und nur, wenn wirklich wieder Platz ist
  v_start := (v_datum + coalesce(v_von, '00:00')::time) at time zone 'Europe/Vienna';
  if v_datum is null or v_start <= now() or v_anzahl >= coalesce(v_job.plaetze, 1) then
    return new;
  end if;

  v_datum_txt := to_char(v_datum, 'DD.MM.YYYY');

  for v_b in
    select id, jobber_id from public.bewerbungen
    where job_id = new.job_id
      and termin_id is not distinct from new.termin_id
      and status = 'abgelehnt'
      and platz_vergeben_am is not null
      and id <> new.id
  loop
    update public.bewerbungen
      set status = 'ausstehend', platz_vergeben_am = null
      where id = v_b.id;
    insert into public.nachrichten (bewerbung_id, sender_id, empfaenger_id, nachricht, gelesen, erstellt_am)
    values (v_b.id, v_job.arbeitgeber_id, v_b.jobber_id,
      '🔔 Wieder ein Platz frei' || chr(10) || chr(10)
      || 'Für „' || coalesce(v_job.titel, 'den Job') || '“ am ' || v_datum_txt
      || ' ist wieder ein Platz frei. Deine Bewerbung ist wieder offen – der Arbeitgeber kann dich jetzt noch annehmen. Du musst nichts weiter tun.',
      false, now());
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_platz_wieder_frei on public.bewerbungen;
create trigger trg_platz_wieder_frei
  after update on public.bewerbungen
  for each row
  when (old.status = 'angenommen' and new.status is distinct from 'angenommen' and new.status is distinct from 'abgeschlossen')
  execute function public.bei_platz_wieder_frei();
