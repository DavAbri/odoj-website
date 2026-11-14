-- SICHERHEIT Schritt 3 (14.11.2026): weitere Lücken schließen.
-- Es werden NUR Zugriffsregeln/Prüfungen geändert, keine Nutzerdaten.
-- Sicherung des vorherigen Stands: 05_backup_vorher.sql
--
-- 1) Chat: Nachrichten nur noch innerhalb einer echten Bewerbung (oder an
--    Personen mit gemeinsamer Bewerbung). Als "andere Person" darf man nur
--    sich selbst eine Systemnachricht schreiben (so nutzt es die Webseite).
--    Bisher konnte jeder Angemeldete jedem Nutzer schreiben -> Mail-Spam.
-- 2) Chat: Beim Ändern einer Nachricht darf nur noch "gelesen" (und die
--    interne Chat-Zuordnung) geändert werden - nicht mehr der Text.
-- 3) Bewertungen: nur nach einem gemeinsamen Einsatz, nur 1-5 Sterne, nur
--    einmal pro Einsatz, Rolle wird automatisch richtig gesetzt.
-- 4) Rechnungen: nur noch die Plattform bzw. Admins legen Rechnungen und
--    Rechnungspositionen an. Alte Tabelle "rechnungen" (leer): nur Admins.
-- 5) Inserate: nur Konten mit der Rolle Arbeitgeber dürfen Inserate anlegen.
-- 6) Admin-Liste: gelöschtes Konto mail4david85@gmail.com entfernt.

begin;

-- 1) Chat: Nachrichten anlegen
drop policy if exists nachrichten_insert on public.nachrichten;
create policy nachrichten_insert on public.nachrichten
  for insert to authenticated
  with check (
    public.is_admin()
    or (
      bewerbung_id is not null
      and sender_id <> empfaenger_id
      and (sender_id = (select auth.uid()) or empfaenger_id = (select auth.uid()))
      and exists (
        select 1 from public.bewerbungen b
        where b.id = nachrichten.bewerbung_id
          and nachrichten.sender_id in (b.jobber_id, b.arbeitgeber_id)
          and nachrichten.empfaenger_id in (b.jobber_id, b.arbeitgeber_id)
      )
    )
    or (
      bewerbung_id is null
      and sender_id = (select auth.uid())
      and exists (
        select 1 from public.bewerbungen b
        where (b.jobber_id = nachrichten.empfaenger_id and b.arbeitgeber_id = nachrichten.sender_id)
           or (b.arbeitgeber_id = nachrichten.empfaenger_id and b.jobber_id = nachrichten.sender_id)
      )
    )
  );

-- 2) Chat: nur "gelesen" änderbar
create or replace function public.schuetze_nachricht()
returns trigger
language plpgsql
as $$
begin
  if public.odoj_darf_vergangenes_aendern() then
    return new;
  end if;
  if (to_jsonb(new) - array['gelesen', 'chat_id']) is distinct from (to_jsonb(old) - array['gelesen', 'chat_id']) then
    raise exception 'Nachrichten können nachträglich nicht geändert werden.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_schuetze_nachricht on public.nachrichten;
create trigger trg_schuetze_nachricht
  before update on public.nachrichten
  for each row execute function public.schuetze_nachricht();

-- 3) Bewertungen
create or replace function public.pruefe_bewertung()
returns trigger
language plpgsql
as $$
declare
  v_ag uuid;
begin
  if public.odoj_darf_vergangenes_aendern() then
    return new;
  end if;
  if new.sterne is null or new.sterne < 1 or new.sterne > 5 then
    raise exception 'Bitte 1 bis 5 Sterne vergeben.';
  end if;
  select b.arbeitgeber_id into v_ag
  from public.bewerbungen b
  where b.job_id = new.job_id
    and ((b.jobber_id = new.bewerter_id and b.arbeitgeber_id = new.bewertet_id)
      or (b.arbeitgeber_id = new.bewerter_id and b.jobber_id = new.bewertet_id))
    and (b.status in ('angenommen', 'abgeschlossen') or b.anwesenheit_bestaetigt is true)
  limit 1;
  if v_ag is null then
    raise exception 'Bewerten ist nur nach einem gemeinsamen Einsatz möglich.';
  end if;
  if exists (select 1 from public.bewertungen x
             where x.job_id = new.job_id and x.bewerter_id = new.bewerter_id and x.bewertet_id = new.bewertet_id) then
    raise exception 'Für diesen Einsatz wurde bereits bewertet.';
  end if;
  new.rolle_bewerter := case when v_ag = new.bewerter_id then 'arbeitgeber' else 'jobber' end;
  return new;
end;
$$;
drop trigger if exists trg_pruefe_bewertung on public.bewertungen;
create trigger trg_pruefe_bewertung
  before insert on public.bewertungen
  for each row execute function public.pruefe_bewertung();

-- 4) Rechnungen
drop policy if exists "Arbeitgeber legt eigene Rechnung an" on public.invoices;
create policy "Nur Admin legt Rechnung an" on public.invoices
  for insert to authenticated with check (public.is_admin());
drop policy if exists "Arbeitgeber legt eigene Rechnungspositionen an" on public.invoice_items;
create policy "Nur Admin legt Rechnungspositionen an" on public.invoice_items
  for insert to authenticated with check (public.is_admin());
drop policy if exists rechnungen_insert on public.rechnungen;
drop policy if exists rechnungen_update on public.rechnungen;
drop policy if exists rechnungen_delete on public.rechnungen;
create policy rechnungen_admin_schreiben on public.rechnungen
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 5) Inserate nur von Arbeitgebern
create or replace function public.pruefe_inserat_ersteller()
returns trigger
language plpgsql
as $$
begin
  if public.odoj_darf_vergangenes_aendern() then
    return new;
  end if;
  if new.arbeitgeber_id is distinct from auth.uid()
     or not exists (select 1 from public."Profile" p where p.user_id = auth.uid() and p.rolle = 'arbeitgeber') then
    raise exception 'Nur Arbeitgeber-Konten können Inserate anlegen.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_pruefe_inserat_ersteller on public.jobs;
create trigger trg_pruefe_inserat_ersteller
  before insert on public.jobs
  for each row execute function public.pruefe_inserat_ersteller();

-- 6) Admin-Liste ohne das gelöschte Konto
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.is_admin()'::regprocedure);
  if position('mail4david85@gmail.com' in v_def) > 0 then
    execute replace(replace(v_def, '''mail4david85@gmail.com'', ', ''), ', ''mail4david85@gmail.com''', '');
  end if;
end $$;

commit;

-- Kontrolle: darf "mail4david85" nicht mehr enthalten
select position('mail4david85' in pg_get_functiondef('public.is_admin()'::regprocedure)) = 0 as admin_liste_ok;
