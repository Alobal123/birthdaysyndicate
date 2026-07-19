-- Core schema for the Birthday Syndicate Pub Quiz

create extension if not exists pgcrypto;

-- Cleanup from previous game mode.
drop table if exists loot_tokens cascade;
drop table if exists encounters cascade;

create table if not exists players (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    score int not null default 0,
    created_at timestamptz not null default now()
);

alter table players drop column if exists inventory;

create unique index if not exists idx_players_name_unique_ci on players (lower(name));

create table if not exists quiz_questions (
    id uuid primary key default gen_random_uuid(),
    prompt text not null,
    option_a text not null,
    option_b text not null,
    option_c text not null,
    option_d text not null,
    correct_option text check (correct_option in ('A', 'B', 'C', 'D')),
    category text,
    duration_seconds int not null default 30,
    created_at timestamptz not null default now()
);

create table if not exists game_state (
    id int primary key default 1,
    is_active boolean not null default false,
    current_question_id uuid references quiz_questions(id) on delete set null,
    special_player_id uuid references players(id) on delete set null,
    round_started_at timestamptz,
    round_ends_at timestamptz,
    reveal_answers boolean not null default false,
    updated_at timestamptz not null default now(),
    constraint single_game_state_row check (id = 1)
);

insert into game_state (id, is_active)
values (1, false)
on conflict (id) do nothing;

create table if not exists player_answers (
    id uuid primary key default gen_random_uuid(),
    player_id uuid not null references players(id) on delete cascade,
    question_id uuid not null references quiz_questions(id) on delete cascade,
    selected_option text not null check (selected_option in ('A', 'B', 'C', 'D')),
    is_correct boolean not null,
    points_awarded int not null default 0,
    answered_at timestamptz not null default now(),
    unique (player_id, question_id)
);

create index if not exists idx_player_answers_question on player_answers(question_id);
create index if not exists idx_player_answers_player on player_answers(player_id);

alter publication supabase_realtime add table players;
alter publication supabase_realtime add table quiz_questions;
alter publication supabase_realtime add table game_state;
alter publication supabase_realtime add table player_answers;
