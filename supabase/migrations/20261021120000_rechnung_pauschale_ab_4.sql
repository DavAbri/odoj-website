-- Erst auf STAGING testen, dann auf LIVE ausführen (Freigabe "Ja" liegt vor).
-- ========================================================================
-- Neue Vermittlungsgebühr pro Termin:
--   1-3 vermittelte Arbeitskräfte an einem Termin: 15 € pro Person
--   4 oder mehr an einem Termin:                    pauschal 50 €
-- Gezählt werden wie bisher nur angenommene/abgeschlossene Bewerbungen ohne
-- "nicht erschienen". Bei mehreren Terminen wird jeder Termin einzeln
-- berechnet und summiert.
--
-- Ändert NUR die Berechnung in rechnung_erstellen_fuer_job (gleicher Aufbau,
-- gleiche Prüfungen, gleiche Rechnungsnummern-Vergabe). Bereits erstellte
-- Rechnungen bleiben unverändert (die Funktion gibt eine bestehende Rechnung
-- eines Inserats wie bisher unverändert zurück).
--
-- Rechnungspositionen bleiben eine Zeile pro vermittelter Person (wegen der
-- festen Verknüpfung zur Bewerbung). Bei der Pauschale wird der Betrag auf
-- die Personen des Termins aufgeteilt (Cent-Rest auf die erste Person), so
-- dass die Summe pro Termin exakt 50,00 € ergibt. Das PDF fasst die Zeilen
-- pro Termin zu einer Zeile zusammen.
-- ========================================================================
begin;

create or replace function public.rechnung_erstellen_fuer_job(p_job_id uuid)
returns public.invoices
language plpgsql
as $function$
declare
  v_arbeitgeber_id uuid;
  v_bestehend      public.invoices;
  v_neu            public.invoices;
  v_anzahl         integer;
  v_summe          numeric(10,2);
begin
  select arbeitgeber_id into v_arbeitgeber_id from public.jobs where id = p_job_id;
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

  -- Abrechenbare Personen, gruppiert nach Termin (Einzeltag-Inserat = ein Termin)
  select count(*),
         coalesce(sum(case when g.n >= 4 then 50.00 else g.n * 15.00 end), 0)
    into v_anzahl, v_summe
  from (
    select coalesce(b.termin_id::text, 'einzeltag') as termin_key, count(*) as n
    from public.bewerbungen b
    where b.job_id = p_job_id
      and b.status in ('angenommen', 'abgeschlossen')
      and coalesce(b.nicht_gekommen, false) = false
    group by 1
  ) g;
  -- v_anzahl oben = Anzahl Termine; für die Prüfung reicht "> 0"
  if v_anzahl = 0 then
    raise exception 'Keine abrechenbare Bewerbung für Job % gefunden - keine Rechnung erstellt.', p_job_id;
  end if;

  insert into public.invoices (invoice_number, job_id, arbeitgeber_id, amount)
  values (public.naechste_rechnungsnummer(), p_job_id, v_arbeitgeber_id, v_summe)
  returning * into v_neu;

  insert into public.invoice_items (invoice_id, bewerbung_id, betrag, beschreibung, einsatzdatum)
  select v_neu.id, x.bewerbung_id,
         case when x.n >= 4
              then (5000 / x.n)::numeric / 100
                   + case when x.rn = 1 then (5000 - (5000 / x.n) * x.n)::numeric / 100 else 0 end
              else 15.00 end,
         'Vermittlung - ' || x.titel || case when x.n >= 4 then ' (Pauschale ab 4 Arbeitskräften)' else '' end,
         x.einsatzdatum
  from (
    select b.id as bewerbung_id,
           coalesce(t.datum, j.datum) as einsatzdatum,
           coalesce(j.titel, 'Tagesjob') as titel,
           count(*) over (partition by coalesce(b.termin_id::text, 'einzeltag')) as n,
           row_number() over (partition by coalesce(b.termin_id::text, 'einzeltag') order by b.id) as rn
    from public.bewerbungen b
    join public.jobs j on j.id = b.job_id
    left join public.job_termine t on t.id = b.termin_id
    where b.job_id = p_job_id
      and b.status in ('angenommen', 'abgeschlossen')
      and coalesce(b.nicht_gekommen, false) = false
  ) x;

  return v_neu;
end;
$function$;

commit;
