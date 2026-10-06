-- Vorschau-Modus: Registrierung ist offen, Jobinserate bleiben bis zum
-- Launch unsichtbar. Zentraler Schalter in app_settings (Singleton-Zeile,
-- id immer 1), von Admin änderbar, von allen anderen nur lesbar.
create table if not exists public.app_settings (
  id              integer primary key default 1,
  jobs_sichtbar   boolean not null default false,
  launch_kw       integer,
  launch_datum    date,
  aktualisiert_am timestamptz not null default now(),
  constraint app_settings_single_row check (id = 1)
);

insert into public.app_settings (id, jobs_sichtbar, launch_kw)
values (1, false, 42)
on conflict (id) do nothing;

create or replace function public.app_settings_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.aktualisiert_am = now();
  return new;
end;
$$;

drop trigger if exists trg_app_settings_updated_at on public.app_settings;
create trigger trg_app_settings_updated_at
  before update on public.app_settings
  for each row execute function public.app_settings_set_updated_at();

alter table public.app_settings enable row level security;

create policy "app_settings lesen" on public.app_settings
  for select
  to public
  using (true);

create policy "app_settings nur Admin aendern" on public.app_settings
  for update
  to authenticated
  using (is_admin())
  with check (is_admin());

-- Jobs/Termine im Vorschau-Modus wirklich sperren, nicht nur im Frontend
-- ausblenden: sichtbar nur wenn freigegeben, sonst nur für den jeweils
-- eigenen Arbeitgeber bzw. Admin.
drop policy if exists "Jobs lesen" on public.jobs;
create policy "Jobs lesen" on public.jobs
  for select
  to public
  using (
    (select jobs_sichtbar from public.app_settings where id = 1)
    or auth.uid() = arbeitgeber_id
    or is_admin()
  );

drop policy if exists "Termine lesen" on public.job_termine;
create policy "Termine lesen" on public.job_termine
  for select
  to public
  using (
    (select jobs_sichtbar from public.app_settings where id = 1)
    or is_admin()
    or exists (
      select 1 from public.jobs j
      where j.id = job_termine.job_id and j.arbeitgeber_id = auth.uid()
    )
  );

-- Bewerbungen im Vorschau-Modus serverseitig ablehnen, unabhängig vom
-- Frontend (gleiches Muster wie der bestehende Mindestalter-Trigger).
create or replace function public.pruefe_vorschau_modus()
returns trigger
language plpgsql
as $$
begin
  if not coalesce((select jobs_sichtbar from public.app_settings where id = 1), false) then
    raise exception 'Bewerbungen sind im Vorschau-Modus noch nicht möglich.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pruefe_vorschau_modus on public.bewerbungen;
create trigger trg_pruefe_vorschau_modus
  before insert on public.bewerbungen
  for each row execute function public.pruefe_vorschau_modus();
