-- Termine über Mitternacht (z. B. 22:00–02:00): Ende liegt am Folgetag.
-- Bisher wurde das Ende auf denselben Kalendertag gerechnet, wodurch
-- "Job erledigt"-Mails, der Abschluss und ggf. die Rechnung zu früh kamen.
-- Regel: Ist die End-Uhrzeit <= Start-Uhrzeit, endet der Termin am nächsten Tag.

create or replace function public.faellige_termin_ende_bewerbungen()
 returns table(bewerbung_id uuid, job_id uuid, jobber_id uuid, arbeitgeber_id uuid)
 language sql
 stable
as $function$
  select b.id, b.job_id, b.jobber_id, j.arbeitgeber_id
  from public.bewerbungen b
  join public.jobs j on j.id = b.job_id
  left join public.job_termine t on t.id = b.termin_id
  cross join lateral (
    select
      coalesce(t.uhrzeit_von::text, j.uhrzeit_von::text) as von,
      coalesce(t.uhrzeit_bis::text, j.uhrzeit_bis::text) as bis
  ) z
  where b.status = 'angenommen'
    and coalesce(b.nicht_gekommen, false) = false
    and b.ende_mail_gesendet_am is null
    and (
      coalesce(t.datum, j.datum)
      + coalesce(z.bis, z.von, '00:00')::time
      + case when z.von is not null and z.bis is not null and z.bis::time <= z.von::time
             then interval '1 day' else interval '0' end
    ) at time zone 'Europe/Vienna' <= now();
$function$;

create or replace function public.faellige_rechnung_jobs()
 returns table(job_id uuid, arbeitgeber_id uuid)
 language sql
 stable
as $function$
  with letztes_ende as (
    select
      j.id as job_id, j.arbeitgeber_id,
      coalesce(
        (select max((
            t.datum
            + coalesce(t.uhrzeit_bis::text, t.uhrzeit_von::text, '00:00')::time
            + case when t.uhrzeit_von is not null and t.uhrzeit_bis is not null
                        and t.uhrzeit_bis::text::time <= t.uhrzeit_von::text::time
                   then interval '1 day' else interval '0' end
          ) at time zone 'Europe/Vienna')
         from public.job_termine t where t.job_id = j.id),
        (
          j.datum
          + coalesce(j.uhrzeit_bis::text, j.uhrzeit_von::text, '00:00')::time
          + case when j.uhrzeit_von is not null and j.uhrzeit_bis is not null
                      and j.uhrzeit_bis::text::time <= j.uhrzeit_von::text::time
                 then interval '1 day' else interval '0' end
        ) at time zone 'Europe/Vienna'
      ) as ende_at
    from public.jobs j
    where j.rechnung_uebersprungen_am is null
      and not exists (select 1 from public.invoices i where i.job_id = j.id)
  )
  select le.job_id, le.arbeitgeber_id
  from letztes_ende le
  where le.ende_at <= now()
    and exists (
      select 1 from public.bewerbungen b
      where b.job_id = le.job_id
        and b.status in ('angenommen', 'abgeschlossen')
        and coalesce(b.nicht_gekommen, false) = false
    );
$function$;
