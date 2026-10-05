-- Circla media storage setup
-- Run once in Supabase SQL Editor after schema.sql.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 52428800, array['image/*','video/*'])
on conflict (id) do update set public=true, file_size_limit=52428800, allowed_mime_types=array['image/*','video/*'];

drop policy if exists "Circla public media read" on storage.objects;
create policy "Circla public media read"
on storage.objects for select
using (bucket_id = 'media');

drop policy if exists "Circla users upload media" on storage.objects;
create policy "Circla users upload media"
on storage.objects for insert to authenticated
with check (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid()::text));

drop policy if exists "Circla users update own media" on storage.objects;
create policy "Circla users update own media"
on storage.objects for update to authenticated
using (bucket_id = 'media' and owner_id = (select auth.uid()::text))
with check (bucket_id = 'media' and owner_id = (select auth.uid()::text));

drop policy if exists "Circla users delete own media" on storage.objects;
create policy "Circla users delete own media"
on storage.objects for delete to authenticated
using (bucket_id = 'media' and owner_id = (select auth.uid()::text));
