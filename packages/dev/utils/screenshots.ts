/**
 * The README's screenshots, from the dev app, light and dark:
 *
 *   QUEUEDASH_DEV_STACKTRACES=1 PORT=3100 pnpm dev
 *   pnpm traffic                                  # then wait about an hour
 *   QUEUEDASH_URL=http://localhost:3100 pnpm screenshots [shot ...]
 *
 * The charts cover the last hour, so the traffic has to have run that long
 * since the last Reset. This adds the listing flow the hero and flow shots
 * show, drives headless Chrome over the DevTools protocol at 2x, and writes
 * 256-colour PNGs to assets/screenshots, with the hero composed around the
 * app in assets/screenshots/hero.html. Needs Google Chrome and ffmpeg.
 *
 * Name shots to retake only those; "app" is the hero.
 */
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { FlowProducer, Queue } from "bullmq";

const BASE = (process.env.QUEUEDASH_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);
const APP = `${BASE}/queuedash`;
const CHROME =
  process.env.CHROME ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT_DIR = path.resolve(__dirname, "../../../assets/screenshots");
const WIDTH = 1280;
const HEIGHT = 800;
const SCALE = 2;
const STORAGE_KEY = "queuedash:user-preferences:queuedash-dev";

type Theme = "light" | "dark";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// --- The DevTools protocol, over Node's WebSocket -------------------------

type Message = {
  id?: number;
  method?: string;
  sessionId?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message: string };
};

class Cdp {
  private nextId = 0;
  private pending = new Map<
    number,
    {
      resolve: (result: Record<string, unknown>) => void;
      reject: (error: Error) => void;
    }
  >();
  private listeners = new Set<(message: Message) => void>();

  private constructor(private socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as Message;
      const waiting = message.id ? this.pending.get(message.id) : undefined;
      if (waiting && message.id) {
        this.pending.delete(message.id);
        if (message.error) waiting.reject(new Error(message.error.message));
        else waiting.resolve(message.result ?? {});
        return;
      }
      for (const listener of this.listeners) listener(message);
    });
  }

  static async connect(url: string) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    return new Cdp(socket);
  }

  send(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ) {
    const id = ++this.nextId;
    this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise<Record<string, unknown>>((resolve, reject) =>
      this.pending.set(id, { resolve, reject }),
    );
  }

  once(method: string, sessionId: string) {
    return new Promise<void>((resolve) => {
      const listener = (message: Message) => {
        if (message.method !== method || message.sessionId !== sessionId)
          return;
        this.listeners.delete(listener);
        resolve();
      };
      this.listeners.add(listener);
    });
  }

  close() {
    this.socket.close();
  }
}

type Page = {
  goto: (url: string) => Promise<void>;
  evaluate: <T>(expression: string) => Promise<T>;
  click: (selector: string) => Promise<void>;
  clickAt: (x: number, y: number) => Promise<void>;
  type: (text: string) => Promise<void>;
  key: (
    key: string,
    code: string,
    keyCode: number,
    modifiers?: number,
  ) => Promise<void>;
  shoot: (
    file: string,
    clip?: { x: number; y: number; width: number; height: number },
  ) => Promise<string>;
  setSize: (width: number, height: number) => Promise<void>;
};

const openPage = async (browser: Cdp, workDir: string): Promise<Page> => {
  const { targetId } = await browser.send("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = (await browser.send("Target.attachToTarget", {
    targetId,
    flatten: true,
  })) as { sessionId: string };
  const send = (method: string, params: Record<string, unknown> = {}) =>
    browser.send(method, params, sessionId);
  await send("Page.enable");
  await send("Runtime.enable");

  const setSize = async (width: number, height: number) => {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: SCALE,
      mobile: false,
    });
  };
  await setSize(WIDTH, HEIGHT);

  const evaluate = async <T>(expression: string) => {
    const response = (await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })) as { result: { value: T }; exceptionDetails?: { text: string } };
    if (response.exceptionDetails) {
      throw new Error(`${response.exceptionDetails.text}: ${expression}`);
    }
    return response.result.value;
  };

  // Finite animations to their end, fonts loaded, the dev app's own floating
  // controls (adapter picker, Next's badge) out of the picture.
  const settle = async (ms: number) => {
    await sleep(ms);
    await evaluate(`(async () => {
      await document.fonts.ready;
      for (const animation of document.getAnimations()) {
        try {
          if (animation.effect?.getComputedTiming().endTime !== Infinity) animation.finish();
        } catch {}
      }
      document.querySelector("nextjs-portal")?.remove();
      for (const element of document.body.querySelectorAll("body > div *")) {
        if (element.closest("[data-queuedash-root]")) continue;
        if (getComputedStyle(element).position === "fixed") element.style.display = "none";
      }
      return true;
    })()`);
  };

  const goto = async (url: string) => {
    const loaded = browser.once("Page.loadEventFired", sessionId);
    await send("Page.navigate", { url });
    await loaded;
    await settle(3_000);
  };

  const clickAt = async (x: number, y: number) => {
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
      await send("Input.dispatchMouseEvent", {
        type,
        x,
        y,
        button: "left",
        clickCount: 1,
      });
    }
    await settle(700);
  };

  const click = async (selector: string) => {
    const point = await evaluate<{ x: number; y: number } | null>(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return null;
      element.scrollIntoView({ block: "nearest" });
      const box = element.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    })()`);
    if (!point) throw new Error(`Nothing matches ${selector}`);
    await clickAt(point.x, point.y);
  };

  const type = async (text: string) => {
    await send("Input.insertText", { text });
    await settle(500);
  };

  const key = async (
    keyName: string,
    code: string,
    keyCode: number,
    modifiers = 0,
  ) => {
    for (const type of ["keyDown", "keyUp"]) {
      await send("Input.dispatchKeyEvent", {
        type,
        key: keyName,
        code,
        windowsVirtualKeyCode: keyCode,
        modifiers,
      });
    }
    await settle(700);
  };

  const shoot = async (
    file: string,
    clip = { x: 0, y: 0, width: WIDTH, height: HEIGHT },
  ) => {
    const { data } = (await send("Page.captureScreenshot", {
      format: "png",
      clip: { ...clip, scale: 1 },
    })) as { data: string };
    const raw = path.join(workDir, `${file}.png`);
    await writeFile(raw, Buffer.from(data, "base64"));
    return raw;
  };

  return { goto, evaluate, click, clickAt, type, key, shoot, setSize };
};

// --- Data the shots need ---------------------------------------------------

type Api = <T>(procedure: string, input: Record<string, unknown>) => Promise<T>;

const api: Api = async (procedure, input) => {
  const url = `${BASE}/api/trpc/queuedash/${procedure}?input=${encodeURIComponent(JSON.stringify(input))}`;
  const response = await fetch(url);
  const body = (await response.json()) as { result?: { data: unknown } };
  if (!body.result)
    throw new Error(`${procedure} failed: ${JSON.stringify(body)}`);
  return body.result.data as never;
};

/**
 * A listing upload across four queues whose thumbnail fails three times,
 * three ways: the flow page's callout and the job panel's attempts.
 */
const addListingFlow = async () => {
  const image = (operation: string) => ({
    fileId: "file_4hZq8v2LmN0pRt6w",
    fileName: "living-room.jpg",
    operation,
    inputFormat: "jpg",
    outputFormat: "webp",
    userId: "usr_k2Jd8sQm4x",
  });
  const producer = new FlowProducer({ connection: {} });
  const flow = await producer.add({
    name: "publish-listing",
    queueName: "image-processing",
    data: image("publish"),
    opts: { attempts: 2 },
    children: [
      {
        name: "thumbnail",
        queueName: "image-processing",
        data: {
          ...image("thumbnail"),
          demoErrors: ["upload-timeout", "pixel-limit", "pixel-limit"],
        },
        opts: { attempts: 3, backoff: { type: "fixed", delay: 1_500 } },
      },
      {
        name: "watermark",
        queueName: "image-processing",
        data: image("watermark"),
        children: [
          {
            name: "optimize",
            queueName: "image-processing",
            data: image("optimize"),
          },
        ],
      },
      {
        name: "index-listing",
        queueName: "search-indexing",
        data: {
          documentId: "product_Lq84sWm2kD0v",
          documentType: "product",
          action: "index",
          index: "products",
        },
      },
      {
        name: "charge-listing-fee",
        queueName: "payment-processing",
        data: {
          type: "charge",
          amount: 4.99,
          currency: "USD",
          customerId: "cus_R5dW0tLq9zXk2m",
          description: "Listing fee",
        },
        opts: { attempts: 3, backoff: { type: "exponential", delay: 2_000 } },
      },
      {
        name: "notify-seller",
        queueName: "email-delivery",
        data: {
          to: "maya.chen@example.com",
          template: "listing-live",
          subject: "Your listing is live",
        },
      },
    ],
  });
  await producer.close();

  const thumbnail = flow.children?.find(({ job }) => job.name === "thumbnail");
  if (!flow.job.id || !thumbnail?.job.id)
    throw new Error("The flow has no ids");

  // Three attempts, with backoff between them, and the siblings' runs.
  const images = new Queue("image-processing", { connection: {} });
  for (let tries = 0; tries < 60; tries += 1) {
    if ((await images.getJobState(thumbnail.job.id)) === "failed") break;
    await sleep(1_000);
  }
  await sleep(6_000);
  await images.close();
  return { rootId: flow.job.id, thumbnailId: thumbnail.job.id };
};

// --- The shots -------------------------------------------------------------

type Shot = {
  name: string;
  path: string;
  /** Clicks and keys after the page has loaded. */
  prepare?: (page: Page) => Promise<void>;
  /** Tiles drop the sidebar: 1000px from the content's edge. */
  clip?: { x: number; y: number; width: number; height: number };
};

const TILE = { x: 280, y: 0, width: 1000, height: 800 };

type Ids = { rootId: string; thumbnailId: string; emailId: string };

/** Clicks through the job panel's menu to Duplicate. */
const openDuplicate = async (page: Page) => {
  await page.click('[aria-label="More job actions"]');
  await page.evaluate(`(() => {
    const item = Array.from(document.querySelectorAll('[role="menuitem"]'))
      .find((element) => element.textContent?.includes("Duplicate"));
    item?.setAttribute("data-shot-duplicate", "");
    return true;
  })()`);
  await page.click("[data-shot-duplicate]");
};

const shots = (ids: Ids): Shot[] => [
  {
    name: "app",
    path: `/queues/image-processing?status=failed&job=${ids.thumbnailId}`,
  },
  { name: "overview", path: "/", clip: TILE },
  { name: "queue", path: "/queues/image-processing", clip: TILE },
  { name: "errors", path: "/queues/image-processing?view=errors", clip: TILE },
  {
    name: "flow",
    path: `/queues/image-processing/jobs/${ids.rootId}/flow`,
    clip: TILE,
  },
  {
    name: "search",
    path: "/queues/email-delivery?status=completed&q=password-reset",
    clip: TILE,
  },
  {
    name: "bulk",
    path: "/queues/image-processing?status=failed",
    clip: TILE,
    prepare: async (page) => {
      // React Aria checkboxes answer real pointer events, not .click().
      await page.evaluate(`(() => {
        const inputs = document.querySelectorAll('input[aria-label^="Select job"]');
        Array.from(inputs).slice(0, 4).forEach((input, index) =>
          input.closest("label")?.setAttribute("data-shot-select", String(index)),
        );
        return true;
      })()`);
      for (const index of [0, 1, 2, 3]) {
        await page.click(`[data-shot-select="${index}"]`);
      }
    },
  },
  {
    name: "duplicate",
    path: `/queues/email-delivery?status=failed&job=${ids.emailId}`,
    clip: TILE,
    prepare: async (page) => {
      await openDuplicate(page);
      // The fix the failure asked for: the variable the template missed,
      // on a new line after the subject.
      const line = await page.evaluate<{
        x: number;
        y: number;
      } | null>(`(() => {
        const dialogs = document.querySelectorAll('[role="dialog"]');
        const lines = dialogs[dialogs.length - 1]?.querySelectorAll(".qd-cm .cm-line") ?? [];
        const subject = Array.from(lines).find((line) => line.textContent?.includes('"subject"'));
        if (!subject) return null;
        const box = subject.getBoundingClientRect();
        return { x: box.right - 8, y: box.y + box.height / 2 };
      })()`);
      if (!line) throw new Error("No subject line to edit");
      await page.clickAt(line.x, line.y);
      await page.key("End", "End", 35);
      await page.key("Enter", "Enter", 13);
      await page.type('"userName": "Maya",');
    },
  },
  {
    name: "schedulers",
    path: "/queues/email-delivery?view=schedulers",
    clip: TILE,
    prepare: async (page) => {
      await page.click("[aria-label^='Scheduler ']");
    },
  },
];

/** A failed email to duplicate with a fix: one that missed a template variable. */
const findFailedEmail = async () => {
  const { jobs } = await api<{
    jobs: Array<{ id: string; failedReason?: string }>;
  }>("job.list", { queueName: "email-delivery", status: "failed", limit: 50 });
  const job =
    jobs.find(({ failedReason }) => failedReason?.includes("userName")) ??
    jobs[0];
  if (!job) throw new Error("No failed email yet: let the traffic run longer");
  return job.id;
};

const quantize = (input: string, output: string) =>
  new Promise<void>((resolve, reject) =>
    execFile(
      "ffmpeg",
      [
        "-y",
        "-loglevel",
        "error",
        "-i",
        input,
        "-vf",
        "split[a][b];[a]palettegen=max_colors=256:reserve_transparent=0[p];[b][p]paletteuse=dither=none",
        output,
      ],
      (error) => (error ? reject(error) : resolve()),
    ),
  );

const preferences = (theme: Theme) =>
  JSON.stringify({
    v: 2,
    overrides: { theme, timestamps: "absolute" },
    lastJobStatus: "completed",
    pinnedQueues: ["payment-processing", "image-processing"],
    codeLinks: {
      editor: "vscode",
      customUrl: "",
      mappings: [{ from: "/app", to: "/Users/you/code/listings" }],
      examplePath: null,
    },
  });

const main = async () => {
  const only = new Set(process.argv.slice(2));
  const workDir = await mkdtemp(path.join(tmpdir(), "queuedash-shots-"));
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${workDir}/profile`,
      "--hide-scrollbars",
      "--force-color-profile=srgb",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );

  try {
    const wsUrl = await new Promise<string>((resolve, reject) => {
      chrome.stderr?.on("data", (chunk: Buffer) => {
        const match = /DevTools listening on (ws:\/\/\S+)/.exec(String(chunk));
        if (match?.[1]) resolve(match[1]);
      });
      chrome.on("exit", () => reject(new Error("Chrome exited")));
    });
    const browser = await Cdp.connect(wsUrl);
    const page = await openPage(browser, workDir);

    const wanted = (name: string) => only.size === 0 || only.has(name);
    // Only what the requested shots show: every run of the flow adds jobs.
    let flow = { rootId: "", thumbnailId: "" };
    if (wanted("app") || wanted("flow")) {
      console.log("Adding the listing flow…");
      flow = await addListingFlow();
    }
    const ids = {
      ...flow,
      emailId: wanted("duplicate") ? await findFailedEmail() : "",
    };

    // Both themes of a shot back to back, so the pair shows the same moment:
    // a minute apart, counts and "ago" times drift and the flow's clock
    // stretches.
    for (const shot of shots(ids)) {
      if (!wanted(shot.name)) continue;
      for (const theme of ["light", "dark"] as const) {
        await page.goto(`${APP}/`);
        await page.evaluate(
          `localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, ${JSON.stringify(preferences(theme))})`,
        );
        await page.goto(`${APP}${shot.path}`);
        await shot.prepare?.(page);
        const raw = await page.shoot(`${shot.name}-${theme}`, shot.clip);
        if (shot.name === "app") {
          await composeHero(page, raw, theme, workDir);
        } else {
          await quantize(raw, path.join(OUT_DIR, `${shot.name}-${theme}.png`));
        }
        console.log(`${shot.name}-${theme}`);
      }
    }
    browser.close();
  } finally {
    const exited = new Promise((resolve) => chrome.once("exit", resolve));
    chrome.kill();
    await exited;
    await rm(workDir, { recursive: true, force: true, maxRetries: 3 });
  }
};

/** The app shot, framed on the brand's grid paper with the pitch above it. */
const composeHero = async (
  page: Page,
  appShot: string,
  theme: Theme,
  workDir: string,
) => {
  const template = await readFile(path.join(OUT_DIR, "hero.html"), "utf8");
  const shot = (await readFile(appShot)).toString("base64");
  const html = template
    .replace("{{theme}}", theme)
    .replace("{{shot}}", `data:image/png;base64,${shot}`);
  const file = path.join(workDir, `hero-${theme}.html`);
  await writeFile(file, html);

  const height = 860;
  await page.setSize(WIDTH, height);
  await page.goto(`file://${file}`);
  const raw = await page.shoot(`hero-${theme}`, {
    x: 0,
    y: 0,
    width: WIDTH,
    height,
  });
  await quantize(raw, path.join(OUT_DIR, `hero-${theme}.png`));
  await page.setSize(WIDTH, HEIGHT);
};

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
