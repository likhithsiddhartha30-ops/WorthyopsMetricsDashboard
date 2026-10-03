-- =============================================================================
-- WorthyOps · 02 · Business data (Supabase / PostgreSQL)
-- Run after 01_auth.sql. Tables: content, leads, daily_activity, settings,
-- plus personal targets on profiles and a team leaderboard function.
--
-- Access rules (row-level security):
--   Admins      → everything.
--   Team members → their own leads + daily activity; can read the content
--                  library, settings and team names (for the leaderboard).
--   AI tools / scripts → use the service_role key on a server (bypasses RLS).
--                  Never put the service_role key in browser code.
-- =============================================================================

-- ---------- Time zone: "today" (stage dates, follow-ups) uses India time ----------
-- Takes effect for new connections. Change if your team is elsewhere.
alter database postgres set timezone to 'Asia/Kolkata';

-- ---------- Types (keys match the dashboard) ----------
create type public.lead_stage   as enum ('new', 'contacted', 'replied', 'booked', 'attended', 'won', 'paid', 'lost');
create type public.lead_origin  as enum ('outbound', 'organic', 'paid');
create type public.content_channel as enum ('organic', 'paid');

-- ---------- Helpers ----------
create or replace function public.is_active_user()
returns boolean
language sql stable
security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active);
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- Personal monthly targets (blank = equal share of team target) ----------
alter table public.profiles
  add column target_outreach      integer        check (target_outreach >= 0),
  add column target_calls_booked  integer        check (target_calls_booked >= 0),
  add column target_deals_closed  integer        check (target_deals_closed >= 0),
  add column target_revenue       numeric(12, 2) check (target_revenue >= 0);

-- Team members can see the team list (names for leaderboard / owner labels)
create policy "Active users can read the team list"
  on public.profiles for select
  using (public.is_active_user());

-- =============================================================================
-- Content library (posts, videos, ads)
-- =============================================================================
create table public.content (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (length(title) between 1 and 160),
  channel       public.content_channel not null default 'organic',
  platform      text not null default '',
  format        text not null default '',
  url           text not null default '' check (url = '' or url ~* '^https?://'),
  published_at  date not null default current_date,
  views         integer not null default 0 check (views >= 0),
  ad_spend      numeric(12, 2) not null default 0 check (ad_spend >= 0),
  notes         text not null default '',
  created_by    uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index content_channel_idx   on public.content (channel);
create index content_published_idx on public.content (published_at);

create trigger content_updated_at
  before update on public.content
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Leads (the client / prospect list)
-- =============================================================================
create table public.leads (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (length(name) between 1 and 120),
  business           text not null default '',
  handle             text not null default '',   -- @handle or profile link
  email              text not null default '',
  phone              text not null default '',
  origin             public.lead_origin not null default 'outbound',
  content_id         uuid references public.content (id) on delete set null,
  source             text not null default '',   -- platform: Instagram, LinkedIn, ...
  niche              text not null default '',
  owner_id           uuid references public.profiles (id) on delete set null,
  stage              public.lead_stage not null default 'new',
  message            text not null default '',   -- outreach message (e.g. AI-written DM)
  follow_ups         integer not null default 0 check (follow_ups >= 0),
  last_contact_at    date,
  next_follow_up_at  date,
  deal_value         numeric(12, 2) not null default 0 check (deal_value >= 0),
  amount_paid        numeric(12, 2) not null default 0 check (amount_paid >= 0),
  notes              text not null default '',
  stage_dates        jsonb not null default '{}'::jsonb,  -- {"contacted": "2026-10-04", ...}
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index leads_owner_idx     on public.leads (owner_id);
create index leads_stage_idx     on public.leads (stage);
create index leads_origin_idx    on public.leads (origin);
create index leads_content_idx   on public.leads (content_id);
create index leads_followup_idx  on public.leads (next_follow_up_at) where stage in ('contacted', 'replied', 'booked', 'attended');
create index leads_created_idx   on public.leads (created_at);

-- Keep lead data consistent: linked content decides the origin; record the
-- first date each stage was reached; moving past "new" counts as contact.
create or replace function public.leads_before_write()
returns trigger
language plpgsql
as $$
declare
  ch public.content_channel;
begin
  if new.content_id is not null then
    select channel into ch from public.content where id = new.content_id;
    if ch is not null then
      new.origin := ch::text::public.lead_origin;
    end if;
  end if;

  if not (new.stage_dates ? new.stage::text) then
    new.stage_dates := new.stage_dates || jsonb_build_object(new.stage::text, current_date);
  end if;

  if new.stage <> 'new' and new.last_contact_at is null then
    new.last_contact_at := current_date;
  end if;

  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger leads_before_write
  before insert or update on public.leads
  for each row execute function public.leads_before_write();

-- When content switches organic ↔ paid, its linked leads follow
create or replace function public.content_sync_lead_origin()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.channel is distinct from old.channel then
    update public.leads set origin = new.channel::text::public.lead_origin where content_id = new.id;
  end if;
  return new;
end;
$$;

create trigger content_sync_lead_origin
  after update of channel on public.content
  for each row execute function public.content_sync_lead_origin();

-- =============================================================================
-- Daily activity (one row per team member per day)
-- =============================================================================
create table public.daily_activity (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  date            date not null,
  outreach        integer not null default 0 check (outreach >= 0),
  follow_ups      integer not null default 0 check (follow_ups >= 0),
  replies         integer not null default 0 check (replies >= 0),
  calls_booked    integer not null default 0 check (calls_booked >= 0),
  calls_shown     integer not null default 0 check (calls_shown >= 0),
  deals_closed    integer not null default 0 check (deals_closed >= 0),
  paid            integer not null default 0 check (paid >= 0),
  revenue         numeric(12, 2) not null default 0 check (revenue >= 0),
  cash_collected  numeric(12, 2) not null default 0 check (cash_collected >= 0),
  notes           text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, date)
);

create index daily_activity_date_idx on public.daily_activity (date);

create trigger daily_activity_updated_at
  before update on public.daily_activity
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Settings (single row) - currency, team targets, leaderboard visibility
-- =============================================================================
create table public.settings (
  id                         smallint primary key default 1 check (id = 1),
  currency                   text not null default 'USD',
  locale                     text not null default 'en-US',
  show_leaderboard_to_team   boolean not null default true,
  target_outreach            integer not null default 7000,
  target_calls_booked        integer not null default 200,
  target_deals_closed        integer not null default 45,
  target_revenue             numeric(12, 2) not null default 80000,
  updated_at                 timestamptz not null default now()
);

insert into public.settings (id) values (1);

create trigger settings_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Row-level security
-- =============================================================================
alter table public.content        enable row level security;
alter table public.leads          enable row level security;
alter table public.daily_activity enable row level security;
alter table public.settings       enable row level security;

-- Content: everyone on the team can read (needed for the lead form); admins manage
create policy "Active users can read content"
  on public.content for select using (public.is_active_user());
create policy "Admins can manage content"
  on public.content for all using (public.is_admin()) with check (public.is_admin());

-- Leads: admins see all; members see and manage only leads they own
create policy "Admins can manage all leads"
  on public.leads for all using (public.is_admin()) with check (public.is_admin());
create policy "Members can read their leads"
  on public.leads for select using (owner_id = auth.uid() and public.is_active_user());
create policy "Members can add their own leads"
  on public.leads for insert with check (owner_id = auth.uid() and public.is_active_user());
create policy "Members can update their leads"
  on public.leads for update
  using (owner_id = auth.uid() and public.is_active_user())
  with check (owner_id = auth.uid());
create policy "Members can delete their leads"
  on public.leads for delete using (owner_id = auth.uid() and public.is_active_user());

-- Daily activity: admins see all; members only their own rows
create policy "Admins can manage all activity"
  on public.daily_activity for all using (public.is_admin()) with check (public.is_admin());
create policy "Members can manage their activity"
  on public.daily_activity for all
  using (user_id = auth.uid() and public.is_active_user())
  with check (user_id = auth.uid() and public.is_active_user());

-- Settings: everyone reads, admins update
create policy "Active users can read settings"
  on public.settings for select using (public.is_active_user());
create policy "Admins can update settings"
  on public.settings for update using (public.is_admin()) with check (public.is_admin());

-- =============================================================================
-- Team leaderboard: per-member totals for a date range. Team members can't
-- read each other's leads, so this function returns only the aggregates.
-- Usage: select * from public.team_leaderboard('2026-09-01', '2026-09-30');
-- =============================================================================
create or replace function public.team_leaderboard(p_from date, p_to date)
returns table (
  user_id       uuid,
  full_name     text,
  outreach      bigint,
  replies       bigint,
  calls_booked  bigint,
  deals_closed  bigint,
  revenue       numeric
)
language sql stable
security definer set search_path = public
as $$
  select p.id, p.full_name,
         coalesce(sum(d.outreach), 0),
         coalesce(sum(d.replies), 0),
         coalesce(sum(d.calls_booked), 0),
         coalesce(sum(d.deals_closed), 0),
         coalesce(sum(d.revenue), 0)
  from public.profiles p
  left join public.daily_activity d
    on d.user_id = p.id and d.date between p_from and p_to
  where p.role = 'member' and p.active
    and public.is_active_user()
    and (public.is_admin() or (select show_leaderboard_to_team from public.settings where id = 1))
  group by p.id, p.full_name
  order by 7 desc, 3 desc;
$$;
