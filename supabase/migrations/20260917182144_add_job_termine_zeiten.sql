-- Optionale, individuelle Uhrzeiten pro Termin bei Mehrtages-Inseraten.
-- NULL = Termin übernimmt die Standardzeit des Jobs (jobs.uhrzeit_von/bis).
alter table public.job_termine
  add column if not exists uhrzeit_von time,
  add column if not exists uhrzeit_bis time;
