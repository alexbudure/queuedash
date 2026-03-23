import MonacoEditor, { type Monaco } from "@monaco-editor/react";
import { clsx } from "clsx";
import type { editor } from "monaco-editor";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import {
  normalizeJSONEditorValue,
  type JSONEditorRootType,
  type JSONEditorValidationState,
} from "../utils/jsonEditor";

type JSONEditorProps = {
  value: string;
  onChange: (value: string) => void;
  label: string;
  required?: boolean;
  rootType?: JSONEditorRootType;
  helperText?: string;
  height?: string;
  className?: string;
  onValidationChange?: (state: JSONEditorValidationState) => void;
  onNormalizedValue?: (value: string) => void;
};

const LIGHT_THEME = "queuedash-json-light";
const DARK_THEME = "queuedash-json-dark";
const MONACO_MARKER_ERROR_SEVERITY = 8;

const defineEditorThemes = (monaco: Monaco) => {
  monaco.editor.defineTheme(LIGHT_THEME, {
    base: "vs",
    inherit: true,
    rules: [
      { token: "string.key.json", foreground: "374151" },
      { token: "string.value.json", foreground: "0f766e" },
      { token: "number", foreground: "2563eb" },
      { token: "keyword", foreground: "b45309" },
    ],
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#111827",
      "editorLineNumber.foreground": "#9ca3af",
      "editorLineNumber.activeForeground": "#4b5563",
      "editorCursor.foreground": "#111827",
      "editor.selectionBackground": "#dbeafe",
      "editor.lineHighlightBackground": "#f8fafc",
      "editorIndentGuide.background": "#e5e7eb",
      "editorIndentGuide.activeBackground": "#cbd5e1",
      "editorWidget.background": "#ffffff",
      "editorError.foreground": "#dc2626",
      "editorWarning.foreground": "#d97706",
    },
  });

  monaco.editor.defineTheme(DARK_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "string.key.json", foreground: "cbd5e1" },
      { token: "string.value.json", foreground: "5eead4" },
      { token: "number", foreground: "93c5fd" },
      { token: "keyword", foreground: "fbbf24" },
    ],
    colors: {
      "editor.background": "#0f172a",
      "editor.foreground": "#e2e8f0",
      "editorLineNumber.foreground": "#64748b",
      "editorLineNumber.activeForeground": "#cbd5e1",
      "editorCursor.foreground": "#f8fafc",
      "editor.selectionBackground": "#1d4ed8",
      "editor.lineHighlightBackground": "#111827",
      "editorIndentGuide.background": "#1e293b",
      "editorIndentGuide.activeBackground": "#334155",
      "editorWidget.background": "#0f172a",
      "editorError.foreground": "#f87171",
      "editorWarning.foreground": "#fbbf24",
    },
  });
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
  className,
  onValidationChange,
  onNormalizedValue,
}: JSONEditorProps) => {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const normalizeValueRef = useRef<() => void>(() => undefined);
  const [syntaxError, setSyntaxError] = useState<string | null>(null);
  const [isEditorReady, setIsEditorReady] = useState(false);
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
      onNormalizedValue?.(normalizedState.normalizedValue);
    }
  };

  useEffect(() => {
    onValidationChange?.(validationState);
  }, [onValidationChange, validationState]);

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

    const describedBy = validationState.errorMessage
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
    editorInputId,
    errorMessageId,
    helperText,
    helperTextId,
    isEditorReady,
    labelId,
    validationState.errorMessage,
  ]);

  useEffect(() => {
    if (
      !isEditorReady ||
      !monacoRef.current ||
      typeof document === "undefined"
    ) {
      return;
    }

    const applyTheme = () => {
      monacoRef.current?.editor.setTheme(
        document.documentElement.classList.contains("dark")
          ? DARK_THEME
          : LIGHT_THEME,
      );
    };

    applyTheme();

    const observer = new MutationObserver(applyTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, [isEditorReady]);

  return (
    <div className={clsx("space-y-1.5", className)}>
      <div
        className={clsx(
          "overflow-hidden rounded-xl border shadow-sm",
          validationState.errorMessage
            ? "border-red-300 dark:border-red-500/60"
            : "border-gray-200 dark:border-slate-700",
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 bg-gray-50/80 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/30">
          <label
            className="cursor-text text-xs text-gray-500 dark:text-slate-400"
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

          <span className="rounded-full bg-gray-100 px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.18em] text-gray-400 dark:bg-slate-800 dark:text-slate-500">
            JSON
          </span>
        </div>

        <div className="bg-white/80 dark:bg-slate-900/80">
        <MonacoEditor
          height={height}
          language="json"
          value={value}
          options={{
            ariaLabel: required
              ? `${label}. Required JSON editor.`
              : `${label}. JSON editor.`,
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

            editorInstance.onDidBlurEditorText(() => {
              normalizeValueRef.current();
            });

            editorInstance.addCommand(
              monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
              () => {
                normalizeValueRef.current();
              },
            );

            monaco.editor.setTheme(
              document.documentElement.classList.contains("dark")
                ? DARK_THEME
                : LIGHT_THEME,
            );
          }}
        />
        </div>
      </div>

      <div className="min-h-5">
        {validationState.errorMessage ? (
          <p
            className="text-xs text-red-600 dark:text-red-400"
            id={errorMessageId}
          >
            {validationState.errorMessage}
          </p>
        ) : helperText ? (
          <p
            className="text-xs text-gray-500 dark:text-slate-400"
            id={helperTextId}
          >
            {helperText}
          </p>
        ) : null}
      </div>
    </div>
  );
};
