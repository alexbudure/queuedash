import { Eye, EyeOff, Layers, LoaderCircle, LockKeyhole } from "lucide-react";
import { type FormEvent, useState } from "react";

import { useQueuedash } from "./QueuedashProvider";

const createBasicAuthorization = (username: string, password: string) => {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join(
    "",
  );
  return `Basic ${btoa(binary)}`;
};

const joinAuthPath = (baseUrl: string, path: string) =>
  `${baseUrl.replace(/\/$/, "")}/${path}`;

const Brand = () => {
  const { branding } = useQueuedash();

  return (
    <div className="flex items-center justify-center gap-2.5">
      {branding.logoUrl ? (
        // oxlint-disable-next-line next/no-img-element -- Shared UI cannot depend on a framework image component.
        <img
          src={branding.logoUrl}
          alt={branding.logoAlt}
          className="h-7 max-w-40 object-contain"
        />
      ) : (
        <div className="flex size-9 items-center justify-center rounded-xl bg-gray-900 text-white shadow-sm dark:bg-white dark:text-slate-950">
          <Layers className="size-5" strokeWidth={2.4} />
        </div>
      )}
      <span className="text-lg font-semibold tracking-tight text-gray-900 dark:text-white">
        {branding.name}
      </span>
    </div>
  );
};

export const LoginLoading = () => (
  <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-slate-950">
    <div className="flex flex-col items-center gap-4">
      <Brand />
      <LoaderCircle className="size-4 animate-spin text-gray-400 dark:text-slate-500" />
    </div>
  </div>
);

export const LoginPage = ({
  authBaseUrl,
  onAuthenticated,
}: {
  authBaseUrl: string;
  onAuthenticated: () => void;
}) => {
  const { branding } = useQueuedash();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(undefined);
    setIsSubmitting(true);

    try {
      const response = await fetch(joinAuthPath(authBaseUrl, "login"), {
        method: "POST",
        headers: {
          Authorization: createBasicAuthorization(username, password),
        },
        credentials: "same-origin",
        cache: "no-store",
      });

      if (response.ok) {
        setPassword("");
        onAuthenticated();
        return;
      }

      setError(
        response.status === 401
          ? "The username or password is incorrect."
          : "Unable to sign in. Please try again.",
      );
    } catch {
      setError("Unable to reach the server. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gray-50 px-4 py-12 dark:bg-slate-950">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-[-18rem] left-1/2 size-[42rem] -translate-x-1/2 rounded-full bg-brand-200/30 blur-3xl dark:bg-brand-900/20" />
        <div className="absolute right-[-12rem] bottom-[-22rem] size-[38rem] rounded-full bg-gray-200/60 blur-3xl dark:bg-slate-800/40" />
      </div>

      <div className="relative w-full max-w-sm">
        <div className="mb-8">
          <Brand />
        </div>

        <div className="rounded-2xl border border-gray-200/80 bg-white p-7 shadow-[0_24px_70px_-30px_rgb(0_0_0/0.35)] dark:border-slate-800 dark:bg-slate-900 dark:shadow-[0_24px_70px_-30px_rgb(0_0_0/0.9)]">
          <div className="mb-6">
            <div className="mb-4 flex size-10 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-gray-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              <LockKeyhole className="size-[18px]" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-white">
              Sign in
            </h1>
            <p className="mt-1.5 text-sm leading-5 text-gray-500 dark:text-slate-400">
              Enter your credentials to access {branding.name}.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-slate-300">
                Username
              </span>
              <input
                name="username"
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                required
                disabled={isSubmitting}
                className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 transition outline-none placeholder:text-gray-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:placeholder:text-slate-600 dark:focus:border-brand-500 dark:focus:ring-brand-900/60"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-slate-300">
                Password
              </span>
              <span className="relative block">
                <input
                  name="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                  disabled={isSubmitting}
                  className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 pr-10 text-sm text-gray-900 transition outline-none placeholder:text-gray-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:placeholder:text-slate-600 dark:focus:border-brand-500 dark:focus:ring-brand-900/60"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute top-0 right-0 flex size-10 items-center justify-center text-gray-400 transition hover:text-gray-700 dark:text-slate-500 dark:hover:text-slate-200"
                >
                  {showPassword ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </span>
            </label>

            {error ? (
              <p
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300"
              >
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting || !username || !password}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-gray-800 focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200 dark:focus-visible:ring-slate-500 dark:focus-visible:ring-offset-slate-900"
            >
              {isSubmitting ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : null}
              {isSubmitting ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </div>

        <p className="mt-5 text-center text-[11px] text-gray-400 dark:text-slate-600">
          Queuedash does not save credentials in local or session storage.
        </p>
      </div>
    </main>
  );
};
