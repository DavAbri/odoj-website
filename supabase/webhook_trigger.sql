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
