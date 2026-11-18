-- Testnet faucet ledger (#92).
--
-- The unit of rationing is the address, not the IP: an agent scripts IPs away in an hour. One row per drip, and the
-- cap query is "newest row for this address", which is why created_at is indexed descending with the address.

create table if not exists public.faucet_drips (
  id          bigint generated always as identity primary key,
  address     text        not null,
  amount_usdc numeric     not null,
  tx_hash     text        not null,
  created_at  timestamptz not null default now()
);

create index if not exists faucet_drips_address_created_idx
  on public.faucet_drips (address, created_at desc);

comment on table public.faucet_drips is
  'One row per faucet drip. Addresses are stored lowercase so checksum spelling cannot buy a second drip.';
