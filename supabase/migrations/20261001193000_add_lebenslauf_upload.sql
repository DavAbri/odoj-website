-- Optionales Dokument (Lebenslauf, Zeugnis, o.ä.) im Jobber-Profil
ALTER TABLE "public"."Profile" ADD COLUMN IF NOT EXISTS "lebenslauf_pfad" text;
ALTER TABLE "public"."Profile" ADD COLUMN IF NOT EXISTS "lebenslauf_dateiname" text;

-- Privater Storage-Bucket für diese Dokumente (nicht öffentlich einsehbar)
INSERT INTO storage.buckets (id, name, public)
VALUES ('lebenslaeufe', 'lebenslaeufe', false)
ON CONFLICT (id) DO NOTHING;

-- Jobber darf eigene Datei hochladen (Pfad muss mit der eigenen user_id beginnen)
CREATE POLICY "Lebenslauf eigene Datei hochladen"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'lebenslaeufe' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Jobber darf eigene Datei ersetzen (upsert)
CREATE POLICY "Lebenslauf eigene Datei ersetzen"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'lebenslaeufe' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Jobber darf eigene Datei löschen
CREATE POLICY "Lebenslauf eigene Datei loeschen"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'lebenslaeufe' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Lesen: der Jobber selbst, oder ein Arbeitgeber bei dem sich dieser Jobber beworben hat
CREATE POLICY "Lebenslauf lesen Besitzer oder Arbeitgeber"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'lebenslaeufe'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM public.bewerbungen b
      JOIN public.jobs j ON j.id = b.job_id
      WHERE b.jobber_id = ((storage.foldername(name))[1])::uuid
        AND j.arbeitgeber_id = auth.uid()
    )
  )
);
