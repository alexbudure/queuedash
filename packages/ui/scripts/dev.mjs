import { spawn } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
const sourceDirectory = fileURLToPath(new URL("../src", import.meta.url));
const apiTypesDirectory = fileURLToPath(
  new URL("../../api/dist", import.meta.url),
);
const POLL_INTERVAL_MS = 500;

const activeChildren = new Set();
let shuttingDown = false;
let pollTimer;

const runOnce = (command, args, options = {}) =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: packageDirectory,
      stdio: "inherit",
      ...options,
    });
    activeChildren.add(child);

    child.once("error", (error) => {
      console.error(error);
      activeChildren.delete(child);
      resolve(1);
    });
    child.once("exit", (code) => {
      activeChildren.delete(child);
      resolve(code ?? 1);
    });
  });

const stop = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of activeChildren) child.kill(signal);
  if (pollTimer) clearInterval(pollTimer);
  process.exitCode = 0;
};

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

const initialBuildCode = await runOnce(pnpm, ["run", "build"]);
if (shuttingDown) process.exit(0);
if (initialBuildCode !== 0) process.exit(initialBuildCode);

const walkFiles = async (directory, include, files = []) => {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return files;
    throw error;
  }

  await Promise.all(
    entries.map(async (entry) => {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        await walkFiles(path, include, files);
      } else if (entry.isFile() && include(path)) {
        files.push(path);
      }
    }),
  );

  return files;
};

const getTrackedFiles = async () => {
  const sourceFiles = await walkFiles(sourceDirectory, (path) =>
    /\.(css|ts|tsx)$/u.test(path),
  );
  const apiTypeFiles = await walkFiles(apiTypesDirectory, (path) =>
    path.endsWith(".d.ts"),
  );

  return [
    ...sourceFiles.map((path) => ({
      path,
      application: /\.(ts|tsx)$/u.test(path),
      styles: true,
    })),
    ...apiTypeFiles.map((path) => ({ path, application: true, styles: false })),
    {
      path: `${packageDirectory}/package.json`,
      application: true,
      styles: true,
    },
    {
      path: `${packageDirectory}/tsconfig.json`,
      application: true,
      styles: false,
    },
    {
      path: `${packageDirectory}/vite.config.ts`,
      application: true,
      styles: false,
    },
    {
      path: `${packageDirectory}/scripts/scope-css.mjs`,
      application: false,
      styles: true,
    },
  ];
};

const createSnapshot = async () => {
  const snapshot = new Map();
  const files = await getTrackedFiles();

  await Promise.all(
    files.map(async ({ path, application, styles }) => {
      try {
        const metadata = await stat(path);
        snapshot.set(path, {
          application,
          signature: `${metadata.mtimeMs}:${metadata.size}`,
          styles,
        });
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }),
  );

  return snapshot;
};

const findChanges = (previous, next) => {
  let application = false;
  let styles = false;
  const paths = new Set([...previous.keys(), ...next.keys()]);

  for (const path of paths) {
    const before = previous.get(path);
    const after = next.get(path);
    if (before?.signature === after?.signature) continue;

    application ||= before?.application === true || after?.application === true;
    styles ||= before?.styles === true || after?.styles === true;
  }

  return { application, styles };
};

const buildApplication = async () => {
  const typecheckCode = await runOnce(pnpm, ["exec", "tsc"]);
  if (typecheckCode !== 0 || shuttingDown) return typecheckCode;

  return runOnce(pnpm, ["exec", "vite", "build"]);
};

const buildStyles = async () => {
  const tailwindCode = await runOnce(pnpm, [
    "exec",
    "tailwindcss",
    "-i",
    "src/styles/global.css",
    "-o",
    "./dist/styles.css",
  ]);
  if (tailwindCode !== 0 || shuttingDown) return tailwindCode;

  return runOnce(process.execPath, ["scripts/scope-css.mjs"]);
};

let snapshot = await createSnapshot();
let pendingApplication = false;
let pendingStyles = false;
let rebuilding = false;

const drainBuilds = async () => {
  if (rebuilding || shuttingDown) return;
  rebuilding = true;

  try {
    while ((pendingApplication || pendingStyles) && !shuttingDown) {
      const rebuildApplication = pendingApplication;
      const rebuildStyles = pendingStyles;
      pendingApplication = false;
      pendingStyles = false;

      console.log("\nChange detected. Rebuilding Queuedash UI…");
      const applicationCode = rebuildApplication ? await buildApplication() : 0;
      const stylesCode =
        rebuildStyles || rebuildApplication ? await buildStyles() : 0;
      if (applicationCode !== 0 || stylesCode !== 0) {
        console.error("Rebuild failed. Watching for the next change.");
      }
    }
  } finally {
    rebuilding = false;
  }
};

console.log("Queuedash UI is watching for changes.");

const poll = async () => {
  if (shuttingDown) return;

  try {
    const nextSnapshot = await createSnapshot();
    const changes = findChanges(snapshot, nextSnapshot);
    snapshot = nextSnapshot;
    pendingApplication ||= changes.application;
    pendingStyles ||= changes.styles;
    void drainBuilds();
  } catch (error) {
    console.error("Could not scan UI source files:", error);
  }
};

pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
