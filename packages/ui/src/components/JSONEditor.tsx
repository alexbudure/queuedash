import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import {
  Annotation,
  Compartment,
  EditorState,
  type Extension,
  RangeSetBuilder,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { clsx } from "clsx";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  normalizeJSONEditorValue,
  type JSONEditorRootType,
  type JSONEditorValidationState,
} from "../utils/jsonEditor";
import { getChangedLines } from "../utils/lineDiff";
import { FIELD_ERROR, FIELD_HINT, TEXT_MUTED } from "../utils/styles";

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
  /** The text this value was copied from: every line that differs is marked. */
  originalValue?: string;
  /** Said under the editor while nothing is wrong, in place of `helperText`. */
  footer?: ReactNode;
};

const DEFAULT_MAX_HEIGHT_PX = 520;

const parsePx = (value: string | undefined, fallback: number) => {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** A value set from outside, which the editor must not report back as typed. */
const External = Annotation.define<boolean>();

/**
 * Classes, not inline colours: global.css paints them from the same tokens as
 * the job panel's JSON trees, and flips them with the dashboard's theme.
 */
const JSON_HIGHLIGHT = HighlightStyle.define([
  { tag: tags.propertyName, class: "qd-cm-key" },
  { tag: tags.string, class: "qd-cm-string" },
  { tag: tags.number, class: "qd-cm-number" },
  { tag: [tags.bool, tags.null], class: "qd-cm-keyword" },
]);

const changedLineMark = Decoration.line({ class: "qd-cm-changed" });

/** Marks each line that differs from `original`, as the text is edited. */
const changedLines = (original: string): Extension => {
  const build = (state: EditorState): DecorationSet => {
    const builder = new RangeSetBuilder<Decoration>();
    for (const lineNumber of getChangedLines(original, state.doc.toString())) {
      const line = state.doc.line(lineNumber);
      builder.add(line.from, line.from, changedLineMark);
    }
    return builder.finish();
  };

  return StateField.define<DecorationSet>({
    create: build,
    update: (marks, transaction) =>
      transaction.docChanged ? build(transaction.state) : marks,
    provide: (field) => EditorView.decorations.from(field),
  });
};

/**
 * A JSON field. CodeMirror is bundled, so the field works offline and under a
 * strict CSP; Monaco came from jsdelivr at runtime, about 1 MB on every open.
 */
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
  originalValue,
  footer,
}: JSONEditorProps) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [isTouched, setIsTouched] = useState(false);
  const [a11y] = useState(() => new Compartment());
  const [marks] = useState(() => new Compartment());
  const editorInputId = useId();
  const labelId = useId();
  const helperTextId = useId();
  const errorMessageId = useId();

  // The editor is built once; its handlers read the latest props from here.
  const latestRef = useRef({ onChange, onSubmit, label, required, rootType });
  latestRef.current = { onChange, onSubmit, label, required, rootType };
  // Read once, when the editor is built; later values arrive through the
  // value effect below.
  const initialRef = useRef({ value, autoFocus });

  const minHeightPx = parsePx(height, 240);
  const maxHeightPx = Math.max(
    minHeightPx,
    parsePx(maxHeight, DEFAULT_MAX_HEIGHT_PX),
  );

  const validationState = useMemo(
    () => normalizeJSONEditorValue({ value, label, required, rootType }),
    [label, required, rootType, value],
  );

  // Half-typed JSON is not a mistake yet, so errors stay hidden until the field
  // has been left or the parent has attempted a submit. Validity itself is
  // still reported live, so the submit button disables from the first keystroke.
  const displayedError =
    isTouched || showErrors ? validationState.errorMessage : null;
  const describedBy = displayedError
    ? errorMessageId
    : helperText
      ? helperTextId
      : undefined;

  useEffect(() => {
    onValidationChange?.(validationState);
  }, [onValidationChange, validationState]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // Rewrites loose input (unquoted keys, single quotes, trailing commas) as
    // JSON. On blur, on Cmd/Ctrl+S, and before a Cmd/Ctrl+Enter submit.
    const normalize = (view: EditorView) => {
      const { label, required, rootType } = latestRef.current;
      const text = view.state.doc.toString();
      const state = normalizeJSONEditorValue({
        value: text,
        label,
        required,
        rootType,
      });
      if (
        state.isValid &&
        state.normalizedValue !== undefined &&
        state.normalizedValue !== text
      ) {
        latestRef.current.onChange(state.normalizedValue);
      }
    };

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: initialRef.current.value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          json(),
          syntaxHighlighting(JSON_HIGHLIGHT),
          EditorState.tabSize.of(2),
          indentUnit.of("  "),
          EditorView.lineWrapping,
          keymap.of([
            {
              key: "Mod-Enter",
              preventDefault: true,
              run: (target) => {
                normalize(target);
                latestRef.current.onSubmit?.();
                return true;
              },
            },
            {
              key: "Mod-s",
              preventDefault: true,
              run: (target) => {
                normalize(target);
                return true;
              },
            },
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((update) => {
            if (
              update.docChanged &&
              !update.transactions.some((transaction) =>
                transaction.annotation(External),
              )
            ) {
              latestRef.current.onChange(update.state.doc.toString());
            }
            if (update.focusChanged && !update.view.hasFocus) {
              setIsTouched(true);
              normalize(update.view);
            }
          }),
          a11y.of([]),
          marks.of([]),
        ],
      }),
    });
    viewRef.current = view;
    if (initialRef.current.autoFocus) view.focus();

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [a11y, marks]);

  // A value from outside - normalization, a reset, a parent's own edit.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (value === current) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      annotations: External.of(true),
    });
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: a11y.reconfigure(
        EditorView.contentAttributes.of({
          id: editorInputId,
          "aria-labelledby": labelId,
          ...(describedBy ? { "aria-describedby": describedBy } : {}),
          ...(displayedError ? { "aria-invalid": "true" } : {}),
          ...(required ? { "aria-required": "true" } : {}),
        }),
      ),
    });
  }, [a11y, describedBy, displayedError, editorInputId, labelId, required]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: marks.reconfigure(
        originalValue === undefined ? [] : changedLines(originalValue),
      ),
    });
  }, [marks, originalValue]);

  return (
    <div className={clsx("space-y-1.5", className)}>
      <div
        className={clsx(
          "overflow-hidden rounded-xl border shadow-sm transition-[border-color,box-shadow] duration-150",
          displayedError
            ? "border-red-300 dark:border-red-500/60"
            : "border-gray-200 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100 dark:border-slate-700 dark:focus-within:border-brand-600 dark:focus-within:ring-brand-950",
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 bg-gray-50/80 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/30">
          <label
            className={clsx("cursor-text text-xs", TEXT_MUTED)}
            htmlFor={editorInputId}
            id={labelId}
            onMouseDown={(event) => {
              event.preventDefault();
              viewRef.current?.focus();
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

        <div
          ref={hostRef}
          className="qd-cm"
          style={
            {
              "--qd-cm-min": `${minHeightPx}px`,
              "--qd-cm-max": `${maxHeightPx}px`,
            } as CSSProperties
          }
        />
      </div>

      <div className="min-h-5">
        {displayedError ? (
          <p className={FIELD_ERROR} id={errorMessageId}>
            {displayedError}
          </p>
        ) : footer ? (
          footer
        ) : helperText ? (
          <p className={FIELD_HINT} id={helperTextId}>
            {helperText}
          </p>
        ) : null}
      </div>
    </div>
  );
};
