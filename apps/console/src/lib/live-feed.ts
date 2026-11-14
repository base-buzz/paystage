/**
 * The live feed's connection details.
 *
 * A Supabase *publishable* key is designed to be shipped to browsers — it grants only what row-level
 * security allows, and the only policy on `events_feed` is "read". It is not a secret, and treating
 * it as one would mean a build-time secret for a value that is public by construction.
 *
 * The table behind it is a projection: `tool`, `decision`, `source`, `network`, `created_at`. No
 * request ids, no payer addresses, no error classes. Realtime publishes row images from a table, so
 * the safest way to not leak a column is for the column not to be in the table.
 */
const FALLBACK_URL = "https://dtfvyvhziduhkkazpblb.supabase.co";
const FALLBACK_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0ZnZ5dmh6aWR1aGtrYXpwYmxiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM0NjM2OTcsImV4cCI6MjEwOTAzOTY5N30.KGTido87UOi5XvKHwQANIJTeR_OwKfseFT9ELG31fT4";

export const LIVE_FEED = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? FALLBACK_URL,
  key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? FALLBACK_KEY,
  table: "events_feed",
};

/** True when the feed can actually connect; a placeholder key means it cannot. */
export const LIVE_FEED_CONFIGURED = !LIVE_FEED.key.includes("placeholder");
