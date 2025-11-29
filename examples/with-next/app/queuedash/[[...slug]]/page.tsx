"use client";

import { QueueDashApp } from "@queuedash/ui";

function getBaseUrl() {
  if (typeof window !== "undefined") {
    return `/api/queuedash`;
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}/api/queuedash`;
  }

  return `http://localhost:${process.env.PORT ?? 3000}/api/queuedash`;
}

export default function Page() {
  return <QueueDashApp apiUrl={getBaseUrl()} basename="/queuedash" />;
}
