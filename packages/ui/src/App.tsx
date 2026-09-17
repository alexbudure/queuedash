import type { QueuedashUiConfig } from "@queuedash/api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import {
  type PropsWithChildren,
  useCallback,
  useEffect,
  useState,
} from "react";
import { BrowserRouter, Route, Routes } from "react-router";
import { toast, Toaster } from "sonner";

import { LoginLoading, LoginPage } from "./components/LoginPage";
import { QueuedashAuthProvider } from "./components/QueuedashAuthProvider";
import {
  QueuedashProvider,
  useQueuedash,
} from "./components/QueuedashProvider";
import { HomePage } from "./pages/HomePage";
import { QueuePage } from "./pages/QueuePage";
import { SettingsPage } from "./pages/SettingsPage";
import { trpc } from "./utils/trpc";

export type QueuedashAppProps = {
  // URL to the API
  apiUrl: string;
  // Base path for the app
  basename: string;
  // Optional headers for tRPC requests (e.g., Authorization)
  headers?:
    | Record<string, string>
    | (() => Record<string, string> | Promise<Record<string, string>>);
  // Optional server-provided UI configuration
  ui?: QueuedashUiConfig;
  // Optional Queuedash session-auth endpoint
  auth?: {
    baseUrl: string;
  };
};

type QueuedashApplicationProps = Omit<QueuedashAppProps, "auth" | "ui"> & {
  onUnauthorized?: () => void;
};

const QueuedashApplication = ({
  apiUrl,
  basename,
  headers,
  onUnauthorized,
}: QueuedashApplicationProps) => {
  // Deliberately no global `placeholderData: keepPreviousData`. A same-key
  // refetch (the poll) never clears `data`, so it bought nothing there - but it
  // retains across *key* changes, which served the previous queue's jobs under
  // the new queue's name with no skeleton. MetricsSection opts in locally and
  // pairs it with an isPlaceholderData dim; that is the shape to copy.
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: apiUrl,
          // Keep fleet polls and bulk actions below common proxy URL limits.
          maxURLLength: 8_000,
          maxItems: 4,
          headers,
          fetch: async (input, init) => {
            const response = await fetch(input, {
              ...init,
              cache: "no-store",
              credentials: "same-origin",
            });
            if (response.status === 401) onUnauthorized?.();
            return response;
          },
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter basename={basename}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/queues/:id" element={<QueuePage />} />
            {/* Keep non-reserved v3 queue bookmarks working. */}
            <Route path="/:id" element={<QueuePage />} />
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </trpc.Provider>
  );
};

const QueuedashRoot = ({ children }: PropsWithChildren) => {
  const { isDark, preferences, setPortalContainer } = useQueuedash();

  return (
    <div
      ref={setPortalContainer}
      data-queuedash-root
      data-density={preferences.density}
      className={isDark ? "dark" : undefined}
    >
      {/* Above the auth boundary: a background 401 unmounts the application
          subtree, and a toast cannot be shown from a tree that is going away. */}
      <Toaster theme={isDark ? "dark" : "light"} position="bottom-right" />
      {children}
    </div>
  );
};

const joinAuthPath = (baseUrl: string, path: string) =>
  `${baseUrl.replace(/\/$/, "")}/${path}`;

const QueuedashWithAuth = ({
  apiUrl,
  auth,
  basename,
  headers,
}: Omit<QueuedashAppProps, "auth" | "ui"> & {
  auth: NonNullable<QueuedashAppProps["auth"]>;
}) => {
  const [authState, setAuthState] = useState<
    "checking" | "authenticated" | "unauthenticated"
  >("checking");
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setAuthState("checking");

    fetch(joinAuthPath(auth.baseUrl, "session"), {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => {
        setAuthState(response.ok ? "authenticated" : "unauthenticated");
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setAuthState("unauthenticated");
        }
      });

    return () => controller.abort();
  }, [auth.baseUrl]);

  const handleSignOut = useCallback(async () => {
    try {
      const response = await fetch(joinAuthPath(auth.baseUrl, "logout"), {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Sign out failed with status ${response.status}`);
      }
      setSessionExpired(false);
      setAuthState("unauthenticated");
    } catch {
      toast.error("Could not sign out. Please try again.");
    }
  }, [auth.baseUrl]);

  if (authState === "checking") return <LoginLoading />;
  if (authState === "unauthenticated") {
    return (
      <LoginPage
        authBaseUrl={auth.baseUrl}
        notice={
          sessionExpired
            ? "Your session expired. Sign in again to continue where you left off."
            : undefined
        }
        onAuthenticated={() => {
          setSessionExpired(false);
          setAuthState("authenticated");
        }}
      />
    );
  }

  return (
    <QueuedashAuthProvider onSignOut={handleSignOut}>
      <QueuedashApplication
        apiUrl={apiUrl}
        basename={basename}
        headers={headers}
        onUnauthorized={() => {
          setSessionExpired(true);
          setAuthState("unauthenticated");
        }}
      />
    </QueuedashAuthProvider>
  );
};

export const App = ({
  apiUrl,
  auth,
  basename,
  headers,
  ui,
}: QueuedashAppProps) => (
  <QueuedashProvider basename={basename} ui={ui}>
    <QueuedashRoot>
      {auth ? (
        <QueuedashWithAuth
          apiUrl={apiUrl}
          auth={auth}
          basename={basename}
          headers={headers}
        />
      ) : (
        <QueuedashAuthProvider>
          <QueuedashApplication
            apiUrl={apiUrl}
            basename={basename}
            headers={headers}
          />
        </QueuedashAuthProvider>
      )}
    </QueuedashRoot>
  </QueuedashProvider>
);
