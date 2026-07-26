-- Core schema for the Birthday Syndicate Pub Quiz

create extension if not exists pgcrypto;

-- Cleanup from previous game mode.
drop table if exists loot_tokens cascade;
drop table if exists encounters cascade;

-- Games table to hold multiple game sessions
create table if not exists games (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    status text not null default 'active' check (status in ('active', 'closed')),
    created_at timestamptz not null default now(),
    closed_at timestamptz
);

create index if not exists idx_games_status on games(status);

create table if not exists players (
    id uuid primary key default gen_random_uuid(),
    game_id uuid not null references games(id) on delete cascade,
    name text not null,
    score int not null default 0,
    created_at timestamptz not null default now()
);

-- Ensure player names are unique per game
create unique index if not exists idx_players_name_game_unique_ci on players (game_id, lower(name));

alter table players drop column if exists inventory;

create table if not exists quiz_questions (
    id uuid primary key default gen_random_uuid(),
    prompt text not null,
    option_a text not null,
    option_b text not null,
    option_c text not null,
    option_d text not null,
    image_url text,
    correct_option text check (correct_option in ('A', 'B', 'C', 'D')),
    duration_seconds int not null default 20,
    created_at timestamptz not null default now()
);

alter table quiz_questions add column if not exists image_url text;

-- Table to associate questions with games and define order
create table if not exists game_questions (
    id uuid primary key default gen_random_uuid(),
    game_id uuid not null references games(id) on delete cascade,
    question_id uuid not null references quiz_questions(id) on delete cascade,
    question_order int not null,
    activated_at timestamptz,
    created_at timestamptz not null default now(),
    unique (game_id, question_id)
);

create index if not exists idx_game_questions_game on game_questions(game_id);
create index if not exists idx_game_questions_order on game_questions(game_id, question_order);
create index if not exists idx_game_questions_activated on game_questions(game_id, activated_at);

create table if not exists game_state (
    id uuid primary key default gen_random_uuid(),
    game_id uuid not null unique references games(id) on delete cascade,
    is_active boolean not null default false,
    game_over boolean not null default false,
    current_question_id uuid references quiz_questions(id) on delete set null,
    special_player_id uuid references players(id) on delete set null,
    round_started_at timestamptz,
    round_ends_at timestamptz,
    reveal_answers boolean not null default false,
    updated_at timestamptz not null default now()
);

create index if not exists idx_game_state_game on game_state(game_id);

create table if not exists player_answers (
    id uuid primary key default gen_random_uuid(),
    game_id uuid not null references games(id) on delete cascade,
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
create index if not exists idx_player_answers_game on player_answers(game_id);

alter publication supabase_realtime add table games;
alter publication supabase_realtime add table players;
alter publication supabase_realtime add table quiz_questions;
alter publication supabase_realtime add table game_questions;
alter publication supabase_realtime add table game_state;
alter publication supabase_realtime add table player_answers;
