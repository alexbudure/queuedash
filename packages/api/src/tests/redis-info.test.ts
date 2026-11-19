import { describe, expect, test } from "vitest";

import { parseRedisInfo } from "../redis-info";

// Shaped like a real INFO reply: CRLF line ends, section headers, a blank line
// after each section, and values that contain colons or are empty.
const info = [
  "# Server",
  "redis_version:7.4.1",
  "executable:/usr/local/bin/redis-server",
  "config_file:",
  "uptime_in_seconds:435969",
  "",
  "# Clients",
  "connected_clients:3",
  "blocked_clients:1",
  "maxclients:10000",
  "",
  "# Memory",
  "used_memory:18079536",
  "used_memory_human:17.24M",
  "total_system_memory:68719476736",
  "total_system_memory_human:64.00G",
  "",
  "# Replication",
  "master_host:2001:db8::1",
  "",
  "# Keyspace",
  "db0:keys=12,expires=0,avg_ttl=0",
  "",
].join("\r\n");

describe("parseRedisInfo", () => {
  test("reads the fields the Redis panel shows", () => {
    expect(parseRedisInfo(info)).toMatchObject({
      redis_version: "7.4.1",
      uptime_in_seconds: "435969",
      connected_clients: "3",
      blocked_clients: "1",
      maxclients: "10000",
      used_memory: "18079536",
      used_memory_human: "17.24M",
      total_system_memory: "68719476736",
      total_system_memory_human: "64.00G",
    });
  });

  test("splits each line on its first colon", () => {
    const fields = parseRedisInfo(info);
    expect(fields.master_host).toBe("2001:db8::1");
    expect(fields.executable).toBe("/usr/local/bin/redis-server");
    expect(fields.config_file).toBe("");
  });

  test("skips section headers and blank lines", () => {
    const keys = Object.keys(parseRedisInfo(info));
    expect(keys.filter((key) => key === "" || key.startsWith("#"))).toEqual([]);
    expect(keys).toHaveLength(13);
  });

  test("leaves a field the server didn't send undefined", () => {
    const fields = parseRedisInfo("# Server\r\nredis_version:6.0.0\r\n");
    expect(fields.redis_version).toBe("6.0.0");
    expect(fields.total_system_memory).toBeUndefined();
  });
});
