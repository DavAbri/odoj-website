-- Serverseitige Absicherung des Mindestalters: eine Bewerbung darf nur
-- entstehen, wenn der Jobber am Einsatztag (Termin-Datum, sonst jobs.datum)
-- alt genug ist. Rein clientseitige Prüfung (job-detail.html) wäre umgehbar
-- (DevTools, direkter API-Call) - das hier ist die eigentliche Schranke.
--
-- Fehlt ein Geburtsdatum im Profil, wird die Bewerbung ebenfalls abgelehnt,
-- NICHT stillschweigend durchgelassen. Hat das Inserat kein Mindestalter
-- gesetzt, greift die Prüfung gar nicht.
--
-- Die Fehlermeldungen sind bewusst generisch ("Mindestalter nicht erfüllt")
-- und verraten dem Aufrufer nicht das tatsächliche Alter/Geburtsdatum - das
-- bekommt ohnehin nur der Jobber selbst zu sehen (eigene Bewerbung).
create or replace function public.pruefe_mindestalter()
returns trigger
language plpgsql
as $$
declare
  v_mindestalter integer;
  v_einsatzdatum date;
  v_geburtsdatum date;
  v_alter        integer;
begin
  if new.termin_id is not null then
    select j.mindestalter, t.datum into v_mindestalter, v_einsatzdatum
    from public.job_termine t
    join public.jobs j on j.id = t.job_id
    where t.id = new.termin_id;
  else
    select mindestalter, datum into v_mindestalter, v_einsatzdatum
    from public.jobs where id = new.job_id;
  end if;

  -- Kein Mindestalter am Inserat hinterlegt -> keine Einschränkung.
  if v_mindestalter is null then
    return new;
  end if;

  select geburtsdatum into v_geburtsdatum
  from public."Profile" where user_id = new.jobber_id;

  if v_geburtsdatum is null then
    raise exception 'Bitte ergänze dein Geburtsdatum im Profil, um dich zu bewerben.';
  end if;

  v_alter := extract(year from age(v_einsatzdatum, v_geburtsdatum))::integer;
  if v_alter < v_mindestalter then
    raise exception 'Mindestalter für dieses Inserat nicht erfüllt.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_pruefe_mindestalter on public.bewerbungen;
create trigger trg_pruefe_mindestalter
  before insert on public.bewerbungen
  for each row execute function public.pruefe_mindestalter();
