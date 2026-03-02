import { QueueDashApp } from "@queuedash/ui";
import { useState, useEffect } from "react";
import {
  Button as AriaButton,
  Dialog,
  DialogTrigger,
  Popover,
} from "react-aria-components";

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
  const [isResetting, setIsResetting] = useState(false);

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

  const handleResetQueues = async () => {
    setIsResetting(true);

    try {
      await fetch("/api/reset");
      window.location.reload();
    } finally {
      setIsResetting(false);
    }
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
          position: "fixed",
          right: 32,
          bottom: 32,
          zIndex: 80,
        }}
      >
        <DialogTrigger>
          <AriaButton
            style={{
              display: "flex",
              height: 32,
              width: 32,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 9999,
              border: "1px solid #d1d5db",
              backgroundColor: "rgba(255, 255, 255, 0.96)",
              boxShadow:
                "0 1px 2px 0 rgb(0 0 0 / 0.08), 0 1px 1px -1px rgb(0 0 0 / 0.12)",
              color: "#374151",
              cursor: "pointer",
            }}
            aria-label="Toggle dev tools"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              style={{
                width: 14,
                height: 14,
                display: "block",
              }}
            >
              <path
                d="M21 7.5a5.5 5.5 0 0 1-7.37 5.2L8.1 18.23a2 2 0 1 1-2.83-2.83l5.53-5.53A5.5 5.5 0 1 1 21 7.5z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </AriaButton>

          <Popover
            placement="top start"
            offset={8}
            style={{
              width: 256,
              borderRadius: 12,
              border: "1px solid #e5e7eb",
              backgroundColor: "#fff",
              padding: 12,
              boxShadow:
                "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
            }}
          >
            <Dialog
              aria-label="Dev tools"
              style={{
                outline: "none",
              }}
            >
              <p
                style={{
                  margin: "0 0 8px",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "#6b7280",
                }}
              >
                Dev Tools
              </p>

              <label
                style={{
                  display: "block",
                  marginBottom: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#4b5563",
                }}
              >
                API Adapter
              </label>
              <select
                value={selectedAdapter}
                onChange={(e) => handleAdapterChange(e.target.value)}
                style={{
                  display: "block",
                  width: "100%",
                  marginBottom: 10,
                  borderRadius: 6,
                  border: "1px solid #d1d5db",
                  backgroundColor: "#fff",
                  padding: "8px 10px",
                  fontSize: 14,
                  color: "#111827",
                }}
              >
                {ADAPTERS.map((adapter) => (
                  <option key={adapter.id} value={adapter.id}>
                    {adapter.name}
                  </option>
                ))}
              </select>

              <button
                onClick={handleResetQueues}
                disabled={isResetting}
                style={{
                  width: "100%",
                  borderRadius: 6,
                  border: "1px solid #fca5a5",
                  backgroundColor: "#fef2f2",
                  padding: "8px 12px",
                  fontSize: 14,
                  fontWeight: 600,
                  color: "#b91c1c",
                  cursor: isResetting ? "not-allowed" : "pointer",
                  opacity: isResetting ? 0.6 : 1,
                }}
              >
                {isResetting ? "Resetting..." : "Reset queues"}
              </button>
            </Dialog>
          </Popover>
        </DialogTrigger>
      </div>
    </div>
  );
};

export default Pages;
