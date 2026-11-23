-- ODOJ: Freie Plätze auf der Jobbörse richtig anzeigen (23.11.2026).
-- NUR NEU: eine Abfrage-Funktion. Keine Daten werden verändert.
--
-- Bisher hat die Jobbörse die vergebenen Plätze aus den Bewerbungen gezählt -
-- fremde Bewerbungen darf aber (richtigerweise) nur der jeweilige Arbeitgeber
-- sehen. Für alle anderen stand deshalb immer "alle Plätze frei".
-- Diese Funktion liefert NUR die Anzahl angenommener Personen pro Inserat
-- bzw. Termin - keine Namen, keine Nutzer-IDs, keine sonstigen Daten.
--
-- Zurück: drop function if exists public.belegte_plaetze(uuid[]);

create or replace function public.belegte_plaetze(p_job_ids uuid[])
returns table (job_id uuid, termin_id uuid, angenommen integer)
language sql
stable
security definer
set search_path = public
as $$
  select b.job_id, b.termin_id, count(*)::integer
  from public.bewerbungen b
  where b.job_id = any(p_job_ids)
    and coalesce(array_length(p_job_ids, 1), 0) <= 500
    and b.status = 'angenommen'
  group by b.job_id, b.termin_id;
$$;

revoke all on function public.belegte_plaetze(uuid[]) from public;
grant execute on function public.belegte_plaetze(uuid[]) to anon, authenticated;
