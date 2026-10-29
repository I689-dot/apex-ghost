-- APEX GHOST accounts, friends and records (Supabase Postgres). Applied by `node apps/server/db/migrate.mjs`;
-- every statement is idempotent. A schema of its own, so Supabase's REST API (which serves `public`) never exposes it.
create schema if not exists apex;
create extension if not exists pgcrypto;

-- a nickname and a password, nothing else (no e-mail, no verification); passwords are bcrypt hashes made by
-- pgcrypto in the database
create table if not exists apex.users (
  id uuid primary key default gen_random_uuid(),
  nick text not null,
  nick_key text not null unique,
  pass_hash text not null,
  created_at timestamptz not null default now(),
  last_seen timestamptz
);

-- sign-in tokens (one per device), kept until signing out
create table if not exists apex.tokens (
  token text primary key,
  user_id uuid not null references apex.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists tokens_user on apex.tokens (user_id);

-- a friend request is a row from the asker to the asked (pending); accepted: both directions exist
create table if not exists apex.friends (
  user_id uuid not null references apex.users (id) on delete cascade,
  friend_id uuid not null references apex.users (id) on delete cascade,
  status text not null check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);
create index if not exists friends_friend on apex.friends (friend_id);

-- every valid timed lap the game server measured (server-authoritative: the lap logic runs on the server)
create table if not exists apex.laps (
  id bigint generated always as identity primary key,
  user_id uuid not null references apex.users (id) on delete cascade,
  track_id text not null,
  car_id text not null,
  lap_ms integer not null check (lap_ms > 0),
  sectors integer[] not null default '{}',
  session text not null,
  wet boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists laps_track_time on apex.laps (track_id, lap_ms);
create index if not exists laps_user_track on apex.laps (user_id, track_id, lap_ms);

-- each finished session: where you finished among how many
create table if not exists apex.results (
  id bigint generated always as identity primary key,
  user_id uuid not null references apex.users (id) on delete cascade,
  track_id text not null,
  car_id text not null,
  session text not null,
  position integer not null,
  entrants integer not null,
  best_lap_ms integer,
  total_ms integer,
  created_at timestamptz not null default now()
);
create index if not exists results_user on apex.results (user_id, created_at desc);
