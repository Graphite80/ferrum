alter table auth_tokens add column revoked_at timestamptz;

-- Every lookup is "is this credential still good", so the index has to answer
-- that, not just find the row.
create index auth_tokens_user_live_idx on auth_tokens (user_id) where revoked_at is null;
