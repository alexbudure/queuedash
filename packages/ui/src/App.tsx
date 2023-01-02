import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { useEffect, useState } from "react";
import { trpc } from "./utils/trpc";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { QueuePage } from "./pages/QueuePage";
import type { UserPreferences } from "./components/ThemeSwitcher";

type QueueDashPagesProps = {
  apiUrl: string;
  basename: string;
};
export const App = ({ apiUrl, basename }: QueueDashPagesProps) => {
  const [ready, setReady] = useState(false);
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: apiUrl,
        }),
      ],
    })
  );

  useEffect(() => {
    const userPreferences: UserPreferences | null = JSON.parse(
      localStorage.getItem("user-preferences") || "null"
    );

    if (userPreferences) {
      if (
        userPreferences.theme === "dark" ||
        (userPreferences.theme === "system" &&
          window.matchMedia("(prefers-color-scheme: dark)").matches)
      ) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    } else {
      if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    }

    setReady(true);
  }, []);

  if (!ready) {
    return null;
  }

  const router = createBrowserRouter(
    [
      {
        path: "/:id",
        element: <QueuePage />,
      },
    ],
    {
      basename,
    }
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </trpc.Provider>
  );
};
