import { clsx } from "clsx";
import { Eye, EyeOff, LoaderCircle, LockKeyhole } from "lucide-react";
import { type FormEvent, useId, useState } from "react";

import {
  FIELD_LABEL,
  FOCUS_FIELD,
  FOCUS_RING,
  INPUT_CLASS,
} from "../utils/styles";
import { Button } from "./Button";
import { QueuedashIcon } from "./Logo";
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
        <QueuedashIcon className="size-9 shrink-0" />
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
  notice,
  onAuthenticated,
}: {
  authBaseUrl: string;
  /** Why the sign-in form appeared, e.g. after a session expired. */
  notice?: string;
  onAuthenticated: () => void;
}) => {
  const { branding } = useQueuedash();
  const errorId = useId();
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

          {notice ? (
            <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-300">
              {notice}
            </p>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Above the fields: an error appearing between the password and
                the submit button would move the button out from under the
                cursor at the moment the user goes to retry. */}
            {error ? (
              <p
                id={errorId}
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300"
              >
                {error}
              </p>
            ) : null}

            <label className="block">
              <span className={FIELD_LABEL}>Username</span>
              <input
                name="username"
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                // oxlint-disable-next-line jsx-a11y/no-autofocus -- The form is the only thing on the page.
                autoFocus
                required
                disabled={isSubmitting}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                className={clsx(INPUT_CLASS, FOCUS_FIELD)}
              />
            </label>

            <label className="block">
              <span className={FIELD_LABEL}>Password</span>
              <span className="relative block">
                <input
                  name="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                  disabled={isSubmitting}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? errorId : undefined}
                  className={clsx(INPUT_CLASS, FOCUS_FIELD, "pr-9")}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  className={clsx(
                    "absolute top-0 right-0 flex size-9 items-center justify-center rounded-lg text-gray-500 transition-colors duration-150 hover:text-gray-900 active:text-gray-700 dark:text-slate-400 dark:hover:text-white dark:active:text-slate-300",
                    FOCUS_RING,
                  )}
                >
                  {showPassword ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </span>
            </label>

            <Button
              type="submit"
              variant="filled"
              colorScheme="brand"
              size="lg"
              className="w-full"
              isLoading={isSubmitting}
              label={isSubmitting ? "Signing in…" : "Sign in"}
            />
          </form>
        </div>

        <p className="mt-5 text-center text-[11px] text-gray-400 dark:text-slate-600">
          Queuedash does not save credentials in local or session storage.
        </p>
      </div>
    </main>
  );
};
