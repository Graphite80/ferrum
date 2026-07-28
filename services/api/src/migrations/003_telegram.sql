create table telegram_chats (
  tg_chat_id bigint primary key,
  user_id uuid not null references users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table link_tokens (
  token text primary key,
  user_id uuid not null references users (id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table bot_pending (
  id text primary key,
  tg_chat_id bigint not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
