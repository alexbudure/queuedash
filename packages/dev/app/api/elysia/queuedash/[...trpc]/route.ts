import type { Elysia } from "elysia";

let elysiaApp: Elysia | null = null;
let elysiaError: Error | null = null;

async function getElysiaApp() {
  if (elysiaError) throw elysiaError;
  if (elysiaApp) return elysiaApp;

  try {
    const { Elysia } = await import("elysia");
    const { fetchRequestHandler } = await import(
      "@trpc/server/adapters/fetch"
    );
    const { appRouter } = await import("@queuedash/api");
    const { queues } = await import("../../../../../utils/fake-data");

    elysiaApp = new Elysia({ name: "queuedash" }).all(
      "/*",
      async ({ request }) => {
        return fetchRequestHandler({
          endpoint: "/api/elysia/queuedash",
          router: appRouter,
          req: request,
          createContext: () => ({ queues }),
        });
      },
    );

    return elysiaApp;
  } catch (error) {
    elysiaError = error as Error;
    throw error;
  }
}

const handler = async (req: Request) => {
  try {
    const app = await getElysiaApp();
    return app.handle(req);
  } catch (error) {
    return Response.json(
      {
        error: "Elysia adapter failed",
        message: error instanceof Error ? error.message : "Unknown error",
        note: "Elysia requires Bun runtime and may not work in Next.js API routes (Node.js)",
      },
      { status: 500 },
    );
  }
};

export { handler as GET, handler as POST };
