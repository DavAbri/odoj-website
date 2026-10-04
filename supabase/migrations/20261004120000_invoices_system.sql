-- Saubere Ablöse des bisherigen Ad-hoc-"rechnungen"-Systems durch ein
-- eigenständiges invoices-System mit race-sicherer, eindeutiger Rechnungsnummer.
--
-- Die alte Tabelle "rechnungen" vermischte drei unterschiedliche Dinge in
-- einer Zeile (ODOJ-Rechnung an den Arbeitgeber, Lohn-Info, Jobber-Auszahlungs-
-- historie) und speicherte Jobber-Name/Jobtitel direkt statt per Referenz.
-- Mit Freigabe des Betreibers (Testdaten, keine echten Rechnungen) komplett
-- entfernt statt migriert. Die Jobber-"Auszahlungen"-Ansicht wird im
-- Anwendungscode auf bewerbungen+jobs umgestellt und braucht diese Tabelle
-- nicht mehr.
drop table if exists public.rechnungen;

-- Pro Kalenderjahr ein Zähler für die fortlaufende Rechnungsnummer.
create table if not exists public.invoice_number_counters (
  jahr          integer primary key,
  letzte_nummer integer not null default 0
);

-- Eine Rechnung pro erfolgreich abgeschlossenem Einsatz (= eine bewerbungen-
-- Zeile; bei Mehrfach-Terminen hat jeder Termin ohnehin seine eigene
-- bewerbungen-Zeile, die Gebühr fällt also automatisch pro Termin an).
-- Bewusst OHNE Jobber-Name/Jobtitel/Adresse - diese werden bei Bedarf über
-- bewerbung_id -> bewerbungen.job_id -> jobs / Profile aufgelöst, um
-- personenbezogene Daten nicht doppelt zu speichern.
create table if not exists public.invoices (
  id                   uuid primary key default gen_random_uuid(),
  invoice_number       text not null unique,
  bewerbung_id         uuid not null unique references public.bewerbungen(id),
  arbeitgeber_id       uuid not null references auth.users(id),
  amount               numeric(10,2) not null default 15.00,
  issued_at            date not null default current_date,
  due_at               date not null default (current_date + interval '14 days'),
  payment_status       text not null default 'offen' check (payment_status in ('offen', 'bezahlt', 'storniert')),
  payment_received_at  timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists idx_invoices_arbeitgeber_id on public.invoices(arbeitgeber_id);
create index if not exists idx_invoices_payment_status on public.invoices(payment_status);

-- updated_at automatisch mitführen (einmaliger Trigger statt in jeder Policy/App-Stelle nachpflegen)
create or replace function public.invoices_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_invoices_updated_at on public.invoices;
create trigger trg_invoices_updated_at
  before update on public.invoices
  for each row execute function public.invoices_set_updated_at();

-- Atomare, lückenlos-eindeutige Rechnungsnummer ODOJ-JAHR-NNNN. Die
-- INSERT ... ON CONFLICT DO UPDATE ... RETURNING-Form ist in Postgres ein
-- einzelnes atomares Statement - zwei gleichzeitige Aufrufe serialisieren
-- sich automatisch über die Zeilensperre, Duplikate sind damit ausgeschlossen.
create or replace function public.naechste_rechnungsnummer()
returns text
language plpgsql
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

-- Einzige Stelle, an der eine Rechnung entstehen darf: prüft, dass der
-- Aufrufer wirklich der Arbeitgeber dieses Einsatzes ist, vergibt die
-- nächste Nummer und legt die Zeile an - alles in einer Transaktion.
-- Idempotent: existiert für diese bewerbung_id bereits eine Rechnung
-- (z.B. durch einen erneuten Klick), wird einfach die bestehende zurückgegeben
-- statt eine zweite anzulegen.
create or replace function public.rechnung_erstellen(p_bewerbung_id uuid)
returns public.invoices
language plpgsql
as $$
declare
  v_arbeitgeber_id uuid;
  v_bestehend      public.invoices;
  v_neu            public.invoices;
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

  select * into v_bestehend from public.invoices where bewerbung_id = p_bewerbung_id;
  if found then
    return v_bestehend;
  end if;

  insert into public.invoices (invoice_number, bewerbung_id, arbeitgeber_id)
  values (public.naechste_rechnungsnummer(), p_bewerbung_id, v_arbeitgeber_id)
  returning * into v_neu;

  return v_neu;
end;
$$;

alter table public.invoice_number_counters enable row level security;
-- Kein Client-Zugriff nötig - nur über die SECURITY-INVOKER-Funktion oben,
-- die selbst als der aufrufende Arbeitgeber läuft. Admin kann über das
-- Dashboard/service_role weiterhin draufsehen.
create policy "Zaehler nur Admin" on public.invoice_number_counters
  for all using (is_admin()) with check (is_admin());

alter table public.invoices enable row level security;

create policy "Arbeitgeber sieht eigene Rechnungen" on public.invoices
  for select using (arbeitgeber_id = auth.uid() or is_admin());

create policy "Arbeitgeber legt eigene Rechnung an" on public.invoices
  for insert with check (arbeitgeber_id = auth.uid());

-- Nur Admin darf Zahlungsstatus/Stornierung ändern (siehe Anforderung:
-- "bezahlt"-Markierung ausschließlich über den Admin-Bereich).
create policy "Nur Admin aktualisiert Rechnungen" on public.invoices
  for update using (is_admin()) with check (is_admin());

-- Bewusst KEINE delete-Policy: Rechnungen werden nie gelöscht, nur auf
-- payment_status = 'storniert' gesetzt (siehe Anforderung).

-- Zentral konfigurierbarer Platzhalter für die ODOJ-UID-Nummer, analog zu
-- den bereits bestehenden odoj_iban/odoj_kontoinhaber-Einträgen.
insert into public.einstellungen (schluessel, wert_text, beschreibung)
values ('odoj_uid_nummer', '[UID-Nummer folgt]', 'UID-Nummer von ODOJ fuer Rechnungen - MUSS vor Live-Versand ersetzt werden')
on conflict (schluessel) do nothing;
