-- Speichert Zeitpunkt der Zustimmung zur Datenschutzerklärung (Registrierung),
-- damit im Streitfall nachweisbar ist, dass und wann zugestimmt wurde.
alter table public."Profile"
  add column if not exists datenschutz_akzeptiert_am timestamptz;
