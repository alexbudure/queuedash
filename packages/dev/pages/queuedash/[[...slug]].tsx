import { QueueDashApp } from "@queuedash/ui";

const Pages = () => {
  return (
    <div>
      <QueueDashApp apiUrl="/api/queuedash" basename="/queuedash" />
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
