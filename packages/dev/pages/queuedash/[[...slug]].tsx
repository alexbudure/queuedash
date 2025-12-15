import { QueueDashApp } from "@queuedash/ui";
import { useState, useEffect } from "react";

const ADAPTERS = [
  { id: "trpc", name: "tRPC (Direct)", apiUrl: "/api/trpc/queuedash" },
  { id: "express", name: "Express", apiUrl: "/api/express/queuedash" },
  { id: "fastify", name: "Fastify", apiUrl: "/api/fastify/queuedash" },
  { id: "hono", name: "Hono", apiUrl: "/api/hono/queuedash" },
  { id: "elysia", name: "Elysia (Bun)", apiUrl: "/api/elysia/queuedash" },
] as const;

const STORAGE_KEY = "queuedash-adapter";

const Pages = () => {
  const [selectedAdapter, setSelectedAdapter] = useState<string>("trpc");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && ADAPTERS.some((a) => a.id === stored)) {
      setSelectedAdapter(stored);
    }
    setMounted(true);
  }, []);

  const handleAdapterChange = (adapterId: string) => {
    setSelectedAdapter(adapterId);
    localStorage.setItem(STORAGE_KEY, adapterId);
    window.location.reload();
  };

  const currentAdapter = ADAPTERS.find((a) => a.id === selectedAdapter)!;

  if (!mounted) {
    return null;
  }

  return (
    <div>
      <QueueDashApp apiUrl={currentAdapter.apiUrl} basename="/queuedash" />

      <div
        style={{
          position: "absolute",
          top: 20,
          right: 20,
        }}
      >
        <select
          value={selectedAdapter}
          onChange={(e) => handleAdapterChange(e.target.value)}
          className="block w-48 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          {ADAPTERS.map((adapter) => (
            <option key={adapter.id} value={adapter.id}>
              {adapter.name}
            </option>
          ))}
        </select>
      </div>

      <div className="fixed bottom-0 right-0 p-4">
        <button
          onClick={() => {
            fetch(`/api/reset`);
          }}
          className="rounded-md border border-red-900 bg-white px-2 py-1 text-red-900 hover:bg-red-50"
        >
          Reset queues
        </button>
      </div>
    </div>
  );
};

export default Pages;
