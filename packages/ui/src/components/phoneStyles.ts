/**
 * Phone-only vocabulary (below `sm`). Each page's phone layout is a list of
 * rows rather than a bordered table, so the rows carry their own hairline.
 */

/**
 * The hairline between phone rows and around phone cards. A step darker than
 * CARD_BORDER: with only the 16px gutter beside it there is no card edge for
 * a row to sit against, so the line has to be seen on its own.
 */
export const PHONE_HAIRLINE = "border-gray-200/60 dark:border-slate-800/80";

/**
 * The same hairline as a row's own top border, only below `sm`: for rows a
 * desktop list also renders, where the list's divider does the job above.
 */
export const PHONE_ROW_LINE =
  "max-sm:border-t max-sm:border-gray-200/60 dark:max-sm:border-slate-800/80";

/** Thumb-sized selects below `sm`, where a tab's selects are its only controls. */
export const PHONE_SELECT =
  "max-sm:[&>button]:h-10 max-sm:[&>button]:rounded-[10px] max-sm:[&>button]:pr-3";
