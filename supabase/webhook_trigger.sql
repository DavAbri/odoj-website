CREATE OR REPLACE TRIGGER notify_new_nachricht
AFTER INSERT ON public.nachrichten
FOR EACH ROW
EXECUTE FUNCTION supabase_functions.http_request(
  'https://vixarulzbsfwnbfucbih.supabase.co/functions/v1/send-notification-email',
  'POST',
  '{"Content-Type":"application/json"}',
  '{}',
  '5000'
);

-- Prüft nach jeder Anwesenheitsbestätigung, ob der Jobber die monatliche
-- Geringfügigkeitsgrenze über ODOJ-Einkünfte überschritten hat, und löst
-- bei Bedarf eine einmalige Warn-E-Mail aus (siehe check-geringfuegigkeit).
CREATE OR REPLACE TRIGGER check_geringfuegigkeit_trigger
AFTER UPDATE OF anwesenheit_bestaetigt ON public.bewerbungen
FOR EACH ROW
WHEN (NEW.anwesenheit_bestaetigt = true AND (OLD.anwesenheit_bestaetigt IS DISTINCT FROM true))
EXECUTE FUNCTION supabase_functions.http_request(
  'https://vixarulzbsfwnbfucbih.supabase.co/functions/v1/check-geringfuegigkeit',
  'POST',
  '{"Content-Type":"application/json"}',
  '{}',
  '5000'
);
