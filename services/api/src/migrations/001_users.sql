create table users (
  id uuid primary key default gen_random_uuid()
);

create table user_identities (
  user_id uuid not null references users (id) on delete cascade,
  provider text not null,
  provider_uid text not null,
  unique (provider, provider_uid)
);

create table auth_tokens (
  token text primary key,
  user_id uuid not null references users (id) on delete cascade,
  created_at timestamptz not null default now()
);
