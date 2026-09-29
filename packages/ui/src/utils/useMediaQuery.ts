import { useSyncExternalStore } from "react";

/** Tailwind's `max-sm:`, for the few things CSS alone can't switch. */
export const PHONE_MEDIA_QUERY = "(max-width: 639.98px)";

export const useMediaQuery = (query: string) =>
  useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
