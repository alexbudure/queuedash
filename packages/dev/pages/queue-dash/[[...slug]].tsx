import { QueueDashApp } from "@queuedash/ui";

function getBaseUrl() {
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}/api/queue-dash`;
  }

  return `http://localhost:${process.env.PORT ?? 3000}/api/queue-dash`;
}

const Pages = () => {
  return (
    <div>
      <QueueDashApp apiUrl={getBaseUrl()} basename="/queue-dash" />
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
