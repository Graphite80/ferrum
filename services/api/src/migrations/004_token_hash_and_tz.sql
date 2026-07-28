alter table auth_tokens rename column token to token_hash;
alter table telegram_chats add column tz_offset_minutes int not null default 0;
