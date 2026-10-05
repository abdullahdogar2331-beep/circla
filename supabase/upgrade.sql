-- Circla production feature upgrade
-- Run this ONCE in Supabase SQL Editor after schema.sql.

-- Helpful indexes
create index if not exists profiles_username_lower_idx on public.profiles (lower(username));
create index if not exists posts_created_at_idx on public.posts (created_at desc);
create index if not exists follows_following_idx on public.follows (following_id);
create index if not exists follows_follower_idx on public.follows (follower_id);
create index if not exists post_likes_post_idx on public.post_likes (post_id);
create index if not exists comments_post_idx on public.comments (post_id, created_at desc);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists messages_conversation_idx on public.messages (conversation_id, created_at asc);

-- Conversations need writable membership/conversation policies.
drop policy if exists "users create conversations" on public.conversations;
create policy "users create conversations" on public.conversations
for insert with check (auth.uid() is not null);

drop policy if exists "members read conversations" on public.conversations;
create policy "members read conversations" on public.conversations
for select using (
  exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = id and cm.user_id = auth.uid()
  )
);

drop policy if exists "users add conversation members" on public.conversation_members;
create policy "users add conversation members" on public.conversation_members
for insert with check (
  auth.uid() = user_id
  or exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = conversation_id and cm.user_id = auth.uid()
  )
);

-- Allow users to read their own notification records and mark them read.
drop policy if exists "users update own notifications" on public.notifications;
create policy "users update own notifications" on public.notifications
for update using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Profile edits.
drop policy if exists "users insert own profile" on public.profiles;
create policy "users insert own profile" on public.profiles
for insert with check (auth.uid() = id);

-- Make repeat story-view events explicit and fast.
create index if not exists story_views_story_viewer_idx
on public.story_views(story_id, viewer_id, viewed_at desc);

-- Notifications generated safely by database triggers.
create or replace function public.notify_follow()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.notifications(user_id, actor_id, type, entity_id)
  values(new.following_id, new.follower_id, 'follow', new.follower_id);
  return new;
end; $$;

create or replace function public.notify_like()
returns trigger language plpgsql security definer set search_path=public as $$
declare owner_id uuid;
begin
  select user_id into owner_id from public.posts where id=new.post_id;
  if owner_id is not null and owner_id <> new.user_id then
    insert into public.notifications(user_id, actor_id, type, entity_id)
    values(owner_id, new.user_id, 'like', new.post_id);
  end if;
  return new;
end; $$;

create or replace function public.notify_comment()
returns trigger language plpgsql security definer set search_path=public as $$
declare owner_id uuid;
begin
  select user_id into owner_id from public.posts where id=new.post_id;
  if owner_id is not null and owner_id <> new.user_id then
    insert into public.notifications(user_id, actor_id, type, entity_id)
    values(owner_id, new.user_id, 'comment', new.post_id);
  end if;
  return new;
end; $$;

drop trigger if exists on_follow_notify on public.follows;
create trigger on_follow_notify after insert on public.follows
for each row execute procedure public.notify_follow();

drop trigger if exists on_like_notify on public.post_likes;
create trigger on_like_notify after insert on public.post_likes
for each row execute procedure public.notify_like();

drop trigger if exists on_comment_notify on public.comments;
create trigger on_comment_notify after insert on public.comments
for each row execute procedure public.notify_comment();

-- Realtime for chat + notifications.
do $$
begin
  begin
    alter publication supabase_realtime add table public.messages;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.notifications;
  exception when duplicate_object then null;
  end;
end $$;
