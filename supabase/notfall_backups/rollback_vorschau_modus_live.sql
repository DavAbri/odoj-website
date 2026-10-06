-- ========================================================================
-- NOTFALL-ROLLBACK für die Vorschau-Modus-Migration (20261007090000).
-- NICHT automatisch ausführen / nicht Teil der normalen Migrationskette
-- (daher der Dateiname mit "99999999999999" und Warnhinweis) - nur von Hand
-- im SQL-Editor ausführen, falls der Vorschau-Modus auf LIVE wieder
-- komplett entfernt werden muss.
--
-- Stellt exakt die RLS-Policies wieder her, die vor der Vorschau-Modus-
-- Migration auf der LIVE-Datenbank (vixarulzbsfwnbfucbih) aktiv waren -
-- 1:1 abgeschrieben per `supabase db pull` am 2026-10-06, bevor die
-- Migration angewendet wurde.
-- ========================================================================

drop policy if exists "Jobs lesen" on public.jobs;
create policy "Jobs lesen" on public.jobs
  for select
  to public
  using (true);

drop policy if exists "Termine lesen" on public.job_termine;
create policy "Termine lesen" on public.job_termine
  for select
  to public
  using (true);

drop trigger if exists trg_pruefe_vorschau_modus on public.bewerbungen;
drop function if exists public.pruefe_vorschau_modus();

drop policy if exists "app_settings lesen" on public.app_settings;
drop policy if exists "app_settings nur Admin aendern" on public.app_settings;
drop table if exists public.app_settings;
