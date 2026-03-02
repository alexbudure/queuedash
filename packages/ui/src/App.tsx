import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { useEffect, useState } from "react";
import { trpc } from "./utils/trpc";
import { BrowserRouter, Route, Routes } from "react-router";
import { QueuePage } from "./pages/QueuePage";
import {
  applyThemePreference,
  getStoredUserPreferences,
} from "./components/ThemeSwitcher";
import { HomePage } from "./pages/HomePage";
import { Toaster } from "sonner";

type QueueDashPagesProps = {
  // URL to the API
  apiUrl: string;
  // Base path for the app
  basename: string;
  // Optional headers for tRPC requests (e.g., Authorization)
  headers?:
    | Record<string, string>
    | (() => Record<string, string> | Promise<Record<string, string>>);
};
export const App = ({ apiUrl, basename, headers }: QueueDashPagesProps) => {
  const [ready, setReady] = useState(false);
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: apiUrl,
          headers,
        }),
      ],
    }),
  );

  useEffect(() => {
    applyThemePreference(getStoredUserPreferences()?.theme ?? "system");

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemThemeChange = () => {
      const preferences = getStoredUserPreferences();
      if (!preferences || preferences.theme === "system") {
        applyThemePreference("system");
      }
    };

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleSystemThemeChange);
    } else {
      mediaQuery.addListener(handleSystemThemeChange);
    }

    setReady(true);

    return () => {
      if (typeof mediaQuery.addEventListener === "function") {
        mediaQuery.removeEventListener("change", handleSystemThemeChange);
      } else {
        mediaQuery.removeListener(handleSystemThemeChange);
      }
    };
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
