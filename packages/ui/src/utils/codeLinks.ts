import type { StackFrame } from "./stack";

export type EditorId =
  | "vscode"
  | "cursor"
  | "windsurf"
  | "zed"
  | "webstorm"
  | "idea"
  | "custom";

/** A folder as the workers see it, and the same folder on this machine. */
export type PathMapping = { from: string; to: string };

/**
 * How stack frames open in an editor. Kept per browser: everyone's checkout
 * lives somewhere else, so there is no server default.
 */
export type CodeLinks = {
  /** null until chosen, which is when the panel offers to set it up; "off"
   *  hides the links for good. */
  editor: EditorId | "off" | null;
  /** For "custom": a URL with {path}, {line} and {column} in it. */
  customUrl: string;
  mappings: PathMapping[];
  /** The last frame set up from, which Settings previews. */
  examplePath: string | null;
};

export const EMPTY_CODE_LINKS: CodeLinks = {
  editor: null,
  customUrl: "",
  mappings: [],
  examplePath: null,
};

export const EDITORS: ReadonlyArray<{
  id: Exclude<EditorId, "custom">;
  label: string;
  url: string;
}> = [
  {
    id: "vscode",
    label: "VS Code",
    url: "vscode://file{path}:{line}:{column}",
  },
  { id: "cursor", label: "Cursor", url: "cursor://file{path}:{line}:{column}" },
  {
    id: "windsurf",
    label: "Windsurf",
    url: "windsurf://file{path}:{line}:{column}",
  },
  { id: "zed", label: "Zed", url: "zed://file{path}:{line}:{column}" },
  {
    id: "webstorm",
    label: "WebStorm",
    url: "webstorm://open?file={path}&line={line}&column={column}",
  },
  {
    id: "idea",
    label: "IntelliJ IDEA",
    url: "idea://open?file={path}&line={line}&column={column}",
  },
];

export const CUSTOM_URL_PLACEHOLDER = "myeditor://open?file={path}&line={line}";

export const getEditorLabel = (editor: CodeLinks["editor"]) =>
  editor === "custom"
    ? "your editor"
    : (EDITORS.find(({ id }) => id === editor)?.label ?? "your editor");

const EDITOR_IDS = new Set<string>([
  ...EDITORS.map(({ id }) => id),
  "custom",
  "off",
]);

const trimSlash = (path: string) =>
  path.length > 1 ? path.replace(/\/+$/, "") : path;

/** A stored value, whatever state it was left in, as a usable one. */
export const parseCodeLinks = (value: unknown): CodeLinks => {
  if (!value || typeof value !== "object") return EMPTY_CODE_LINKS;
  const stored = value as Record<string, unknown>;
  return {
    editor:
      typeof stored.editor === "string" && EDITOR_IDS.has(stored.editor)
        ? (stored.editor as CodeLinks["editor"])
        : null,
    customUrl: typeof stored.customUrl === "string" ? stored.customUrl : "",
    mappings: Array.isArray(stored.mappings)
      ? stored.mappings.flatMap((mapping) =>
          mapping &&
          typeof mapping === "object" &&
          typeof (mapping as PathMapping).from === "string" &&
          typeof (mapping as PathMapping).to === "string"
            ? [
                {
                  from: (mapping as PathMapping).from,
                  to: (mapping as PathMapping).to,
                },
              ]
            : [],
        )
      : [],
    examplePath:
      typeof stored.examplePath === "string" ? stored.examplePath : null,
  };
};

/** The path on this machine: the longest mapped folder the path is in wins. */
export const mapPath = (path: string, mappings: readonly PathMapping[]) => {
  let best: PathMapping | null = null;
  for (const mapping of mappings) {
    const from = trimSlash(mapping.from.trim());
    if (!from || !mapping.to.trim()) continue;
    if (path !== from && !path.startsWith(`${from}/`)) continue;
    if (!best || from.length > trimSlash(best.from.trim()).length) {
      best = mapping;
    }
  }
  if (!best) return path;
  const from = trimSlash(best.from.trim());
  return `${trimSlash(best.to.trim())}${path.slice(from.length)}`;
};

/** The URL template for the chosen editor, or null when links are off. */
const getUrlTemplate = (links: CodeLinks): string | null => {
  if (links.editor === null || links.editor === "off") return null;
  if (links.editor === "custom") return links.customUrl.trim() || null;
  return EDITORS.find(({ id }) => id === links.editor)?.url ?? null;
};

export const fillUrlTemplate = (
  template: string,
  path: string,
  line: number,
  column: number,
) => {
  // Inside a query string the path is one parameter; after `file` it is the
  // rest of the URL's path, which must start with a slash (C:/ included).
  const queryAt = template.indexOf("?");
  const pathAt = template.indexOf("{path}");
  const inQuery = queryAt !== -1 && queryAt < pathAt;
  const encodedPath = inQuery
    ? encodeURIComponent(path)
    : encodeURI(path.startsWith("/") ? path : `/${path}`);
  return template
    .replaceAll("{path}", encodedPath)
    .replaceAll("{line}", String(line))
    .replaceAll("{column}", String(column));
};

/** Where a frame opens, or null when it can't: links off, or no file to open. */
export const getFrameUrl = (links: CodeLinks, frame: StackFrame) => {
  const template = getUrlTemplate(links);
  if (!template || frame.isLibrary || frame.line === null) return null;
  return fillUrlTemplate(
    template,
    mapPath(frame.path, links.mappings),
    frame.line,
    frame.column ?? 1,
  );
};

const CONTAINER_ROOTS = [
  "/usr/src/app",
  "/home/node/app",
  "/opt/app",
  "/srv/app",
  "/workspace",
  "/app",
  "/code",
];

const SOURCE_FOLDERS = [
  "/src/",
  "/dist/",
  "/lib/",
  "/build/",
  "/apps/",
  "/packages/",
];

/**
 * A first guess at the part of a worker's path to replace: a usual container
 * root, else everything before the source folder. Paths that already look like
 * a laptop's need no mapping, so the guess is empty.
 */
export const guessPathPrefix = (path: string) => {
  if (/^(\/Users\/|[A-Za-z]:\/Users\/)/.test(path)) return "";
  const root = CONTAINER_ROOTS.find(
    (candidate) => path === candidate || path.startsWith(`${candidate}/`),
  );
  if (root) return root;
  if (/^\/home\/[^/]+\//.test(path)) return "";
  const cut = SOURCE_FOLDERS.map((folder) => path.indexOf(folder))
    .filter((index) => index > 0)
    .sort((left, right) => left - right)[0];
  if (cut !== undefined) return path.slice(0, cut);
  const segments = path.split("/");
  return segments.slice(0, Math.max(segments.length - 2, 1)).join("/");
};
