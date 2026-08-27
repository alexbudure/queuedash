import { version } from "../../package.json";
import { resolveQueueAccess } from "../access";
import { resolvePrivacyExposure } from "../presentation";
import {
  getQueueRegistry,
  normalizeDiscoveryMaxQueues,
  normalizeDiscoveryRefreshInterval,
} from "../queue-registry";
import { procedure, router } from "../trpc";

export const settingsRouter = router({
  get: procedure.query(async ({ ctx }) => {
    const registry = getQueueRegistry(ctx);
    let queueEntries: Awaited<ReturnType<typeof registry.list>> = [];
    try {
      queueEntries = await registry.list();
    } catch {
      // Settings still reports unhealthy initial discovery without leaking the
      // Redis error or making the policy page unavailable.
    }
    const defaultAccess = ctx.access?.default ?? "full";
    const visiblePolicies = queueEntries.flatMap(({ adapter }) => {
      const queueName = adapter.getName();
      const access = resolveQueueAccess(queueName, ctx.access, ctx.privacy);
      if (access.mode === "hidden") return [];

      const deny = access.mode === "full" ? access.deniedActions : [];
      if (access.mode === defaultAccess && deny.length === 0) return [];

      return [
        {
          queues: [queueName],
          mode: access.mode,
          deny,
        },
      ];
    });

    return {
      version,
      access: {
        default: defaultAccess,
        rules: visiblePolicies,
      },
      privacy: {
        redactionEnabled: !!ctx.privacy?.redact,
        expose: resolvePrivacyExposure(ctx.privacy),
      },
      search: {
        maxScanned: Math.min(
          Math.max(
            Number.isFinite(ctx.search?.maxScanned)
              ? Math.floor(ctx.search?.maxScanned as number)
              : 5_000,
            25,
          ),
          5_000,
        ),
      },
      discovery: {
        ...registry.getDiscoveryStatus(),
        type: ctx.discovery?.type,
        prefix: ctx.discovery?.prefix ?? "bull",
        refreshIntervalMs: normalizeDiscoveryRefreshInterval(
          ctx.discovery?.refreshIntervalMs,
        ),
        maxQueues: normalizeDiscoveryMaxQueues(ctx.discovery?.maxQueues),
      },
    };
  }),
});
