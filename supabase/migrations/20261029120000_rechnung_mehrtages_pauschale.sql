-- Erst auf STAGING testen, dann auf LIVE ausführen (Freigabe "Ja" liegt vor).
-- ========================================================================
-- Vermittlungsgebühr, Erweiterung von Datei 33:
--
-- "Mehrtages-Inserat" = mindestens 4 Termine UND Mindestanzahl Termine >= 4.
--   * Arbeiten an KEINEM Termin 4 oder mehr Personen:
--       pauschal 50 € pro Arbeitskraft (egal wie viele Tage, auch wenn sie an
--       einzelnen Tagen nicht erschienen ist). Eine Arbeitskraft, die an
--       keinem einzigen Tag erschienen ist, zählt nicht (0 €).
--   * Arbeiten an mindestens einem Termin 4 oder mehr Personen:
--       ganz normal pro Termin (siehe unten).
-- Alle anderen Inserate (pro Termin, unverändert seit Datei 33):
--   1-3 Personen an einem Termin: 15 € pro Person; ab 4 Personen: pauschal 50 €.
--
-- Nur die Berechnung in rechnung_erstellen_fuer_job ändert sich. Bereits
-- erstellte Rechnungen bleiben unverändert. Positionen bleiben eine Zeile pro
-- vermittelter Person und Tag (feste Verknüpfung zur Bewerbung); Pauschalen
-- werden darauf aufgeteilt (Cent-Rest auf die erste Zeile), das PDF fasst
-- die Zeilen wieder zusammen.
-- ========================================================================
begin;

create or replace function public.rechnung_erstellen_fuer_job(p_job_id uuid)
returns public.invoices
language plpgsql
as $function$
declare
  v_arbeitgeber_id uuid;
  v_mindest        integer;
  v_bestehend      public.invoices;
  v_neu            public.invoices;
  v_anzahl         integer;
  v_summe          numeric(10,2);
  v_mehrtag        boolean;
  v_max_pro_termin integer;
begin
  select arbeitgeber_id, mindest_termine into v_arbeitgeber_id, v_mindest from public.jobs where id = p_job_id;
  if v_arbeitgeber_id is null then
    raise exception 'Job % nicht gefunden.', p_job_id;
  end if;

  if auth.role() <> 'service_role' and v_arbeitgeber_id <> auth.uid() and not is_admin() then
    raise exception 'Nicht berechtigt, für diesen Job eine Rechnung anzulegen.';
  end if;

  select * into v_bestehend from public.invoices where job_id = p_job_id;
  if found then
    return v_bestehend;
  end if;

  -- Abrechenbare Zeilen (angenommen/abgeschlossen, nicht "nicht erschienen")
  select count(*), coalesce(max(n), 0) into v_anzahl, v_max_pro_termin
  from (
    select count(*) as n
    from public.bewerbungen b
    where b.job_id = p_job_id
      and b.status in ('angenommen', 'abgeschlossen')
      and coalesce(b.nicht_gekommen, false) = false
    group by coalesce(b.termin_id::text, 'einzeltag')
  ) g;

  if v_anzahl = 0 then
    raise exception 'Keine abrechenbare Bewerbung für Job % gefunden - keine Rechnung erstellt.', p_job_id;
  end if;

  v_mehrtag := coalesce(v_mindest, 0) >= 4
           and (select count(*) from public.job_termine t where t.job_id = p_job_id) >= 4
           and v_max_pro_termin < 4;

  if v_mehrtag then
    -- Mehrtages-Pauschale: 50 € pro Arbeitskraft
    select count(distinct b.jobber_id) * 50.00 into v_summe
    from public.bewerbungen b
    where b.job_id = p_job_id
      and b.status in ('angenommen', 'abgeschlossen')
      and coalesce(b.nicht_gekommen, false) = false;
  else
    select coalesce(sum(case when g.n >= 4 then 50.00 else g.n * 15.00 end), 0) into v_summe
    from (
      select count(*) as n
      from public.bewerbungen b
      where b.job_id = p_job_id
        and b.status in ('angenommen', 'abgeschlossen')
        and coalesce(b.nicht_gekommen, false) = false
      group by coalesce(b.termin_id::text, 'einzeltag')
    ) g;
  end if;

  insert into public.invoices (invoice_number, job_id, arbeitgeber_id, amount)
  values (public.naechste_rechnungsnummer(), p_job_id, v_arbeitgeber_id, v_summe)
  returning * into v_neu;

  -- Gruppe = Arbeitskraft (Mehrtages-Pauschale) bzw. Termin; Pauschale wird
  -- auf die Zeilen der Gruppe aufgeteilt, Cent-Rest auf die erste Zeile.
  insert into public.invoice_items (invoice_id, bewerbung_id, betrag, beschreibung, einsatzdatum)
  select v_neu.id, x.bewerbung_id,
         case when v_mehrtag or x.n >= 4
              then (5000 / x.n)::numeric / 100
                   + case when x.rn = 1 then (5000 - (5000 / x.n) * x.n)::numeric / 100 else 0 end
              else 15.00 end,
         'Vermittlung - ' || x.titel ||
           case when v_mehrtag then ' (Mehrtages-Pauschale)'
                when x.n >= 4 then ' (Pauschale ab 4 Arbeitskräften)'
                else '' end,
         x.einsatzdatum
  from (
    select b.id as bewerbung_id,
           coalesce(t.datum, j.datum) as einsatzdatum,
           coalesce(j.titel, 'Tagesjob') as titel,
           count(*) over w as n,
           row_number() over (w order by coalesce(t.datum, j.datum), b.id) as rn
    from public.bewerbungen b
    join public.jobs j on j.id = b.job_id
    left join public.job_termine t on t.id = b.termin_id
    where b.job_id = p_job_id
      and b.status in ('angenommen', 'abgeschlossen')
      and coalesce(b.nicht_gekommen, false) = false
    window w as (partition by case when v_mehrtag then b.jobber_id::text
                                   else coalesce(b.termin_id::text, 'einzeltag') end)
  ) x;

  return v_neu;
end;
$function$;

commit;
