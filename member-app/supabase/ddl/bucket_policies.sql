-- ============================================================
-- Storage bucket policies — all 4 buckets, run once
-- Assumes upload path convention: {user_id}/filename.ext
-- ============================================================

-- profile-photos: public read, owner-only upload
create policy "own profile photo upload"
  on storage.objects for insert
  with check (bucket_id = 'profile-photos' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "public profile photo read"
  on storage.objects for select
  using (bucket_id = 'profile-photos');

-- Phase 3a: re-uploading a photo replaces the file, so owners also need
-- update + delete on their own folder (see migration 0010).
create policy "own profile photo update"
  on storage.objects for update
  using (bucket_id = 'profile-photos' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "own profile photo delete"
  on storage.objects for delete
  using (bucket_id = 'profile-photos' and auth.uid()::text = (storage.foldername(name))[1]);

-- business-media: public read, owner-only upload
create policy "own business media upload"
  on storage.objects for insert
  with check (bucket_id = 'business-media' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "public business media read"
  on storage.objects for select
  using (bucket_id = 'business-media');

-- matrimony-photos: owner-only upload, NO general read policy yet
-- (read access depends on mutual accept in matrimony_interests —
-- write that policy when the matrimony feature is built, Phase 6)
create policy "own matrimony photo upload"
  on storage.objects for insert
  with check (bucket_id = 'matrimony-photos' and auth.uid()::text = (storage.foldername(name))[1]);

-- kyc-documents: owner-only upload, NO read policy at all
-- (only accessible via secret key from server-side/admin code, never the client)
create policy "own kyc document upload"
  on storage.objects for insert
  with check (bucket_id = 'kyc-documents' and auth.uid()::text = (storage.foldername(name))[1]);