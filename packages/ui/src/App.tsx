import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { useEffect, useState } from "react";
import { trpc } from "./utils/trpc";
import { BrowserRouter, Route, Routes } from "react-router";
import { QueuePage } from "./pages/QueuePage";
import type { UserPreferences } from "./components/ThemeSwitcher";
import { HomePage } from "./pages/HomePage";
import { Toaster } from "sonner";

type QueueDashPagesProps = {
  // URL to the API
  apiUrl: string;
  // Base path for the app
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
    }),
  );

  useEffect(() => {
    const userPreferences: UserPreferences | null = JSON.parse(
      localStorage.getItem("user-preferences") || "null",
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

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <Toaster />
        <BrowserRouter basename={basename}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/:id" element={<QueuePage />} />
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </trpc.Provider>
  );
};
