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

-- Phase 3b: logo re-upload replaces the file, so owners also need update +
-- delete on their own folder (see migration 0014).
create policy "own business media update"
  on storage.objects for update
  using (bucket_id = 'business-media' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "own business media delete"
  on storage.objects for delete
  using (bucket_id = 'business-media' and auth.uid()::text = (storage.foldername(name))[1]);

-- matrimony-photos: private bucket, owner-only upload
create policy "own matrimony photo upload"
  on storage.objects for insert
  with check (bucket_id = 'matrimony-photos' and auth.uid()::text = (storage.foldername(name))[1]);

-- Phase 6a (0023): the owner (their own preview) and admins (verification)
-- read through signed URLs; owners delete a photo they remove. (0024) Mutual
-- matches read each other's too -- matrimony_photo_visible() in core_schema.
create policy "matrimony photo read"
  on storage.objects for select
  using (bucket_id = 'matrimony-photos'
         and (auth.uid()::text = (storage.foldername(name))[1]
              or public.is_admin()
              or public.matrimony_photo_visible((storage.foldername(name))[1])));

create policy "own matrimony photo delete"
  on storage.objects for delete
  using (bucket_id = 'matrimony-photos' and auth.uid()::text = (storage.foldername(name))[1]);

-- kyc-documents: owner-only upload, NO read policy at all
-- (only accessible via secret key from server-side/admin code, never the client)
create policy "own kyc document upload"
  on storage.objects for insert
  with check (bucket_id = 'kyc-documents' and auth.uid()::text = (storage.foldername(name))[1]);