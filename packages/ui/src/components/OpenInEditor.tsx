import { clsx } from "clsx";
import { ArrowRight, ArrowUpRight, Code2 } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import {
  Button as AriaButton,
  Dialog,
  DialogTrigger,
  Popover,
} from "react-aria-components";

import {
  type CodeLinks,
  CUSTOM_URL_PLACEHOLDER,
  EDITORS,
  type EditorId,
  getEditorLabel,
  getFrameUrl,
  guessPathPrefix,
  type PathMapping,
} from "../utils/codeLinks";
import type { StackFrame } from "../utils/stack";
import {
  FIELD_HINT,
  FIELD_LABEL,
  FOCUS_FIELD,
  FOCUS_RING,
  FOCUS_RING_DATA,
  INPUT_CLASS,
  OVERLAY_SURFACE,
  TEXT_MUTED,
} from "../utils/styles";
import { Button } from "./Button";
import { useQueuedash } from "./QueuedashProvider";
import { Select, type SelectOption } from "./Select";

export const EDITOR_OPTIONS: Array<SelectOption<EditorId>> = [
  ...EDITORS.map(({ id, label }) => ({ label, value: id })),
  { label: "Custom URL", value: "custom" },
];

const TEXT_LINK =
  "inline-flex shrink-0 items-center gap-1 rounded text-xs font-medium transition-colors duration-150";

const ICON_LINK =
  "flex size-6 items-center justify-center rounded-md text-gray-400 transition-colors duration-150 hover:bg-brand-50 hover:text-brand-700 active:bg-brand-100 dark:text-slate-500 dark:hover:bg-brand-950/50 dark:hover:text-brand-300";

const trimSlash = (path: string) => path.trim().replace(/\/+$/, "");

/** The mappings with `from` pointing at `to`, replacing an older entry for it. */
const withMapping = (
  mappings: readonly PathMapping[],
  from: string,
  to: string,
): PathMapping[] => {
  if (!trimSlash(from) || !trimSlash(to)) return [...mappings];
  return [
    ...mappings.filter(
      (mapping) => trimSlash(mapping.from) !== trimSlash(from),
    ),
    { from: trimSlash(from), to: trimSlash(to) },
  ];
};

const findMapping = (mappings: readonly PathMapping[], path: string) =>
  mappings
    .filter(({ from }) => {
      const prefix = trimSlash(from);
      return prefix && (path === prefix || path.startsWith(`${prefix}/`));
    })
    .sort((left, right) => right.from.length - left.from.length)[0];

/**
 * A stack frame's way into the code. Once an editor is chosen it is a plain
 * link to the file and line; before that it asks, from right here, which
 * editor and where the code lives - the question has an answer only in the
 * context of a real frame.
 */
export const OpenInEditor = ({
  frame,
  variant,
  className,
}: {
  frame: StackFrame;
  variant: "text" | "icon";
  /** Colours for the text variant, which sits on the failure card's tint. */
  className?: string;
}) => {
  const { codeLinks } = useQueuedash();
  // The icon variant keeps its grid cell either way.
  const empty = variant === "icon" ? <span aria-hidden="true" /> : null;
  if (codeLinks.editor === "off" || frame.isLibrary || frame.line === null) {
    return empty;
  }

  const location = `${frame.label}:${frame.line}`;
  const url = getFrameUrl(codeLinks, frame);
  if (!url)
    return (
      <EditorSetup frame={frame} variant={variant} className={className} />
    );

  const editor = getEditorLabel(codeLinks.editor);
  return variant === "text" ? (
    <a href={url} className={clsx(TEXT_LINK, className, FOCUS_RING)}>
      {/* A phone's frame line needs the room for the file path. */}
      <span className="max-sm:hidden">Open in {editor}</span>
      <span className="sm:hidden">Open</span>
      <ArrowUpRight aria-hidden="true" className="size-3" />
    </a>
  ) : (
    <a
      href={url}
      aria-label={`Open ${location} in ${editor}`}
      title={`Open ${location} in ${editor}`}
      className={clsx(ICON_LINK, FOCUS_RING)}
    >
      <ArrowUpRight aria-hidden="true" className="size-3.5" />
    </a>
  );
};

const EditorSetup = ({
  frame,
  variant,
  className,
}: {
  frame: StackFrame;
  variant: "text" | "icon";
  className?: string;
}) => {
  const { portalContainer } = useQueuedash();
  const location = `${frame.label}:${frame.line}`;

  return (
    <DialogTrigger>
      {variant === "text" ? (
        <AriaButton className={clsx(TEXT_LINK, className, FOCUS_RING_DATA)}>
          <Code2 aria-hidden="true" className="size-3" />
          <span className="max-sm:hidden">Open in editor</span>
          <span className="sm:hidden">Open</span>
        </AriaButton>
      ) : (
        <AriaButton
          aria-label={`Open ${location} in your editor`}
          className={clsx(ICON_LINK, FOCUS_RING_DATA)}
        >
          <ArrowUpRight aria-hidden="true" className="size-3.5" />
        </AriaButton>
      )}
      <Popover
        UNSTABLE_portalContainer={portalContainer ?? undefined}
        placement="bottom end"
        offset={8}
        className={clsx(
          "qd-popover w-[25rem] max-w-[calc(100vw-2rem)] outline-none",
          OVERLAY_SURFACE,
        )}
      >
        <Dialog aria-label="Open code in your editor" className="outline-none">
          {({ close }) => <EditorSetupForm frame={frame} onDone={close} />}
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
};

const EditorSetupForm = ({
  frame,
  onDone,
}: {
  frame: StackFrame;
  onDone: () => void;
}) => {
  const { codeLinks, setCodeLinks } = useQueuedash();
  const existing = findMapping(codeLinks.mappings, frame.path);
  const [editor, setEditor] = useState<EditorId>(
    codeLinks.editor && codeLinks.editor !== "off"
      ? codeLinks.editor
      : "vscode",
  );
  const [customUrl, setCustomUrl] = useState(codeLinks.customUrl);
  const [from, setFrom] = useState(
    existing?.from ?? guessPathPrefix(frame.path),
  );
  const [to, setTo] = useState(existing?.to ?? "");
  const toRef = useRef<HTMLInputElement | null>(null);
  const customUrlId = useId();
  const fromId = useId();
  const toId = useId();

  // What the reader has to supply is where the code is; the rest is guessed.
  // Paths that already look like this machine's need nothing, so focus stays
  // on the first control.
  const [needsFocus] = useState(from !== "" && to === "");
  useEffect(() => {
    if (needsFocus) toRef.current?.focus();
  }, [needsFocus]);

  const prefix = trimSlash(from);
  const matchesPrefix =
    prefix !== "" &&
    (frame.path === prefix || frame.path.startsWith(`${prefix}/`));
  const needsCheckout = prefix !== "" && trimSlash(to) === "";
  const next: CodeLinks = {
    ...codeLinks,
    editor,
    customUrl,
    mappings: withMapping(codeLinks.mappings, from, to),
    examplePath: frame.path,
  };
  const url = needsCheckout ? null : getFrameUrl(next, frame);

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!url) return;
    setCodeLinks(next);
    onDone();
    window.location.assign(url);
  };

  return (
    <form onSubmit={save} className="p-4">
      <p className="text-sm font-semibold text-gray-900 dark:text-white">
        Open code in your editor
      </p>
      <p className={clsx("mt-0.5 text-xs", TEXT_MUTED)}>
        Stack frames will open at the failing line. This is saved in this
        browser only.
      </p>

      <div className="mt-4 space-y-3.5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-gray-700 dark:text-slate-300">
            Editor
          </span>
          <Select
            ariaLabel="Editor"
            options={EDITOR_OPTIONS}
            value={editor}
            onChange={setEditor}
          />
        </div>

        {editor === "custom" ? (
          <div>
            <label htmlFor={customUrlId} className={FIELD_LABEL}>
              URL
            </label>
            <input
              id={customUrlId}
              value={customUrl}
              onChange={(event) => setCustomUrl(event.target.value)}
              placeholder={CUSTOM_URL_PLACEHOLDER}
              spellCheck={false}
              className={clsx(INPUT_CLASS, FOCUS_FIELD, "font-mono text-xs")}
            />
            <p className={clsx("mt-1.5", FIELD_HINT)}>
              {"{path}"}, {"{line}"} and {"{column}"} are filled in.
            </p>
          </div>
        ) : null}

        <div>
          <span className={FIELD_LABEL}>Path in this stack</span>
          <p className="rounded-lg border border-dashed border-gray-200 px-2.5 py-1.5 font-mono text-xs leading-[18px] break-all text-gray-600 dark:border-slate-700 dark:text-slate-300">
            {matchesPrefix ? (
              <>
                <span className="rounded bg-brand-50 px-0.5 text-brand-700 dark:bg-brand-950/50 dark:text-brand-300">
                  {frame.path.slice(0, prefix.length)}
                </span>
                {frame.path.slice(prefix.length)}
              </>
            ) : (
              frame.path
            )}
          </p>
        </div>

        <div className="grid grid-cols-[8rem_14px_minmax(0,1fr)] items-end gap-x-2">
          <div>
            <label htmlFor={fromId} className={FIELD_LABEL}>
              Replace
            </label>
            <input
              id={fromId}
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              placeholder="/app"
              spellCheck={false}
              className={clsx(
                INPUT_CLASS,
                FOCUS_FIELD,
                "font-mono text-[13px]",
              )}
            />
          </div>
          <ArrowRight
            aria-hidden="true"
            className="mb-[11px] size-3.5 text-gray-400 dark:text-slate-500"
          />
          <div>
            <label htmlFor={toId} className={FIELD_LABEL}>
              With your checkout
            </label>
            <input
              id={toId}
              ref={toRef}
              value={to}
              onChange={(event) => setTo(event.target.value)}
              placeholder="/Users/you/code/app"
              spellCheck={false}
              className={clsx(
                INPUT_CLASS,
                FOCUS_FIELD,
                "font-mono text-[13px]",
              )}
            />
          </div>
        </div>

        <p
          className={clsx(
            "font-mono text-[11px] leading-4 break-all",
            TEXT_MUTED,
          )}
        >
          {url
            ? `Opens ${url}`
            : needsCheckout
              ? `Where is ${prefix} on this machine?`
              : "Add the editor's URL to open frames in it."}
        </p>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        <Button label="Cancel" onClick={onDone} />
        <Button
          type="submit"
          label="Save and open"
          variant="filled"
          colorScheme="brand"
          disabled={!url}
        />
      </div>
    </form>
  );
};
