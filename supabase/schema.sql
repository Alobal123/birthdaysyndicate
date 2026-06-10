-- Core schema for The Great Birthday Syndicate

create extension if not exists pgcrypto;

create table if not exists players (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    score int not null default 0,
    inventory text[] not null default '{}',
    created_at timestamptz not null default now()
);

create unique index if not exists idx_players_name_unique_ci on players (lower(name));

create table if not exists encounters (
    id uuid primary key default gen_random_uuid(),
    p1_id uuid not null references players(id) on delete cascade,
    p2_id uuid references players(id) on delete cascade,
    p1_choice text,
    p2_choice text,
    p1_item text,
    p2_item text,
    status text not null default 'PENDING',
    created_at timestamptz not null default now(),
    completed_at timestamptz
);

create index if not exists idx_encounters_status on encounters(status);
create index if not exists idx_encounters_p1 on encounters(p1_id);
create index if not exists idx_encounters_p2 on encounters(p2_id);

create table if not exists game_state (
    id int primary key default 1,
    is_active boolean not null default false,
    started_at timestamptz,
    reset_count int not null default 0,
    updated_at timestamptz not null default now(),
    constraint single_game_state_row check (id = 1)
);

insert into game_state (id, is_active)
values (1, false)
on conflict (id) do nothing;

create table if not exists loot_tokens (
    id uuid primary key default gen_random_uuid(),
    item_type text not null,
    token text unique not null,
    is_used boolean not null default false,
    claimed_by uuid references players(id) on delete set null,
    claimed_at timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists idx_loot_tokens_item_type on loot_tokens(item_type);
create index if not exists idx_loot_tokens_used on loot_tokens(is_used);

alter publication supabase_realtime add table players;
alter publication supabase_realtime add table encounters;
