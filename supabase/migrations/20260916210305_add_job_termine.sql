-- Aufräumen: temporäre Reporting-Tabelle aus der RLS-Introspektion
drop table if exists public._tmp_policy_report;

-- Mehrfach-Termine pro Jobinserat: nur befüllt für "Mehrere Tage"-Jobs.
-- Einzeltag-Jobs bekommen NIE Zeilen hier -> ihr Codepfad bleibt unberührt.
create table if not exists public.job_termine (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references public.jobs(id) on delete cascade,
  datum        date not null,
  erstellt_am  timestamptz not null default now(),
  unique (job_id, datum)
);
create index if not exists idx_job_termine_job_id on public.job_termine(job_id);
create index if not exists idx_job_termine_datum  on public.job_termine(datum);

-- Mindestanzahl an Terminen für eine gültige Bewerbung (nullable = keine Mindestanzahl)
alter table public.jobs
  add column if not exists mindest_termine integer;

-- Verknüpfung bewerbungen -> job_termine.
-- NULL = Einzeltag-Bewerbung (heutiges Verhalten, unverändert).
-- SET  = eine Zeile pro gewähltem Termin bei Mehrtages-Jobs.
-- ON DELETE SET NULL (nicht CASCADE): ein gelöschter Termin darf abgeschlossene
-- Bewerbungen/Rechnungen nicht mitreißen.
alter table public.bewerbungen
  add column if not exists termin_id uuid references public.job_termine(id) on delete set null;
create index if not exists idx_bewerbungen_termin_id on public.bewerbungen(termin_id);

-- RLS: gleiches Muster wie die bestehenden "jobs"-Policies (per Introspektion
-- von pg_policies bestätigt: "Jobs lesen" = public SELECT using(true),
-- "Jobs schreiben" = public ALL using(auth.uid() = arbeitgeber_id), plus
-- jobs_admin_all = authenticated ALL using/with_check is_admin()).
alter table public.job_termine enable row level security;

create policy "Termine lesen" on public.job_termine
  for select
  using (true);

create policy "Termine schreiben" on public.job_termine
  for all
  using (exists (
    select 1 from public.jobs j
    where j.id = job_termine.job_id and j.arbeitgeber_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.jobs j
    where j.id = job_termine.job_id and j.arbeitgeber_id = auth.uid()
  ));

create policy "job_termine_admin_all" on public.job_termine
  for all
  to authenticated
  using (is_admin())
  with check (is_admin());
