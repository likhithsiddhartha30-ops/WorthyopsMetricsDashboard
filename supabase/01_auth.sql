-- =============================================================================
-- WorthyOps · 01 · Users & authentication (Supabase / PostgreSQL)
-- Run first, in Supabase → SQL Editor. Passwords live in Supabase Auth
-- (auth.users); this adds roles, active flag and access rules.
-- =============================================================================

create type public.user_role as enum ('admin', 'member');

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null unique,
  full_name   text not null default '',
  role        public.user_role not null default 'member',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  last_login  timestamptz
);

-- Create a profile automatically when a user signs up / is invited
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Is the logged-in user an active admin?
create or replace function public.is_admin()
returns boolean
language sql stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and active
  );
$$;

alter table public.profiles enable row level security;

create policy "Users can read their own profile"
  on public.profiles for select
  using (id = auth.uid());

create policy "Admins can read all profiles"
  on public.profiles for select
  using (public.is_admin());

create policy "Admins can update profiles"
  on public.profiles for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins can delete profiles"
  on public.profiles for delete
  using (public.is_admin());

-- After creating your own login (Authentication → Users → Add user):
-- update public.profiles set role = 'admin' where email = 'your-email@example.com';
