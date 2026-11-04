-- Auf LIVE (und Staging) ausführen. Freigabe "Ja" liegt vor.
-- Ergänzt david.aberer@odoj.at und sebastian.wimmer@odoj.at als Admins
-- (gleiche Rechte wie die bestehenden Admin-Adressen). Nur die Liste in
-- is_admin() wird erweitert, sonst ändert sich nichts.
create or replace function public.is_admin()
returns boolean
language sql
stable
as $function$ SELECT lower(coalesce(auth.jwt() ->> 'email', '')) IN ('mail4david85@gmail.com', 'admin@odoj.at', 'david.aberer@odoj.at', 'sebastian.wimmer@odoj.at') $function$;
