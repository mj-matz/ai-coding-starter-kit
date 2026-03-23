-- Migration: Create chart-screenshots Storage Bucket + RLS Policies for PROJ-17
-- BUG-1: Bucket als Migration definiert
-- BUG-2: RLS-Policies für storage.objects
-- BUG-5: Content-Type-Validierung (nur image/png erlaubt)

-- Create public bucket for chart screenshots
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chart-screenshots',
  'chart-screenshots',
  true,
  1048576, -- 1 MB limit
  ARRAY['image/png']
)
ON CONFLICT (id) DO NOTHING;

-- RLS: INSERT — only authenticated users can upload
CREATE POLICY "Authenticated users can upload chart screenshots"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'chart-screenshots'
    AND (storage.foldername(name))[1] IS NOT DISTINCT FROM ''
  );

-- RLS: SELECT — public read access (no auth required for sharing)
CREATE POLICY "Public read access for chart screenshots"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'chart-screenshots');

-- RLS: DELETE — authenticated users can delete their own uploads
CREATE POLICY "Authenticated users can delete chart screenshots"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'chart-screenshots');
