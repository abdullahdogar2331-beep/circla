-- Circla database foundation
-- Run this in Supabase SQL Editor when the Circla project is connected.

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text not null,
  bio text default '',
  avatar_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  caption text default '',
  media_url text not null,
  media_type text not null default 'image' check (media_type in ('image','video')),
  created_at timestamptz not null default now()
);

create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  media_url text not null,
  media_type text not null default 'image' check (media_type in ('image','video')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

create table if not exists public.story_views (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.stories(id) on delete cascade,
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  viewed_at timestamptz not null default now()
);

create index if not exists story_views_story_id_idx on public.story_views(story_id);
create index if not exists story_views_viewer_id_idx on public.story_views(viewer_id);

create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

create table if not exists public.post_likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  type text not null,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (conversation_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);

-- Exact viewer analytics:
-- total_views = count(*) for a story
-- unique_viewers = count(distinct viewer_id)
-- repeat views remain available because each viewing event is stored.
create or replace view public.story_analytics as
select
  s.id as story_id,
  count(sv.id)::bigint as total_views,
  count(distinct sv.viewer_id)::bigint as unique_viewers
from public.stories s
left join public.story_views sv on sv.story_id = s.id
group by s.id;

-- Auto-create a basic profile after signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'username',''), 'user_' || substr(new.id::text, 1, 8)),
    coalesce(nullif(new.raw_user_meta_data->>'display_name',''), 'New Circla User')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Row Level Security
alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.stories enable row level security;
alter table public.story_views enable row level security;
alter table public.follows enable row level security;
alter table public.post_likes enable row level security;
alter table public.comments enable row level security;
alter table public.notifications enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

create policy "profiles are viewable" on public.profiles
for select using (true);

create policy "users update own profile" on public.profiles
for update using (auth.uid() = id);

create policy "posts are viewable" on public.posts
for select using (true);

create policy "users create own posts" on public.posts
for insert with check (auth.uid() = user_id);

create policy "users update own posts" on public.posts
for update using (auth.uid() = user_id);

create policy "users delete own posts" on public.posts
for delete using (auth.uid() = user_id);

create policy "stories are viewable" on public.stories
for select using (expires_at > now());

create policy "users create own stories" on public.stories
for insert with check (auth.uid() = user_id);

create policy "users delete own stories" on public.stories
for delete using (auth.uid() = user_id);

create policy "viewers can record story views" on public.story_views
for insert with check (auth.uid() = viewer_id);

create policy "story owners can read views" on public.story_views
for select using (
  exists (
    select 1 from public.stories s
    where s.id = story_id and s.user_id = auth.uid()
  )
);

create policy "follows are viewable" on public.follows
for select using (true);

create policy "users follow as themselves" on public.follows
for insert with check (auth.uid() = follower_id);

create policy "users unfollow as themselves" on public.follows
for delete using (auth.uid() = follower_id);

create policy "likes are viewable" on public.post_likes
for select using (true);

create policy "users like as themselves" on public.post_likes
for insert with check (auth.uid() = user_id);

create policy "users unlike as themselves" on public.post_likes
for delete using (auth.uid() = user_id);

create policy "comments are viewable" on public.comments
for select using (true);

create policy "users create own comments" on public.comments
for insert with check (auth.uid() = user_id);

create policy "users delete own comments" on public.comments
for delete using (auth.uid() = user_id);

create policy "users read own notifications" on public.notifications
for select using (auth.uid() = user_id);

create policy "members can read conversations" on public.conversation_members
for select using (auth.uid() = user_id);

create policy "members can read messages" on public.messages
for select using (
  exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = conversation_id and cm.user_id = auth.uid()
  )
);

create policy "members can send messages" on public.messages
for insert with check (
  auth.uid() = sender_id
  and exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = conversation_id and cm.user_id = auth.uid()
  )
);


-- Circla production hardening / feature completion
-- Safe to run after the base schema above.

-- Story owners must be able to see their own expired stories for analytics.
drop policy if exists "stories are viewable" on public.stories;
create policy "stories are viewable" on public.stories
for select using (expires_at > now() or auth.uid() = user_id);

-- Notifications are generated by trusted database triggers.
drop policy if exists "users update own notifications" on public.notifications;
create policy "users update own notifications" on public.notifications
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.create_notification(
  p_user_id uuid,
  p_actor_id uuid,
  p_type text,
  p_entity_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_actor_id is null or p_user_id = p_actor_id then
    return;
  end if;
  insert into public.notifications(user_id, actor_id, type, entity_id)
  values (p_user_id, p_actor_id, p_type, p_entity_id);
end;
$$;

create or replace function public.notify_post_like()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare owner_id uuid;
begin
  select p.user_id into owner_id from public.posts p where p.id = new.post_id;
  perform public.create_notification(owner_id, new.user_id, 'like', new.post_id);
  return new;
end;
$$;

drop trigger if exists post_like_notification on public.post_likes;
create trigger post_like_notification
after insert on public.post_likes
for each row execute function public.notify_post_like();

create or replace function public.notify_post_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare owner_id uuid;
begin
  select p.user_id into owner_id from public.posts p where p.id = new.post_id;
  perform public.create_notification(owner_id, new.user_id, 'comment', new.post_id);
  return new;
end;
$$;

drop trigger if exists post_comment_notification on public.comments;
create trigger post_comment_notification
after insert on public.comments
for each row execute function public.notify_post_comment();

create or replace function public.notify_new_follow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.create_notification(new.following_id, new.follower_id, 'follow', new.following_id);
  return new;
end;
$$;

drop trigger if exists follow_notification on public.follows;
create trigger follow_notification
after insert on public.follows
for each row execute function public.notify_new_follow();

-- Conversation access helper avoids recursive RLS when a member reads the
-- other member or when the second member is added to a new conversation.
create schema if not exists private;

create or replace function private.is_conversation_member(p_conversation_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = p_conversation_id
      and cm.user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_conversation_member(uuid) from public;
grant execute on function private.is_conversation_member(uuid) to authenticated;

drop policy if exists "members can read conversations" on public.conversations;
create policy "members can read conversations" on public.conversations
for select to authenticated
using ((select private.is_conversation_member(id)));

drop policy if exists "authenticated users create conversations" on public.conversations;
create policy "authenticated users create conversations" on public.conversations
for insert to authenticated
with check ((select auth.uid()) is not null);

drop policy if exists "members can read conversation members" on public.conversation_members;
create policy "members can read conversation members" on public.conversation_members
for select to authenticated
using ((select private.is_conversation_member(conversation_id)));

drop policy if exists "members can add conversation members" on public.conversation_members;
create policy "members can add conversation members" on public.conversation_members
for insert to authenticated
with check (
  (select auth.uid()) = user_id
  or (select private.is_conversation_member(conversation_id))
);

drop policy if exists "members can read messages" on public.messages;
create policy "members can read messages" on public.messages
for select to authenticated
using ((select private.is_conversation_member(conversation_id)));

drop policy if exists "members can send messages" on public.messages;
create policy "members can send messages" on public.messages
for insert to authenticated
with check (
  (select auth.uid()) = sender_id
  and (select private.is_conversation_member(conversation_id))
);

-- Let the existing Postgres Changes subscription receive live chat and
-- notification updates. This is idempotent.
do $$
begin
  begin
    alter publication supabase_realtime add table public.messages;
  exception when duplicate_object then
    null;
  end;
  begin
    alter publication supabase_realtime add table public.notifications;
  exception when duplicate_object then
    null;
  end;
end $$;
