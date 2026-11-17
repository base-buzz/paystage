-- Preferences, and the only reason this project ever asks a human to sign in.
--
-- Default is local: theme and language live in localStorage and touch no server. Signing in is optional
-- convenience for a second device, storing exactly {address, theme, language, updated_at} — no email, no
-- password, no identifier that follows anyone around the site. Nothing in the tool, API or receipt path
-- reads this table; a test asserts that the MCP package never mentions it.
--
-- The address is the whole identity: one row per wallet, and the session cookie (HMAC, one hour) is the
-- proof. RLS on with no policy plus a service_role-only grant means the browser can never read another
-- wallet's row even if a key leaks into the bundle, because no key is in the bundle.
create table if not exists public.preferences (
  address     text primary key,
  theme       text not null check (theme in ('system', 'light', 'dark')),
  language    text not null check (language in ('en', 'zh')),
  updated_at  timestamptz not null default now()
);

alter table public.preferences enable row level security;
revoke all on public.preferences from anon, authenticated;
grant select, insert, update on public.preferences to service_role;
