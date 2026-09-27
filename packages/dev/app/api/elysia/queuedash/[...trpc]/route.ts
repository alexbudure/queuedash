async function createElysiaApp() {
  const { Elysia } = await import("elysia");
  const { fetchRequestHandler } = await import("@trpc/server/adapters/fetch");
  const { appRouter } = await import("@queuedash/api");
  const { queues } = await import("../../../../../utils/fake-data");
  // Queuedash caches its queue registry per context object, so every request
  // shares this one (the app is created once); a context built per request
  // would rebuild all adapters.
  const ctx = { queues };

  return new Elysia({ name: "queuedash" }).all("/*", async ({ request }) => {
    return fetchRequestHandler({
      endpoint: "/api/elysia/queuedash",
      router: appRouter,
      req: request,
      createContext: () => ctx,
    });
  });
}

// The concrete Elysia instance carries its route table in its type parameters,
// so it is not assignable to the bare `Elysia` default. Infer it instead.
type QueuedashElysiaApp = Awaited<ReturnType<typeof createElysiaApp>>;

let elysiaApp: QueuedashElysiaApp | null = null;
let elysiaError: Error | null = null;

async function getElysiaApp(): Promise<QueuedashElysiaApp> {
  if (elysiaError) throw elysiaError;
  if (elysiaApp) return elysiaApp;

  try {
    elysiaApp = await createElysiaApp();
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
