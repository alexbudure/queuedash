import MonacoEditor, { loader, type Monaco } from "@monaco-editor/react";
import { clsx } from "clsx";
import type { editor } from "monaco-editor";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import {
  normalizeJSONEditorValue,
  type JSONEditorRootType,
  type JSONEditorValidationState,
} from "../utils/jsonEditor";
import {
  MONACO_DARK_THEME,
  MONACO_LIGHT_THEME,
  monacoDarkTheme,
  monacoLightTheme,
} from "../utils/jsonTheme";
import {
  FIELD_ERROR,
  FIELD_HINT,
  FOCUS_FIELD,
  TEXT_MUTED,
  TEXTAREA_CLASS,
} from "../utils/styles";
import { useQueuedash } from "./QueuedashProvider";
import { Skeleton } from "./Skeleton";

type JSONEditorProps = {
  value: string;
  onChange: (value: string) => void;
  label: string;
  required?: boolean;
  rootType?: JSONEditorRootType;
  helperText?: string;
  /** Minimum height; the editor grows with its content up to `maxHeight`. */
  height?: string;
  maxHeight?: string;
  className?: string;
  autoFocus?: boolean;
  /** Parent flips this on a failed submit so untouched fields still report. */
  showErrors?: boolean;
  /** Bound to Cmd/Ctrl+Enter. Plain Enter never submits. */
  onSubmit?: () => void;
  onValidationChange?: (state: JSONEditorValidationState) => void;
};

const MONACO_MARKER_ERROR_SEVERITY = 8;
const DEFAULT_MAX_HEIGHT_PX = 520;

const parsePx = (value: string | undefined, fallback: number) => {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
};

const defineEditorThemes = (monaco: Monaco) => {
  monaco.editor.defineTheme(MONACO_LIGHT_THEME, monacoLightTheme);
  monaco.editor.defineTheme(MONACO_DARK_THEME, monacoDarkTheme);
};

const getSyntaxErrorMessage = (markers: editor.IMarker[]) => {
  const errorMarker = markers.find(
    (marker) => marker.severity === MONACO_MARKER_ERROR_SEVERITY,
  );

  return errorMarker?.message || null;
};

export const JSONEditor = ({
  value,
  onChange,
  label,
  required = false,
  rootType = "any",
  helperText,
  height = "240px",
  maxHeight,
  className,
  autoFocus = false,
  showErrors = false,
  onSubmit,
  onValidationChange,
}: JSONEditorProps) => {
  const { isDark } = useQueuedash();
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const normalizeValueRef = useRef<() => void>(() => undefined);
  const submitRef = useRef<(() => void) | undefined>(onSubmit);
  submitRef.current = onSubmit;
  const [syntaxError, setSyntaxError] = useState<string | null>(null);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const [isTouched, setIsTouched] = useState(false);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const [monacoStatus, setMonacoStatus] = useState<
    "loading" | "ready" | "failed"
  >("loading");
  const editorInputId = useId();
  const labelId = useId();
  const helperTextId = useId();
  const errorMessageId = useId();

  const latestValueRef = useRef(value);
  latestValueRef.current = value;

  const latestConfigRef = useRef({
    label,
    required,
    rootType,
  });
  latestConfigRef.current = {
    label,
    required,
    rootType,
  };

  const minHeightPx = parsePx(height, 240);
  const maxHeightPx = Math.max(
    minHeightPx,
    parsePx(maxHeight, DEFAULT_MAX_HEIGHT_PX),
  );
  const editorHeightPx =
    contentHeight === null
      ? minHeightPx
      : Math.min(Math.max(contentHeight, minHeightPx), maxHeightPx);

  const normalizedValidationState = useMemo(() => {
    return normalizeJSONEditorValue({
      value,
      label,
      required,
      rootType,
    });
  }, [label, required, rootType, value]);

  const validationState = useMemo(() => {
    if (!value.trim() || normalizedValidationState.isValid || !syntaxError) {
      return normalizedValidationState;
    }

    return {
      isValid: false,
      errorMessage: syntaxError,
    } satisfies JSONEditorValidationState;
  }, [normalizedValidationState, syntaxError, value]);

  // Half-typed JSON is not a mistake yet, so errors stay hidden until the field
  // has been left or the parent has attempted a submit. Validity itself is
  // still reported live, so the submit button disables from the first keystroke.
  const displayedError =
    isTouched || showErrors ? validationState.errorMessage : null;

  normalizeValueRef.current = () => {
    const normalizedState = normalizeJSONEditorValue({
      value: latestValueRef.current,
      label: latestConfigRef.current.label,
      required: latestConfigRef.current.required,
      rootType: latestConfigRef.current.rootType,
    });

    if (
      !normalizedState.isValid ||
      normalizedState.normalizedValue === undefined
    ) {
      return;
    }

    if (normalizedState.normalizedValue !== latestValueRef.current) {
      onChange(normalizedState.normalizedValue);
    }
  };

  useEffect(() => {
    onValidationChange?.(validationState);
  }, [onValidationChange, validationState]);

  // Monaco is fetched from a CDN at runtime. Behind a VPN or a CSP that blocks
  // third-party scripts that request never resolves, so the form falls back to
  // a plain textarea rather than an empty box under an enabled Add button.
  useEffect(() => {
    let isActive = true;

    loader.init().then(
      () => {
        if (isActive) setMonacoStatus("ready");
      },
      () => {
        if (isActive) setMonacoStatus("failed");
      },
    );

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!isEditorReady) {
      return;
    }

    const editorTextarea = editorRef.current
      ?.getDomNode()
      ?.querySelector("textarea");

    if (!editorTextarea) {
      return;
    }

    editorTextarea.setAttribute("id", editorInputId);
    editorTextarea.setAttribute("aria-labelledby", labelId);

    if (displayedError) {
      editorTextarea.setAttribute("aria-invalid", "true");
    } else {
      editorTextarea.removeAttribute("aria-invalid");
    }

    const describedBy = displayedError
      ? errorMessageId
      : helperText
        ? helperTextId
        : null;

    if (describedBy) {
      editorTextarea.setAttribute("aria-describedby", describedBy);
      return;
    }

    editorTextarea.removeAttribute("aria-describedby");
  }, [
    displayedError,
    editorInputId,
    errorMessageId,
    helperText,
    helperTextId,
    isEditorReady,
    labelId,
  ]);

  useEffect(() => {
    if (!isEditorReady || !monacoRef.current) {
      return;
    }

    monacoRef.current.editor.setTheme(
      isDark ? MONACO_DARK_THEME : MONACO_LIGHT_THEME,
    );
  }, [isDark, isEditorReady]);

  const describedBy = displayedError
    ? errorMessageId
    : helperText
      ? helperTextId
      : undefined;

  return (
    <div className={clsx("space-y-1.5", className)}>
      <div
        className={clsx(
          "overflow-hidden rounded-xl border shadow-sm",
          displayedError
            ? "border-red-300 dark:border-red-500/60"
            : "border-gray-200 dark:border-slate-700",
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 bg-gray-50/80 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/30">
          <label
            className={clsx("cursor-text text-xs", TEXT_MUTED)}
            htmlFor={editorInputId}
            id={labelId}
            onMouseDown={(event) => {
              event.preventDefault();
              editorRef.current?.focus();
            }}
          >
            {label}
            {required ? (
              <span className="ml-1 text-red-500 dark:text-red-400">*</span>
            ) : null}
          </label>

          <span className="rounded-full bg-gray-100 px-2 py-0.5 font-mono text-[11px] tracking-[0.18em] text-gray-500 uppercase dark:bg-slate-800 dark:text-slate-400">
            JSON
          </span>
        </div>

        {monacoStatus === "failed" ? (
          <div className="space-y-2 bg-white p-3 dark:bg-slate-900">
            <p className={clsx("text-xs", TEXT_MUTED)}>
              The code editor could not be loaded, so this field is a plain text
              box. JSON is still validated and normalized.
            </p>
            <textarea
              id={editorInputId}
              aria-labelledby={labelId}
              aria-invalid={displayedError ? true : undefined}
              aria-describedby={describedBy}
              autoFocus={autoFocus}
              spellCheck={false}
              className={clsx(
                TEXTAREA_CLASS,
                FOCUS_FIELD,
                "resize-y font-mono text-xs",
              )}
              style={{ minHeight: minHeightPx, maxHeight: maxHeightPx }}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              onBlur={() => {
                setIsTouched(true);
                normalizeValueRef.current();
              }}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  submitRef.current?.();
                }
              }}
            />
          </div>
        ) : (
          <div className="bg-white/80 dark:bg-slate-900/80">
            <MonacoEditor
              height={editorHeightPx}
              language="json"
              value={value}
              loading={
                <div className="w-full px-3 py-3">
                  <Skeleton className="h-3 w-1/3 rounded" />
                  <Skeleton className="mt-2 h-3 w-2/3 rounded" />
                  <Skeleton className="mt-2 h-3 w-1/2 rounded" />
                </div>
              }
              options={{
                ariaLabel: required
                  ? `${label}. Required JSON editor.`
                  : `${label}. JSON editor.`,
                automaticLayout: true,
                minimap: {
                  enabled: false,
                },
                formatOnPaste: true,
                formatOnType: true,
                scrollBeyondLastLine: false,
                scrollbar: {
                  alwaysConsumeMouseWheel: false,
                },
                wordWrap: "on",
                tabSize: 2,
                lineNumbersMinChars: 3,
                glyphMargin: false,
                folding: false,
                overviewRulerBorder: false,
                hideCursorInOverviewRuler: true,
                bracketPairColorization: {
                  enabled: true,
                },
                guides: {
                  indentation: false,
                },
                padding: {
                  top: 12,
                  bottom: 12,
                },
              }}
              onChange={(nextValue) => {
                onChange(nextValue || "");
              }}
              onValidate={(markers) => {
                setSyntaxError(getSyntaxErrorMessage(markers));
              }}
              onMount={(editorInstance, monaco) => {
                editorRef.current = editorInstance;
                monacoRef.current = monaco;
                defineEditorThemes(monaco);
                setIsEditorReady(true);

                editorInstance.onDidContentSizeChange((event) => {
                  setContentHeight(event.contentHeight);
                });

                editorInstance.onDidBlurEditorText(() => {
                  setIsTouched(true);
                  normalizeValueRef.current();
                });

                editorInstance.addCommand(
                  monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
                  () => {
                    normalizeValueRef.current();
                  },
                );

                editorInstance.addCommand(
                  monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
                  () => {
                    normalizeValueRef.current();
                    submitRef.current?.();
                  },
                );

                monaco.editor.setTheme(
                  isDark ? MONACO_DARK_THEME : MONACO_LIGHT_THEME,
                );

                if (autoFocus) {
                  editorInstance.focus();
                }
              }}
            />
          </div>
        )}
      </div>

      <div className="min-h-5">
        {displayedError ? (
          <p className={FIELD_ERROR} id={errorMessageId}>
            {displayedError}
          </p>
        ) : helperText ? (
          <p className={FIELD_HINT} id={helperTextId}>
            {helperText}
          </p>
        ) : null}
      </div>
    </div>
  );
};
