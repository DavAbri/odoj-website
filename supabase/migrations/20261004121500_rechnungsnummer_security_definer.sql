-- Fix: naechste_rechnungsnummer() lief bisher als der aufrufende Arbeitgeber
-- (SECURITY INVOKER, Postgres-Standard) und scheiterte daher an der RLS-Policy
-- von invoice_number_counters (nur is_admin() darf dort schreiben). Mit
-- SECURITY DEFINER läuft nur DIESE Funktion mit den Rechten des Funktions-
-- Eigentümers - auth.uid() liest weiterhin korrekt den echten Aufrufer aus
-- dem JWT, die Berechtigungsprüfung in rechnung_erstellen() bleibt also
-- unverändert wirksam. search_path wird fix gesetzt (Security-Best-Practice
-- bei SECURITY DEFINER).
create or replace function public.naechste_rechnungsnummer()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_jahr   integer := extract(year from now())::integer;
  v_nummer integer;
begin
  insert into public.invoice_number_counters (jahr, letzte_nummer)
  values (v_jahr, 1)
  on conflict (jahr) do update set letzte_nummer = invoice_number_counters.letzte_nummer + 1
  returning letzte_nummer into v_nummer;

  return 'ODOJ-' || v_jahr || '-' || lpad(v_nummer::text, 4, '0');
end;
$$;
