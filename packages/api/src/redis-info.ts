/**
 * The INFO fields the dashboard reads. Redis sends every value as a string and
 * reports many more fields than these. A server that leaves one out, such as an
 * older Redis or a Redis-compatible store, gives undefined for it.
 */
export type RedisInfo = {
  redis_version: string;
  uptime_in_seconds: string;
  connected_clients: string;
  blocked_clients: string;
  maxclients: string;
  used_memory: string;
  used_memory_human: string;
  total_system_memory: string;
  total_system_memory_human: string;
  [field: string]: string;
};

/** Reads INFO's `field:value` lines, skipping blanks and `# Section` headers. */
export const parseRedisInfo = (info: string): RedisInfo => {
  const fields: Record<string, string> = {};
  for (const rawLine of info.split("\n")) {
    const line = rawLine.trim();
    const separator = line.indexOf(":");
    if (separator <= 0 || line.startsWith("#")) continue;
    fields[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return fields as RedisInfo;
};
