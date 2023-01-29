import { QueueDashApp } from "@queuedash/ui";

function getBaseUrl() {
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}/api/queue-dash`;
  }

  return `http://localhost:${process.env.PORT ?? 3000}/api/queue-dash`;
}

const Pages = () => {
  return <QueueDashApp apiUrl={getBaseUrl()} basename="/queue-dash" />;
};

export default Pages;
