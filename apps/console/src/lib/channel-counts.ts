/**
 * Per-channel counts for `/lab` (#326).
 *
 * The unit is an event row, not a person: one row is one call. `channel: null` is its own row, labelled "unknown
 * channel" by the panel, and the count of those rows is stated in words too. A share that hides its unknown row is
 * exactly what this item exists to prevent — the total must include the calls that cannot be attributed.
 */

export type ChannelRow = { channel: string | null };

export type ChannelCount = {
  /** The stored channel, or null for the unknown row. */
  channel: string | null;
  /** How many events in the window carried this channel (null = carried none). */
  count: number;
};

export type ChannelCounts = {
  /** Known channels, highest count first; ties by channel name. The null row is NOT included here. */
  channels: ChannelCount[];
  /** Events with no channel: absent or invalid `?from=`. */
  unknown: number;
  /** Every event in the window, including unknown. */
  total: number;
};

/** A channel is only a channel if it is a non-empty string; anything else is the unknown row. */
function keyOf(row: ChannelRow): string | null {
  return typeof row.channel === "string" && row.channel.length > 0 ? row.channel : null;
}

export function groupByChannel(rows: ChannelRow[]): ChannelCounts {
  const counts = new Map<string, number>();
  let unknown = 0;

  for (const row of rows) {
    const key = keyOf(row);
    if (key === null) {
      unknown += 1;
      continue;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const channels = [...counts.entries()]
    .map(([channel, count]) => ({ channel, count }))
    .sort((a, b) => b.count - a.count || (a.channel ?? "").localeCompare(b.channel ?? ""));

  return { channels, unknown, total: rows.length };
}

/** "N of M events in this window had no channel (unknown)." Keeps the unknown row visible in prose too. */
export function unknownSentence(counts: ChannelCounts): string {
  const share = counts.total === 0 ? "0" : String(Math.round((counts.unknown / counts.total) * 100));
  return `${counts.unknown.toLocaleString("en-US")} of ${counts.total.toLocaleString("en-US")} events in this window had no channel (${share}%) — unknown is its own row, not "direct".`;
}
