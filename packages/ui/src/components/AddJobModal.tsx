import * as Dialog from "@radix-ui/react-dialog";
import { Cross2Icon } from "@radix-ui/react-icons";
import type { Queue } from "../utils/trpc";
import { trpc } from "../utils/trpc";
import { Button } from "./Button";
import { Toast } from "./Toast";
import Editor from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useRef, useState } from "react";

type JobModalProps = {
  queue: Queue;
  onDismiss: () => void;
};

export const AddJobModal = ({ queue, onDismiss }: JobModalProps) => {
  const {
    mutate: addJob,
    isLoading,
    isSuccess,
  } = trpc.queue.addJob.useMutation();

  const [value, setValue] = useState("{}");
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const formatCode = () => {
    editorRef.current?.getAction("editor.action.formatDocument")?.run();
  };
  const handleKeyDown = (event: React.KeyboardEvent) => {
    const charCode = String.fromCharCode(event.which).toLowerCase();
    if ((event.ctrlKey || event.metaKey) && charCode === "s") {
      event.preventDefault();
      formatCode();
    }
  };
  return (
    <Dialog.Root
      open={true}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onDismiss();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/10" />
        <Dialog.Content
          onEscapeKeyDown={onDismiss}
          onInteractOutside={onDismiss}
          className="fixed left-1/2 top-1/2 max-h-[85vh] w-full max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-scroll rounded-lg bg-white p-4 shadow-xl"
        >
          <Dialog.Close asChild>
            <button
              className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full text-slate-500 transition duration-150 ease-in-out hover:bg-slate-50"
              aria-label="Close"
              onClick={() => onDismiss()}
            >
              <Cross2Icon />
            </button>
          </Dialog.Close>
          <div className="flex items-center space-x-4">
            <Dialog.Title className="mb-1 flex items-center space-x-2">
              <span className="text-xl font-semibold text-slate-900">
                Add job to {queue.displayName.toLocaleLowerCase()}
              </span>
            </Dialog.Title>
          </div>
          <div
            onKeyDown={handleKeyDown}
            onBlur={formatCode}
            className="mb-6 border border-slate-200"
          >
            <Editor
              height="300px"
              language="json"
              className="rounded-md"
              options={{
                minimap: {
                  enabled: false,
                },
                formatOnPaste: true,
                formatOnType: true,
                padding: {
                  top: 8,
                  bottom: 8,
                },
                tabSize: 2,
              }}
              defaultValue={value}
              onChange={(val) => {
                if (val) {
                  setValue(val);
                }
              }}
              onMount={(editor, monaco) => {
                editorRef.current = editor;
                monaco.editor.defineTheme("solarized-light", {
                  base: "vs",
                  inherit: true,
                  rules: [
                    {
                      background: "ffffff",
                      token: "",
                    },
                    {
                      foreground: "6a737d",
                      token: "comment",
                    },
                    {
                      foreground: "6a737d",
                      token: "punctuation.definition.comment",
                    },
                    {
                      foreground: "6a737d",
                      token: "string.comment",
                    },
                    {
                      foreground: "005cc5",
                      token: "constant",
                    },
                    {
                      foreground: "005cc5",
                      token: "entity.name.constant",
                    },
                    {
                      foreground: "005cc5",
                      token: "variable.other.constant",
                    },
                    {
                      foreground: "005cc5",
                      token: "variable.language",
                    },
                    {
                      foreground: "6f42c1",
                      token: "entity",
                    },
                    {
                      foreground: "6f42c1",
                      token: "entity.name",
                    },
                    {
                      foreground: "24292e",
                      token: "variable.parameter.function",
                    },
                    {
                      foreground: "22863a",
                      token: "entity.name.tag",
                    },
                    {
                      foreground: "d73a49",
                      token: "keyword",
                    },
                    {
                      foreground: "d73a49",
                      token: "storage",
                    },
                    {
                      foreground: "d73a49",
                      token: "storage.type",
                    },
                    {
                      foreground: "24292e",
                      token: "storage.modifier.package",
                    },
                    {
                      foreground: "24292e",
                      token: "storage.modifier.import",
                    },
                    {
                      foreground: "24292e",
                      token: "storage.type.java",
                    },
                    {
                      foreground: "032f62",
                      token: "string",
                    },
                    {
                      foreground: "032f62",
                      token: "punctuation.definition.string",
                    },
                    {
                      foreground: "032f62",
                      token: "string punctuation.section.embedded source",
                    },
                    {
                      foreground: "005cc5",
                      token: "support",
                    },
                    {
                      foreground: "005cc5",
                      token: "meta.property-name",
                    },
                    {
                      foreground: "e36209",
                      token: "variable",
                    },
                    {
                      foreground: "24292e",
                      token: "variable.other",
                    },
                    {
                      foreground: "b31d28",
                      fontStyle: "bold italic underline",
                      token: "invalid.broken",
                    },
                    {
                      foreground: "b31d28",
                      fontStyle: "bold italic underline",
                      token: "invalid.deprecated",
                    },
                    {
                      foreground: "fafbfc",
                      background: "b31d28",
                      fontStyle: "italic underline",
                      token: "invalid.illegal",
                    },
                    {
                      foreground: "fafbfc",
                      background: "d73a49",
                      fontStyle: "italic underline",
                      token: "carriage-return",
                    },
                    {
                      foreground: "b31d28",
                      fontStyle: "bold italic underline",
                      token: "invalid.unimplemented",
                    },
                    {
                      foreground: "b31d28",
                      token: "message.error",
                    },
                    {
                      foreground: "24292e",
                      token: "string source",
                    },
                    {
                      foreground: "005cc5",
                      token: "string variable",
                    },
                    {
                      foreground: "032f62",
                      token: "source.regexp",
                    },
                    {
                      foreground: "032f62",
                      token: "string.regexp",
                    },
                    {
                      foreground: "032f62",
                      token: "string.regexp.character-class",
                    },
                    {
                      foreground: "032f62",
                      token: "string.regexp constant.character.escape",
                    },
                    {
                      foreground: "032f62",
                      token: "string.regexp source.ruby.embedded",
                    },
                    {
                      foreground: "032f62",
                      token: "string.regexp string.regexp.arbitrary-repitition",
                    },
                    {
                      foreground: "22863a",
                      fontStyle: "bold",
                      token: "string.regexp constant.character.escape",
                    },
                    {
                      foreground: "005cc5",
                      token: "support.constant",
                    },
                    {
                      foreground: "005cc5",
                      token: "support.variable",
                    },
                    {
                      foreground: "005cc5",
                      token: "meta.module-reference",
                    },
                    {
                      foreground: "735c0f",
                      token: "markup.list",
                    },
                    {
                      foreground: "005cc5",
                      fontStyle: "bold",
                      token: "markup.heading",
                    },
                    {
                      foreground: "005cc5",
                      fontStyle: "bold",
                      token: "markup.heading entity.name",
                    },
                    {
                      foreground: "22863a",
                      token: "markup.quote",
                    },
                    {
                      foreground: "24292e",
                      fontStyle: "italic",
                      token: "markup.italic",
                    },
                    {
                      foreground: "24292e",
                      fontStyle: "bold",
                      token: "markup.bold",
                    },
                    {
                      foreground: "005cc5",
                      token: "markup.raw",
                    },
                    {
                      foreground: "b31d28",
                      background: "ffeef0",
                      token: "markup.deleted",
                    },
                    {
                      foreground: "b31d28",
                      background: "ffeef0",
                      token: "meta.diff.header.from-file",
                    },
                    {
                      foreground: "b31d28",
                      background: "ffeef0",
                      token: "punctuation.definition.deleted",
                    },
                    {
                      foreground: "22863a",
                      background: "f0fff4",
                      token: "markup.inserted",
                    },
                    {
                      foreground: "22863a",
                      background: "f0fff4",
                      token: "meta.diff.header.to-file",
                    },
                    {
                      foreground: "22863a",
                      background: "f0fff4",
                      token: "punctuation.definition.inserted",
                    },
                    {
                      foreground: "e36209",
                      background: "ffebda",
                      token: "markup.changed",
                    },
                    {
                      foreground: "e36209",
                      background: "ffebda",
                      token: "punctuation.definition.changed",
                    },
                    {
                      foreground: "f6f8fa",
                      background: "005cc5",
                      token: "markup.ignored",
                    },
                    {
                      foreground: "f6f8fa",
                      background: "005cc5",
                      token: "markup.untracked",
                    },
                    {
                      foreground: "6f42c1",
                      fontStyle: "bold",
                      token: "meta.diff.range",
                    },
                    {
                      foreground: "005cc5",
                      token: "meta.diff.header",
                    },
                    {
                      foreground: "005cc5",
                      fontStyle: "bold",
                      token: "meta.separator",
                    },
                    {
                      foreground: "005cc5",
                      token: "meta.output",
                    },
                    {
                      foreground: "586069",
                      token: "brackethighlighter.tag",
                    },
                    {
                      foreground: "586069",
                      token: "brackethighlighter.curly",
                    },
                    {
                      foreground: "586069",
                      token: "brackethighlighter.round",
                    },
                    {
                      foreground: "586069",
                      token: "brackethighlighter.square",
                    },
                    {
                      foreground: "586069",
                      token: "brackethighlighter.angle",
                    },
                    {
                      foreground: "586069",
                      token: "brackethighlighter.quote",
                    },
                    {
                      foreground: "b31d28",
                      token: "brackethighlighter.unmatched",
                    },
                    {
                      foreground: "b31d28",
                      token: "sublimelinter.mark.error",
                    },
                    {
                      foreground: "e36209",
                      token: "sublimelinter.mark.warning",
                    },
                    {
                      foreground: "959da5",
                      token: "sublimelinter.gutter-mark",
                    },
                    {
                      foreground: "032f62",
                      fontStyle: "underline",
                      token: "constant.other.reference.link",
                    },
                    {
                      foreground: "032f62",
                      fontStyle: "underline",
                      token: "string.other.link",
                    },
                  ],
                  colors: {
                    "editor.foreground": "#24292e",
                    "editor.background": "#ffffff",
                    "editor.selectionBackground": "#c8c8fa",
                    "editor.inactiveSelectionBackground": "#fafbfc",
                    "editor.lineHighlightBackground": "#fafbfc",
                    "editorCursor.foreground": "#24292e",
                    "editorWhitespace.foreground": "#959da5",
                    "editorIndentGuide.background": "#959da5",
                    "editorIndentGuide.activeBackground": "#24292e",
                    "editor.selectionHighlightBorder": "#fafbfc",
                  },
                });
                monaco.editor.setTheme("solarized-light");
              }}
            />
          </div>
          <div>
            <Button
              label="Add job"
              variant="filled"
              disabled={isLoading}
              onClick={() => {
                if (editorRef.current) {
                  editorRef.current
                    .getAction("editor.action.formatDocument")
                    ?.run();

                  try {
                    const data = JSON.parse(editorRef.current.getValue());
                    addJob({
                      queueName: queue.name,
                      data,
                    });
                  } catch {
                    setError("Invalid JSON");
                  }
                }
              }}
            />
            {isSuccess ? (
              <Toast message="New job has been added" variant="success" />
            ) : null}
            {error ? (
              <Toast
                message={error}
                onDismiss={() => {
                  setError(null);
                }}
                variant="error"
              />
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
