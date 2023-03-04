import { QueueDashApp } from "@queuedash/ui";
import { NextPage } from "next";

function getBaseUrl() {
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}/api/queuedash`;
  }

  return `http://localhost:${process.env.PORT ?? 3000}/api/queuedash`;
}

const Page: NextPage = () => {
  return <QueueDashApp apiUrl={getBaseUrl()} basename="/queuedash" />;
};

export default Page;
