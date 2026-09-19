-- Better Auth tables for Chambers on Neon (issue #136).
--
-- Better Auth's user model is mapped onto public.users itself (see
-- lib/better-auth.ts), so a Chambers user and a login are one row with one id,
-- exactly as they were under Supabase, where auth.users and public.users shared
-- ids. That needs three columns Better Auth reads and writes on its user.
--
-- Sessions, credential accounts and verification tokens get their own tables,
-- named auth_* and snake_cased to match the rest of the schema. Better Auth is
-- told the column names in lib/better-auth.ts; the two must be changed together.

alter table public.users
  add column if not exists email_verified boolean not null default true,
  add column if not exists image text,
  add column if not exists updated_at timestamp with time zone not null default now();

-- Better Auth treats createdAt as required.
update public.users set created_at = now() where created_at is null;
alter table public.users alter column created_at set not null;

-- The login email is matched case-insensitively everywhere else in Chambers
-- (signup, invites), so stored addresses are kept lowercase.
alter table public.users
  add constraint users_email_lowercase CHECK (email = lower(email));

create table public.auth_sessions (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  token text not null,
  expires_at timestamp with time zone not null,
  ip_address text,
  user_agent text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint auth_sessions_pkey PRIMARY KEY (id),
  constraint auth_sessions_token_key UNIQUE (token),
  constraint auth_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE
);
create index auth_sessions_user_id_idx on public.auth_sessions using btree (user_id);

-- One row per way a user can sign in. Chambers only has passwords, so every row
-- is provider_id 'credential' with account_id = user_id. Passwords imported from
-- Supabase are bcrypt ($2a$/$2b$) and stay that way; lib/better-auth.ts hashes
-- and verifies with bcrypt so they keep working.
create table public.auth_accounts (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  account_id text not null,
  provider_id text not null,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamp with time zone,
  refresh_token_expires_at timestamp with time zone,
  scope text,
  password text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint auth_accounts_pkey PRIMARY KEY (id),
  constraint auth_accounts_provider_account_key UNIQUE (provider_id, account_id),
  constraint auth_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE
);
create index auth_accounts_user_id_idx on public.auth_accounts using btree (user_id);

-- Password-reset tokens.
create table public.auth_verifications (
  id uuid not null default gen_random_uuid(),
  identifier text not null,
  value text not null,
  expires_at timestamp with time zone not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint auth_verifications_pkey PRIMARY KEY (id)
);
create index auth_verifications_identifier_idx on public.auth_verifications using btree (identifier);

alter table public.auth_sessions enable row level security;
alter table public.auth_accounts enable row level security;
alter table public.auth_verifications enable row level security;
