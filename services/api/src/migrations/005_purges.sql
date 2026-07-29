create table purged_aggregates (
  user_id uuid not null references users (id) on delete cascade,
  aggregate_id text not null,
  purged_at timestamptz not null default now(),
  purge_sequence bigint generated always as identity,
  primary key (user_id, aggregate_id)
);

create index purged_aggregates_user_sequence_idx on purged_aggregates (user_id, purge_sequence);
