-- Speichert, über welchen trackbaren Registrierungslink (?ref=...) sich ein
-- Nutzer angemeldet hat. NULL = normale Registrierung ohne speziellen Link.
alter table public."Profile"
  add column if not exists ref_code text;
