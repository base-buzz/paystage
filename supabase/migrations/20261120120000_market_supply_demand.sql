-- Daily market shape: what sellers advertise (supply) and what they actually receive (demand).
--
-- Two tables rather than one, because they come from different sources and fail independently: supply is a
-- catalogue read (PayAI discovery), demand is on-chain USDC transfers. A day can have one and not the other,
-- and the page must be able to say which half is missing.

create table if not exists public.market_supply (
  run_date date primary key,
  resources integer not null,
  accepts integer not null,
  payees integer not null,
  hosts integer not null,
  median_price_usdc numeric,
  p90_price_usdc numeric,
  bare_label_accepts integer not null default 0,
  top_payees jsonb not null default '[]'::jsonb,   -- [{payee, accepts, resources, hosts}]
  networks jsonb not null default '{}'::jsonb,     -- {"eip155:8453": 12810, "base": 1183, ...}
  deltas jsonb not null default '{}'::jsonb,       -- {new_resources, gone_resources, new_payees, gone_payees}
  created_at timestamptz not null default now()
);

create table if not exists public.market_demand (
  run_date date primary key,
  window_blocks integer not null,
  chain_usdc_transfers integer not null,           -- baseline in the same window, so 0 is distinguishable
  payee_transfers integer not null,
  payee_transfers_value_usdc numeric,
  distinct_payees_paid integer not null,
  distinct_payers integer not null,
  repeat_payers integer not null,
  top_payees_paid jsonb not null default '[]'::jsonb,  -- [{payee, transfers, value_usdc}]
  size_p50_usdc numeric,
  size_p90_usdc numeric,
  payees_listed integer not null,                  -- denominator for the coverage number
  sampled_payees integer not null,
  method text not null,                            -- rendered next to the number, always
  -- The positive control, stored with the row it validates: a zero must be readable as "no payments" or "broken filter", and only this tells them apart.
  control_topic_filter boolean,
  control_address text,
  created_at timestamptz not null default now()
);

-- Same read path as probe_runs: server-only, RLS on with no policy. The console reads with the service key.
alter table public.market_supply enable row level security;
alter table public.market_demand enable row level security;
