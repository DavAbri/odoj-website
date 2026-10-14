-- Verifiziert durch einen echten Gleichzeitigkeitstest (3 parallele Aufrufe
-- für dieselbe bewerbung_id): Duplikate waren bereits ausgeschlossen, aber
-- der "Verlierer" eines Wettlaufs bekam einen rohen unique_violation-Fehler
-- statt einfach die bereits angelegte Rechnung zurückzubekommen. Mit
-- INSERT ... ON CONFLICT (bewerbung_id) DO NOTHING + Fallback-SELECT gibt
-- jeder gleichzeitige Aufruf für dieselbe Bewerbung dieselbe Rechnung zurück,
-- ohne Fehler.
create or replace function public.rechnung_erstellen(p_bewerbung_id uuid)
returns public.invoices
language plpgsql
as $$
declare
  v_arbeitgeber_id uuid;
  v_ergebnis       public.invoices;
begin
  select j.arbeitgeber_id into v_arbeitgeber_id
  from public.bewerbungen b
  join public.jobs j on j.id = b.job_id
  where b.id = p_bewerbung_id;

  if v_arbeitgeber_id is null then
    raise exception 'Bewerbung % nicht gefunden.', p_bewerbung_id;
  end if;

  if v_arbeitgeber_id <> auth.uid() then
    raise exception 'Nicht berechtigt, für diese Bewerbung eine Rechnung anzulegen.';
  end if;

  select * into v_ergebnis from public.invoices where bewerbung_id = p_bewerbung_id;
  if found then
    return v_ergebnis;
  end if;

  insert into public.invoices (invoice_number, bewerbung_id, arbeitgeber_id)
  values (public.naechste_rechnungsnummer(), p_bewerbung_id, v_arbeitgeber_id)
  on conflict (bewerbung_id) do nothing
  returning * into v_ergebnis;

  if found then
    return v_ergebnis;
  end if;

  -- Ein paralleler Aufruf hat gerade in diesem Moment gewonnen - dessen Zeile zurückgeben.
  select * into v_ergebnis from public.invoices where bewerbung_id = p_bewerbung_id;
  return v_ergebnis;
end;
$$;
