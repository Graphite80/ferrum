create table events (
  user_id uuid not null references users (id) on delete cascade,
  event_id text not null,
  aggregate_id text not null,
  event_type text not null,
  schema_version int not null,
  hlc text not null,
  device_id text not null,
  payload jsonb not null,
  client_created_at timestamptz not null,
  server_received_at timestamptz not null default now(),
  server_sequence bigint generated always as identity,
  primary key (user_id, event_id)
);

create index events_user_sequence_idx on events (user_id, server_sequence);

create table device_clocks (
  user_id uuid not null references users (id) on delete cascade,
  device_id text not null,
  wall_millis bigint not null,
  counter int not null,
  primary key (user_id, device_id)
);
