/**
 * Shared class vocabulary.
 *
 * Before this file the dashboard had six focus-ring treatments (gray, two
 * brand steps, emerald, violet, and none), five text-input treatments at three
 * heights, five uppercase section-label styles, and four card borders for one
 * role. Anything that appears more than twice and means the same thing each
 * time belongs here.
 *
 * Convention throughout the app: light mode uses the warm `gray-*` ramp, dark
 * mode uses the neutral `slate-*` ramp.
 */

/**
 * The focus ring. One ring for buttons, rows, checkboxes and menu items.
 *
 * `ring-offset-slate-900` is correct for dark: every surface that hosts a
 * focusable control renders on `dark:bg-slate-900`.
 */
export const FOCUS_RING =
  "outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-brand-600 dark:focus-visible:ring-offset-slate-900";

/**
 * Same ring for controls driven by react-aria, which exposes focus state as a
 * data attribute rather than the CSS pseudo-class.
 */
export const FOCUS_RING_DATA =
  "outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-brand-400 data-[focus-visible]:ring-offset-2 data-[focus-visible]:ring-offset-white dark:data-[focus-visible]:ring-brand-600 dark:data-[focus-visible]:ring-offset-slate-900";

/**
 * For controls that sit flush inside a bordered container (the status tabs,
 * table rows) where an outset ring would be clipped by the parent.
 */
export const FOCUS_RING_INSET =
  "outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-inset";

export const FOCUS_RING_INSET_DATA =
  "outline-none data-[focus-visible]:z-10 data-[focus-visible]:ring-2 data-[focus-visible]:ring-brand-400 data-[focus-visible]:ring-inset";

/**
 * The field halo - a deliberately different convention from the button ring,
 * because a focused text field should read as "you are typing here" rather
 * than "this is selected".
 */
export const FOCUS_FIELD =
  "outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:focus:border-brand-600 dark:focus:ring-brand-950";

/**
 * Standard 36px text input. Pairs with Button `size="lg"` and Select.
 *
 * Recessed rather than same-as-card: the surrounding surface is `bg-white` /
 * `dark:bg-slate-900`, so a field painted the same colour read as loose text
 * with a hairline round it. A step down plus a stronger border makes the
 * control legible as a control before it's focused.
 */
export const INPUT_CLASS =
  "h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 transition-colors placeholder:text-gray-500 hover:border-gray-300 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:placeholder:text-slate-400 dark:hover:border-slate-600";

/** Compact 32px variant for dense chrome, e.g. the sidebar queue filter. */
export const INPUT_CLASS_COMPACT =
  "h-8 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 transition-colors placeholder:text-gray-500 hover:border-gray-300 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:placeholder:text-slate-400 dark:hover:border-slate-600";

/** Multi-line field. Same skin as INPUT_CLASS without the fixed height. */
export const TEXTAREA_CLASS =
  "w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 transition-colors placeholder:text-gray-500 hover:border-gray-300 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:placeholder:text-slate-400 dark:hover:border-slate-600";

/** The one uppercase section label. */
export const SECTION_LABEL =
  "text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-slate-400";

/** The one field label. */
export const FIELD_LABEL =
  "mb-1.5 block text-xs font-medium text-gray-700 dark:text-slate-300";

/**
 * Helper text under a field. Carries no margin: hint and error swap places in
 * the same slot, and with no tailwind-merge a margin baked in here could not be
 * overridden at the call site. The wrapper owns the gap.
 */
export const FIELD_HINT = "text-xs text-gray-500 dark:text-slate-400";

/** Inline validation message under a field. Marginless, like FIELD_HINT. */
export const FIELD_ERROR = "text-xs text-red-600 dark:text-red-400";

/** The one card border. */
export const CARD_BORDER = "border border-gray-100/60 dark:border-slate-800/60";

/** A boxed section: border plus radius. */
export const CARD = `rounded-xl ${CARD_BORDER}`;

/** Dock for a table's floating bar, riding the bottom of the viewport. */
export const FLOATING_BAR_DOCK =
  "pointer-events-none sticky bottom-0 flex w-full items-center justify-center pb-5";

/**
 * The one overlay surface. In dark mode popovers used to be the same
 * `slate-900` as the card behind them - a 1.00:1 contrast with only a
 * near-black shadow to separate them. `slate-800` plus a light hairline gives
 * overlays a real elevation step.
 */
export const OVERLAY_SURFACE =
  "rounded-xl border border-gray-200 bg-white shadow-lg dark:border-transparent dark:bg-slate-800 dark:ring-1 dark:ring-white/10 dark:shadow-black/60";

/** Rows inside a popover/menu. */
export const OVERLAY_ITEM =
  "flex h-9 cursor-pointer items-center gap-2 rounded-lg px-2.5 text-sm outline-none select-none";

/** Secondary text. Replaces `text-gray-400 dark:text-slate-500`, which failed
 *  4.5:1 in both themes. */
export const TEXT_MUTED = "text-gray-500 dark:text-slate-400";

/** Tertiary text - only for decoration sitting beside a legible label. */
export const TEXT_FAINT = "text-gray-400 dark:text-slate-500";

/**
 * Enlarges a small control's hit area to ~32px without changing its painted
 * size. WCAG 2.2 AA asks for 24x24; the row checkboxes render at 16px.
 */
export const HIT_AREA =
  "relative before:absolute before:-inset-2 before:content-['']";

/** The z-scale for the layers that stack *above* react-aria's inline
 *  `zIndex: 100000` on positioned overlays - anything below that in a class is
 *  inert, which is why only these two need a shared constant. */
export const Z_INDEX = {
  tooltip: 100001,
  dialog: 100002,
} as const;
