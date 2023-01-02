import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@queuedash/api";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";

export type RouterOutput = inferRouterOutputs<AppRouter>;
export type RouterInput = inferRouterInputs<AppRouter>;

export type Job = RouterOutput["job"]["list"]["jobs"][0];
export type Queue = RouterOutput["queue"]["byName"];
export type Status = RouterInput["job"]["list"]["status"];

// eslint-disable-next-line
// @ts-ignore
export const trpc = createTRPCReact<AppRouter>({
  unstable_overrides: {
    useMutation: {
      async onSuccess(opts) {
        await opts.originalFn();
        await opts.queryClient.invalidateQueries();
      },
    },
  },
});
