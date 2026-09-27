import { RotateCw } from "lucide-react";
import { Component, type ReactNode } from "react";

import { Button } from "./Button";
import { ErrorCard } from "./ErrorCard";

type ErrorBoundaryProps = {
  children: ReactNode;
  /** A caught error is dropped when this changes: moving to another page
   *  leaves a crashed one behind instead of carrying its error along. */
  resetKey?: string;
};

type ErrorBoundaryState = { error: unknown };

/**
 * Without a boundary, one render error anywhere in a page unmounted the whole
 * dashboard and left the host page blank. This keeps the providers, the
 * themed root and the toaster mounted, and shows what went wrong in the
 * page's place.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error ?? new Error("Unknown error") };
  }

  componentDidUpdate(
    previousProps: ErrorBoundaryProps,
    previousState: ErrorBoundaryState,
  ) {
    // Only an error that was already showing: one caught by this very update
    // may have come from the page just navigated to, and resetting it would
    // render that page once more for nothing.
    if (
      previousState.error !== null &&
      this.state.error !== null &&
      previousProps.resetKey !== this.props.resetKey
    ) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;

    const detail = error instanceof Error ? error.message : String(error);
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <ErrorCard
          className="w-full max-w-md"
          title="This page could not be displayed"
          message={
            detail
              ? `The dashboard hit an error while rendering it: ${detail}`
              : "The dashboard hit an error while rendering it."
          }
          action={
            <Button
              size="sm"
              icon={<RotateCw className="size-3.5" />}
              label="Reload"
              onClick={() => window.location.reload()}
            />
          }
        />
      </div>
    );
  }
}
