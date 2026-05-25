-- Create private Supabase Storage bucket for WhatsApp media (audio, image, video).
-- The proxy route serves files via the service_role admin client (bypasses RLS),
-- so no storage policies are needed. The bucket is intentionally NOT public.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('media', 'media', false, 52428800 /* 50 MB */)
ON CONFLICT (id) DO NOTHING;
