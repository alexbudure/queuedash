/**
 * The single source of truth for how JSON renders across the dashboard - both
 * in the Monaco editors (Add job / Add scheduler) and in the read-only
 * react-json-tree views (job payload, return value, scheduler template).
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
const GRAY_300 = "#d0d2d5";
const GRAY_400 = "#9ea1a6";
const GRAY_500 = "#6e7278";
const GRAY_700 = "#3f4349";
const GRAY_900 = "#1a1d21";
const GRAY_950 = "#101215";

const SLATE_100 = "#eff0f1";
const SLATE_200 = "#e3e4e6";
const SLATE_400 = "#9fa1a5";
const SLATE_500 = "#717378";
const SLATE_600 = "#4f5257";
const SLATE_800 = "#24262b";
const SLATE_900 = "#15171b";
const SLATE_950 = "#080a0d";

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

export const MONACO_LIGHT_THEME = "queuedash-json-light";
export const MONACO_DARK_THEME = "queuedash-json-dark";

/** Monaco wants hex without the leading `#` for token rules. */
const raw = (hex: string) => hex.replace("#", "");

type MonacoThemeData = {
  base: "vs" | "vs-dark";
  inherit: boolean;
  rules: { token: string; foreground: string }[];
  colors: Record<string, string>;
};

export const monacoLightTheme: MonacoThemeData = {
  base: "vs",
  inherit: true,
  rules: [
    { token: "string.key.json", foreground: raw(GRAY_700) },
    { token: "string.value.json", foreground: raw(GREEN_600) },
    { token: "number", foreground: raw(BRAND_600) },
    { token: "keyword", foreground: raw(PURPLE_600) },
  ],
  colors: {
    "editor.background": GRAY_50,
    "editor.foreground": GRAY_900,
    "editorLineNumber.foreground": GRAY_400,
    "editorLineNumber.activeForeground": GRAY_500,
    "editorCursor.foreground": GRAY_900,
    "editor.selectionBackground": "#cbd8fe",
    "editor.lineHighlightBackground": GRAY_100,
    "editorIndentGuide.background": GRAY_200,
    "editorIndentGuide.activeBackground": GRAY_300,
    "editorWidget.background": GRAY_50,
    "editorError.foreground": RED_600,
    "editorWarning.foreground": AMBER_600,
  },
};

export const monacoDarkTheme: MonacoThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "string.key.json", foreground: raw(SLATE_400) },
    { token: "string.value.json", foreground: raw(GREEN_400) },
    { token: "number", foreground: raw(BRAND_400) },
    { token: "keyword", foreground: raw(PURPLE_400) },
  ],
  colors: {
    "editor.background": SLATE_900,
    "editor.foreground": SLATE_200,
    "editorLineNumber.foreground": SLATE_600,
    "editorLineNumber.activeForeground": SLATE_400,
    "editorCursor.foreground": SLATE_100,
    "editor.selectionBackground": "#2735a6",
    "editor.lineHighlightBackground": SLATE_950,
    "editorIndentGuide.background": SLATE_800,
    "editorIndentGuide.activeBackground": SLATE_600,
    "editorWidget.background": SLATE_900,
    "editorError.foreground": RED_400,
    "editorWarning.foreground": AMBER_400,
  },
};

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
