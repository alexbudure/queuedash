/**
 * How the read-only react-json-tree views (job payload, return value,
 * scheduler template) render JSON. The editors in Add job and Add scheduler
 * take the same colours from global.css (`.qd-cm-*`).
 *
 * These used to be four separate literals keyed to stock Tailwind slate, which
 * is a *blue* neutral (#0f172a). This project's slate ramp is only faintly
 * cool (#15171b), so every JSON surface rendered as a navy slab inside a
 * near-black app - three of them stacked in a single job panel.
 *
 * Every value below is a token from styles/global.css.
 */

// --- neutrals -------------------------------------------------------------
const GRAY_50 = "#f8f9fa";
const GRAY_100 = "#f2f3f5";
const GRAY_200 = "#e3e5e8";
const GRAY_400 = "#9ea1a6";
const GRAY_500 = "#6e7278";
const GRAY_900 = "#1a1d21";
const GRAY_950 = "#101215";

const SLATE_100 = "#eff0f1";
const SLATE_200 = "#e3e4e6";
const SLATE_400 = "#9fa1a5";
const SLATE_500 = "#717378";
const SLATE_600 = "#4f5257";
const SLATE_800 = "#24262b";
const SLATE_900 = "#15171b";

// --- accents --------------------------------------------------------------
const RED_400 = "#fb6e6e";
const RED_600 = "#dd2c20";
const ORANGE_400 = "#fb923c";
const ORANGE_600 = "#ea580c";
const AMBER_400 = "#ffbc24";
const AMBER_600 = "#d97602";
const GREEN_400 = "#4ade80";
const GREEN_600 = "#16a34a";
const CYAN_400 = "#22d3ee";
const CYAN_600 = "#0891b2";
const BRAND_400 = "#7895fd";
const BRAND_600 = "#3e53ef";
const PURPLE_400 = "#c084fc";
const PURPLE_600 = "#9333ea";

const jsonTreeLightTheme = {
  scheme: "queuedash-light",
  author: "queuedash",
  base00: GRAY_50,
  base01: GRAY_100,
  base02: GRAY_200,
  base03: GRAY_500,
  base04: GRAY_400,
  base05: GRAY_900,
  base06: GRAY_950,
  base07: "#000000",
  base08: RED_600,
  base09: ORANGE_600,
  base0A: AMBER_600,
  base0B: GREEN_600,
  base0C: CYAN_600,
  base0D: BRAND_600,
  base0E: PURPLE_600,
  base0F: "#be185d",
};

const jsonTreeDarkTheme = {
  scheme: "queuedash-dark",
  author: "queuedash",
  base00: SLATE_900,
  base01: SLATE_800,
  base02: SLATE_600,
  base03: SLATE_500,
  base04: SLATE_400,
  base05: SLATE_200,
  base06: SLATE_100,
  base07: "#ffffff",
  base08: RED_400,
  base09: ORANGE_400,
  base0A: AMBER_400,
  base0B: GREEN_400,
  base0C: CYAN_400,
  base0D: BRAND_400,
  base0E: PURPLE_400,
  base0F: "#f472b6",
};

export const getJsonTreeTheme = (isDark: boolean) =>
  isDark ? jsonTreeDarkTheme : jsonTreeLightTheme;
