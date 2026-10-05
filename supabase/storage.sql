-- Circla media storage bucket
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do update set public = true;

create policy "media is publicly readable"
on storage.objects for select
using (bucket_id = 'media');

create policy "users can upload their own media"
on storage.objects for insert
to authenticated
with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "users can delete their own media"
on storage.objects for delete
to authenticated
using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);