import { clsx } from "clsx";
import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

import { FOCUS_RING, HIT_AREA } from "../utils/styles";

/** A 12px copy glyph for an identifier beside it; confirms with a check. */
export const CopyButton = ({
  value,
  label,
}: {
  value: string;
  label: string;
}) => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard access is unavailable outside secure contexts.
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? `${label} copied` : `Copy ${label}`}
        className={clsx(
          "shrink-0 rounded transition-colors duration-150 hover:text-gray-700 active:text-gray-900 dark:hover:text-slate-300 dark:active:text-white",
          HIT_AREA,
          FOCUS_RING,
        )}
      >
        {copied ? (
          <Check className="size-3 text-green-600 dark:text-green-400" />
        ) : (
          <Copy className="size-3" />
        )}
      </button>
      <span role="status" className="sr-only">
        {copied ? `${label} copied` : ""}
      </span>
    </>
  );
};
