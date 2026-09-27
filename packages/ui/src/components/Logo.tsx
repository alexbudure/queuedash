import { useId } from "react";

/**
 * The Queuedash mark: a Q whose tail is a dash. Both components are decorative
 * and always sit beside the product name, so they carry no accessible name.
 *
 * Geometry lives in a 64-unit box. The tile is an Apple-style squircle
 * (a superellipse, n = 5) rather than a rounded rect. assets/icon.svg and the
 * inline favicon in @queuedash/api are generated from the same numbers - keep
 * them in step.
 */

const TILE_PATH =
  "M64 32L63.9 46.2L63.6 50.6L63 53.8L62.2 56.3L61.2 58.2L59.9 59.9L58.2 61.2L56.3 62.2L53.8 63L50.6 63.6L46.2 63.9L32 64L17.8 63.9L13.4 63.6L10.2 63L7.7 62.2L5.8 61.2L4.1 59.9L2.8 58.2L1.8 56.3L1 53.8L0.4 50.6L0.1 46.2L0 32L0.1 17.8L0.4 13.4L1 10.2L1.8 7.7L2.8 5.8L4.1 4.1L5.8 2.8L7.7 1.8L10.2 1L13.4 0.4L17.8 0.1L32 0L46.2 0.1L50.6 0.4L53.8 1L56.3 1.8L58.2 2.8L59.9 4.1L61.2 5.8L62.2 7.7L63 10.2L63.6 13.4L63.9 17.8Z";

const RIM_PATH =
  "M63.5 32L63.4 46L63.1 50.3L62.5 53.5L61.7 55.9L60.7 57.8L59.4 59.4L57.8 60.7L55.9 61.7L53.5 62.5L50.3 63.1L46 63.4L32 63.5L18 63.4L13.7 63.1L10.5 62.5L8.1 61.7L6.2 60.7L4.6 59.4L3.3 57.8L2.3 55.9L1.5 53.5L0.9 50.3L0.6 46L0.5 32L0.6 18L0.9 13.7L1.5 10.5L2.3 8.1L3.3 6.2L4.6 4.6L6.2 3.3L8.1 2.3L10.5 1.5L13.7 0.9L18 0.6L32 0.5L46 0.6L50.3 0.9L53.5 1.5L55.9 2.3L57.8 3.3L59.4 4.6L60.7 6.2L61.7 8.1L62.5 10.5L63.1 13.7L63.4 18Z";

const Glyph = () => (
  <>
    <circle
      cx="28.5"
      cy="31"
      r="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="7.5"
    />
    <path
      d="M29 46H51"
      fill="none"
      stroke="currentColor"
      strokeWidth="7.5"
      strokeLinecap="round"
    />
  </>
);

/** The glyph alone, in the current text colour. */
export const QueuedashMark = ({ className }: { className?: string }) => (
  <svg aria-hidden="true" viewBox="0 0 64 64" className={className}>
    <Glyph />
  </svg>
);

/** The glyph on its gradient tile - the app icon. */
export const QueuedashIcon = ({ className }: { className?: string }) => {
  // Two instances mount at once (desktop sidebar and mobile header), so the
  // gradient ids cannot be static.
  const id = useId();
  const fillId = `${id}-fill`;
  const sheenId = `${id}-sheen`;

  return (
    <svg aria-hidden="true" viewBox="0 0 64 64" className={className}>
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6b78ff" />
          <stop offset="1" stopColor="#3040d8" />
        </linearGradient>
        <radialGradient id={sheenId} cx="0.3" cy="0" r="0.9">
          <stop offset="0" stopColor="#fff" stopOpacity="0.22" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path d={TILE_PATH} fill={`url(#${fillId})`} />
      <path d={TILE_PATH} fill={`url(#${sheenId})`} />
      <path d={RIM_PATH} fill="none" stroke="#fff" strokeOpacity="0.18" />
      <g className="text-white">
        <Glyph />
      </g>
    </svg>
  );
};
