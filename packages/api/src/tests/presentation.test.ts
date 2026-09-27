import { describe, expect, it } from "vitest";

import {
  presentErrorMessage,
  presentJob,
  presentLogs,
  presentScheduler,
  redactText,
  redactValue,
} from "../presentation";
import type { AdaptedJob, SchedulerInfo } from "../queue-adapters/base.adapter";

const createJob = (): AdaptedJob => ({
  id: "job-1",
  name: "Send receipt",
  data: {
    authorization: "Bearer raw-secret",
    customer: {
      email: "person@example.com",
      password: "hunter2",
    },
  },
  opts: {
    attempts: 3,
  },
  createdAt: new Date("2026-01-01T00:00:00Z"),
  processedAt: null,
  finishedAt: null,
  failedReason: 'request failed with token="raw-secret"',
  stacktrace: ["Error: apiKey=raw-secret"],
  retriedAt: null,
  returnValue: {
    access_token: "raw-secret",
    ok: false,
  },
});

describe("presentation redaction", () => {
  it.each([
    { keys: ["failedReason", "stacktrace"] },
    { paths: ["failedReason", "stacktrace"] },
    { paths: ["failedReason", "stacktrace.*"] },
  ])("preserves explicit error-field rules: %j", (rules) => {
    const raw = {
      ...createJob(),
      failedReason: "Customer 123-45-6789",
      stacktrace: ["Customer 123-45-6789"],
    };
    const presented = presentJob(raw, {
      redact: { includeDefaultKeys: false, ...rules },
    });
    expect(presented.failedReason).toBe("[REDACTED]");
    expect(presented.stacktrace).toEqual(["[REDACTED]"]);
    expect(raw.stacktrace).toEqual(["Customer 123-45-6789"]);
  });

  it("preserves per-line trace rules without hiding unrelated lines", () => {
    const raw = {
      ...createJob(),
      stacktrace: ["sensitive", "public"],
    };
    expect(
      presentJob(raw, {
        redact: { includeDefaultKeys: false, paths: ["stacktrace.0"] },
      }).stacktrace,
    ).toEqual(["[REDACTED]", "public"]);
    expect(
      presentJob(raw, {
        redact: { keys: ["stacktrace"] },
        expose: { stacktraces: false },
      }).stacktrace,
    ).toBeUndefined();
  });

  it("redacts built-in sensitive keys across every job payload surface", () => {
    const job = presentJob(createJob(), { redact: true });

    expect(job.data).toEqual({
      authorization: "[REDACTED]",
      customer: {
        email: "person@example.com",
        password: "[REDACTED]",
      },
    });
    expect(job.returnValue).toEqual({
      access_token: "[REDACTED]",
      ok: false,
    });
    expect(job.failedReason).toBe("request failed with token=[REDACTED]");
    expect(job.stacktrace).toEqual(["Error: apiKey=[REDACTED]"]);
    expect(job.createdAt).toEqual(new Date("2026-01-01T00:00:00Z"));
  });

  it("supports custom paths, keys, and replacement values", () => {
    const job = presentJob(createJob(), {
      redact: {
        includeDefaultKeys: false,
        keys: ["email"],
        paths: ["data.customer.password"],
        replacement: "***",
      },
    });

    expect(job.data).toMatchObject({
      authorization: "Bearer raw-secret",
      customer: {
        email: "***",
        password: "***",
      },
    });
  });

  it("preserves opaque operational identifiers unless explicitly redacted", () => {
    const encodedId = JSON.stringify({ token: "opaque-id-secret" });
    const job = presentJob(
      { ...createJob(), id: encodedId, groupId: encodedId },
      { redact: true },
    );
    const scheduler = presentScheduler(
      { key: encodedId, name: "encoded-key" },
      { redact: true },
    );

    expect(job.id).toBe(encodedId);
    expect(job.groupId).toBe(encodedId);
    expect(scheduler.key).toBe(encodedId);
  });

  it("redacts logs and scheduler template data", () => {
    const scheduler: SchedulerInfo = {
      key: "daily",
      name: "daily",
      template: {
        data: { token: "raw-secret", visible: "yes" },
        opts: { authorization: "raw-secret" },
      },
    };

    expect(
      presentLogs(["password=hunter2", '{"apiKey":"abc"}'], {
        redact: true,
      }),
    ).toEqual(["password=[REDACTED]", '{"apiKey":"[REDACTED]"}']);
    expect(presentScheduler(scheduler, { redact: true })).toMatchObject({
      template: {
        data: { token: "[REDACTED]", visible: "yes" },
        opts: { authorization: "[REDACTED]" },
      },
    });
  });

  it("normalizes common sensitive key spellings in free-form text", () => {
    expect(
      redactText(
        "access_token=raw api-key:raw refresh.token='raw' headers.authorization=Bearer-raw\nvisible=value",
        { redact: true },
      ),
    ).toBe(
      "access_token=[REDACTED] api-key:[REDACTED] refresh.token=[REDACTED] headers.authorization=[REDACTED]\nvisible=value",
    );
  });

  it("redacts bracket-notation assignments across text surfaces", () => {
    for (const value of [
      'headers["authorization"] = Bearer bracket-secret',
      "headers['token']=quoted-bracket-secret",
      "headers[password]=multi word bracket secret",
      '_headers["authorization"] = Bearer prefixed-secret',
      'headers?.["authorization"]=optional-secret',
      'authorization=Bearer "quoted-secret"',
    ]) {
      expect(redactText(value, { redact: true })).not.toContain("secret");
    }

    const job = presentJob(
      {
        ...createJob(),
        failedReason: 'headers["authorization"]=Bearer failed-secret',
      },
      { redact: true },
    );
    expect(job.failedReason).not.toContain("failed-secret");
    expect(
      presentLogs(["headers['token']=log-secret"], { redact: true })?.[0],
    ).not.toContain("log-secret");
    expect(
      presentErrorMessage(
        new Error("headers[authorization]=Bearer error-secret"),
        { redact: true },
      ),
    ).not.toContain("error-secret");
  });

  it("redacts free-form credentials in structured string leaves", () => {
    const job = createJob();
    job.data.message = "authorization=Bearer data-secret";
    (job.opts as Record<string, unknown>).message = "token=opts-secret";
    job.returnValue = { message: "password=return secret value" };

    const scheduler: SchedulerInfo = {
      key: "daily",
      name: "daily",
      template: {
        data: { message: "apiKey=scheduler-data-secret" },
        opts: { message: "cookie=scheduler-opts-secret" },
      },
    };

    expect(JSON.stringify(presentJob(job, { redact: true }))).not.toMatch(
      /data-secret|opts-secret|return secret/u,
    );
    expect(
      JSON.stringify(presentScheduler(scheduler, { redact: true })),
    ).not.toMatch(/scheduler-data-secret|scheduler-opts-secret/u);
  });

  it("fully redacts authorization schemes and embedded JSON", () => {
    expect(
      redactText(
        'authorization=Bearer eyJhbGciOiJIUzI1NiJ9.raw signature=credential-tail\nvisible=yes\nrequest failed: {"headers":{"authorization":"Bearer nested-secret"},"apiKey":"json-secret","visible":"yes"}',
        { redact: true },
      ),
    ).toBe(
      'authorization=[REDACTED]\nvisible=yes\nrequest failed: {"headers":{"authorization":"[REDACTED]"},"apiKey":"[REDACTED]","visible":"yes"}',
    );

    const job = presentJob(
      {
        ...createJob(),
        failedReason:
          'request failed: {"authorization":"Bearer failed-secret"}',
        stacktrace: ["Error: authorization=Basic c3RhY2stc2VjcmV0"],
      },
      { redact: true },
    );
    expect(job.failedReason).not.toContain("failed-secret");
    expect(job.stacktrace?.join(" ")).not.toContain("c3RhY2stc2VjcmV0");
    expect(
      presentLogs(
        ['response={"cookie":"session-secret"}', "apiKey=Bearer log-secret"],
        { redact: true },
      )?.join(" "),
    ).not.toMatch(/session-secret|log-secret/u);
    expect(
      presentErrorMessage(
        new Error(
          'upstream rejected {"authorization":"Basic ZXJyb3Itc2VjcmV0"}',
        ),
        { redact: true },
      ),
    ).not.toContain("ZXJyb3Itc2VjcmV0");
  });

  it("fully redacts parameterized authorization schemes", () => {
    const aws =
      "Authorization: AWS4-HMAC-SHA256 Credential=AKIASECRET/20260827/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-date, Signature=deadbeefsecret\nvisible=yes";
    const digest =
      'Proxy-Authorization: Digest username="admin", realm="private-realm", nonce="nonce-secret", response="response-secret"\nvisible=yes';

    for (const value of [aws, digest]) {
      const redacted = redactText(value, { redact: true });
      expect(redacted).toMatch(
        /^(?:Authorization|Proxy-Authorization): \[REDACTED\]\nvisible=yes$/u,
      );
      expect(redacted).not.toMatch(
        /AKIASECRET|deadbeefsecret|private-realm|nonce-secret|response-secret/u,
      );
    }

    expect(
      presentLogs([aws, digest], { redact: true })?.join("\n"),
    ).not.toMatch(
      /AKIASECRET|deadbeefsecret|private-realm|nonce-secret|response-secret/u,
    );
    expect(
      presentErrorMessage(new Error(digest), { redact: true }),
    ).not.toContain("response-secret");
  });

  it("fails closed for opaque credential headers regardless of scheme", () => {
    const value = [
      'Authorization: Signature keyId="service-key",algorithm="hmac-sha256",signature="signature-secret"',
      'Proxy-Authorization: Custom realm="private", token="proxy-secret"',
      "Cookie: session=cookie-secret; theme=dark",
      "Set-Cookie: session=set-cookie-secret; Path=/; HttpOnly",
      "visible=yes",
    ].join("\n");
    const folded =
      'Authorization: Digest username="admin",\r\n nonce="folded-secret",\r\n response="folded-response"\r\nvisible=yes';

    const redacted = redactText(value, { redact: true });
    expect(redacted).toBe(
      [
        "Authorization: [REDACTED]",
        "Proxy-Authorization: [REDACTED]",
        "Cookie: [REDACTED]",
        "Set-Cookie: [REDACTED]",
        "visible=yes",
      ].join("\n"),
    );
    expect(redacted).not.toMatch(
      /signature-secret|proxy-secret|cookie-secret|set-cookie-secret/u,
    );
    expect(redactText(folded, { redact: true })).toBe(
      "Authorization: [REDACTED]\r\nvisible=yes",
    );
  });

  it("fails closed when an opaque header prefixes credentials with the replacement", () => {
    const value =
      'Authorization: "[REDACTED]", signature="still-secret"\nvisible=yes';
    const expected = "Authorization: [REDACTED]\nvisible=yes";

    expect(redactText(value, { redact: true })).toBe(expected);
    expect(presentLogs([value], { redact: true })).toEqual([expected]);
    expect(presentErrorMessage(new Error(value), { redact: true })).toBe(
      expected,
    );
  });

  it("fails closed for escaped sensitive keys in malformed JSON", () => {
    const value =
      '{"author\\u0069zation":"Bearer malformed-secret", "visible":"yes"';
    const expected = '{"author\\u0069zation":[REDACTED]';

    expect(redactText(value, { redact: true })).toBe(expected);
    expect(presentLogs([value], { redact: true })).toEqual([expected]);
    expect(presentErrorMessage(new Error(value), { redact: true })).toBe(
      expected,
    );
  });

  it("redacts complete multiline PEM private keys", () => {
    const privateKey =
      "privateKey=-----BEGIN PRIVATE KEY-----\nSUPERSECRETBASE64\n-----END PRIVATE KEY-----\nvisible=yes";
    const incompletePrivateKey =
      "privateKey=-----BEGIN RSA PRIVATE KEY-----\nUNTERMINATEDSECRET";

    expect(redactText(privateKey, { redact: true })).toBe(
      "privateKey=[REDACTED]\nvisible=yes",
    );
    expect(redactText(incompletePrivateKey, { redact: true })).toBe(
      "privateKey=[REDACTED]",
    );
    expect(presentLogs([privateKey], { redact: true })?.[0]).not.toContain(
      "SUPERSECRETBASE64",
    );
    expect(
      presentErrorMessage(new Error(privateKey), { redact: true }),
    ).not.toContain("SUPERSECRETBASE64");
  });

  it("redacts common credential aliases in structured and text values", () => {
    expect(
      redactValue(
        {
          "X-API-Key": "header-secret",
          "proxy-authorization": "Bearer proxy-secret",
          "set-cookie": "opaque-cookie-secret",
          session_id: "session-secret",
          client_secret: "client-secret",
          visible: "yes",
        },
        { redact: true },
      ),
    ).toEqual({
      "X-API-Key": "[REDACTED]",
      "proxy-authorization": "[REDACTED]",
      "set-cookie": "[REDACTED]",
      session_id: "[REDACTED]",
      client_secret: "[REDACTED]",
      visible: "yes",
    });

    const redacted = redactText(
      "X-API-Key: header-secret\nProxy-Authorization: Bearer proxy-secret\nSet-Cookie: connect.sid=cookie-secret; Path=/\nsession_id=session-secret client_secret=client-secret visible=yes",
      { redact: true },
    );
    expect(redacted).not.toMatch(
      /header-secret|proxy-secret|cookie-secret|session-secret|client-secret/u,
    );
    expect(redacted).toContain("visible=yes");
  });

  it("recursively redacts JSON encoded inside strings and escaped log fields", () => {
    const nested = JSON.stringify({
      response: JSON.stringify({
        authorization: "Bearer double-secret",
        nested: JSON.stringify({ apiKey: "nested-key" }),
      }),
      visible: "yes",
    });
    const redactedNested = redactText(nested, { redact: true });
    expect(redactedNested).not.toMatch(/double-secret|nested-key/u);
    const parsedNested = JSON.parse(redactedNested) as {
      response: string;
    };
    const parsedResponse = JSON.parse(parsedNested.response) as {
      authorization: string;
      nested: string;
    };
    expect(parsedResponse.authorization).toBe("[REDACTED]");
    expect(JSON.parse(parsedResponse.nested)).toEqual({
      apiKey: "[REDACTED]",
    });

    const escapedLog =
      'response="{\\"authorization\\":\\"Bearer escaped-secret\\",\\"apiKey\\":\\"escaped-key\\"}"';
    const redactedLog = redactText(escapedLog, { redact: true });
    expect(redactedLog).not.toMatch(/escaped-secret|escaped-key/u);
    expect(redactedLog).toContain("[REDACTED]");

    let deeplyEncoded = JSON.stringify({ authorization: "deep-secret" });
    for (let depth = 0; depth < 8; depth += 1) {
      deeplyEncoded = JSON.stringify(deeplyEncoded);
    }
    expect(
      redactText(JSON.stringify({ response: deeplyEncoded }), {
        redact: true,
      }),
    ).not.toContain("deep-secret");
  });

  it("redacts whole and embedded JSON-encoded text values", () => {
    const wholeValue = JSON.stringify(
      JSON.stringify({ token: "bare-encoded-secret" }),
    );
    const embeddedValue = `prefix ${JSON.stringify(
      JSON.stringify({ authorization: "Bearer nested-secret" }),
    )} suffix`;

    expect(redactText(wholeValue, { redact: true })).not.toContain(
      "bare-encoded-secret",
    );
    expect(redactText(embeddedValue, { redact: true })).not.toContain(
      "nested-secret",
    );
  });

  it("fails closed when nested JSON fragments exhaust the parse budget", () => {
    let nested = '{"to\\u006ben":"leaksecret"}';
    for (let depth = 0; depth < 10; depth += 1) {
      nested = `[x${"a".repeat(10_000)},${nested}]`;
    }

    expect(redactText(`failed ${nested}`, { redact: true })).not.toContain(
      "leaksecret",
    );
  });

  it("does not leave partial secrets in wrapped or punctuated values", () => {
    for (const value of [
      "authorization=(Bearer paren-secret)",
      "authorization=(Bearer outer(inner-secret)remainder)",
      "authorization=`Bearer tick-secret value`",
      "Authorization: Bearer comma-secret,remainder",
      "token=semicolon-secret;remainder",
    ]) {
      const redacted = redactText(value, { redact: true });
      expect(redacted).toMatch(
        /^(?:authorization|Authorization|token)\s*[:=]\s*\[REDACTED\]$/u,
      );
      expect(redacted).not.toMatch(/secret|remainder/u);
    }
  });

  it("ignores structural closers inside quoted wrapper content", () => {
    for (const value of [
      'token=("secret)leak")',
      'token=["secret]leak"]',
      'token={"value":"secret}leak"}',
    ]) {
      const redacted = redactText(value, { redact: true });
      expect(redacted).toBe("token=[REDACTED]");
      expect(redacted).not.toMatch(/secret|leak/u);
    }
  });

  it("fails closed for multi-word, punctuated, and malformed text secrets", () => {
    expect(
      redactText("login failed password=correct horse battery staple", {
        redact: true,
      }),
    ).toBe("login failed password=[REDACTED]");
    expect(
      redactText("secret=this is all secret visible=value", { redact: true }),
    ).toBe("secret=[REDACTED] visible=value");

    for (const value of [
      "password=abc]def visible=yes",
      "password=abc}def visible=yes",
      'password=abc"def visible=yes',
      "password=abc`def visible=yes",
    ]) {
      expect(redactText(value, { redact: true })).toBe(
        "password=[REDACTED] visible=yes",
      );
    }

    for (const value of ["token=[(secret] leak)]", "token={(secret} leak)}"]) {
      expect(redactText(value, { redact: true })).toBe("token=[REDACTED]");
    }
  });

  it("bounds malformed JSON fragment work", () => {
    const malformed = "{".repeat(40_000);
    const startedAt = performance.now();

    expect(redactText(malformed, { redact: true })).toBe(malformed);
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });

  it("withholds entire response categories before serialization", () => {
    const privacy = {
      expose: {
        jobData: false,
        jobOptions: false,
        returnValues: false,
        stacktraces: false,
        logs: false,
        schedulerData: false,
      },
    };
    const job = presentJob(createJob(), privacy);

    expect(job.data).toEqual({});
    expect(job.opts).toEqual({});
    expect(job.returnValue).toBeUndefined();
    expect(job.stacktrace).toBeUndefined();
    expect(presentLogs(["secret"], privacy)).toBeNull();
    expect(
      presentScheduler(
        {
          key: "daily",
          name: "daily",
          template: {
            data: { secret: "raw" },
            opts: { authorization: "raw" },
          },
        },
        privacy,
      ).template,
    ).toMatchObject({ data: undefined, opts: undefined });
  });

  it("leaves output untouched when redaction is disabled", () => {
    const job = createJob();
    expect(presentJob(job)).toBe(job);
    expect(redactText("token=visible")).toBe("token=visible");
  });

  it("redacts job group IDs when array group identity paths are hidden", () => {
    const job = createJob();
    job.groupId = "tenant-secret";

    expect(
      presentJob(job, {
        redact: { includeDefaultKeys: false, paths: ["*.id"] },
      }).groupId,
    ).toBe("[REDACTED]");
  });

  it("redacts adapter error messages before they reach tRPC", () => {
    expect(
      presentErrorMessage(new Error("authorization=Bearer-secret"), {
        redact: true,
      }),
    ).toBe("authorization=[REDACTED]");
  });

  it("judges a key from the first character of its token", () => {
    const longKey = `${"a.".repeat(2_048)}password`;
    expect(redactText(`${longKey}=hunter2`, { redact: true })).toBe(
      `${longKey}=[REDACTED]`,
    );
    for (const value of [
      "--password=hunter2",
      "-password: hunter2",
      ".token=hunter2",
      "x-api-key: hunter2",
      "config.password=hunter2",
      '"token": "hunter2"',
      "'token': 'hunter2'",
      'headers?.["token"]=hunter2',
    ]) {
      expect(redactText(value, { redact: true })).not.toContain("hunter2");
    }
    // A search resuming inside a token, right after a PEM footer, still
    // takes the whole multi-word value.
    expect(
      redactText(
        "privateKey=-----BEGIN PRIVATE KEY-----\nKEYDATA\n-----END PRIVATE KEY-----password=correct horse battery",
        { redact: true },
      ),
    ).toBe("privateKey=[REDACTED]password=[REDACTED]");
  });
});

describe("redaction cost", () => {
  const size = 64 * 1_024;
  const fill = (unit: string) => unit.repeat(Math.floor(size / unit.length));
  const base64url = () => {
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let value = "";
    for (let index = 0; index < size; index += 1) {
      value += alphabet[(index * 2_654_435_761) % alphabet.length];
    }
    return value;
  };
  const timed = (run: () => unknown) => {
    const startedAt = performance.now();
    run();
    return performance.now() - startedAt;
  };

  // Each shape used to take from one to tens of seconds, inside one
  // synchronous presentJob on the host's event loop.
  it.each([
    // A key used to be tried from every dot or dash of a token.
    ["dotted token", () => fill("a.")],
    ["dashed token", () => fill("a-")],
    ["base64url token", base64url],
    ["quoted dotted key", () => `"${fill("a.")}`],
    ["bracketed dotted key", () => `x[${fill("a.")}`],
    // Adjacent optional blanks around `?.` split a run every possible way.
    ["key before blanks", () => `a${" ".repeat(size)}x`],
    // An unanchored /\s*$/ restarted at every inner blank.
    ["quoted blanks", () => `"${" ".repeat(size)}x"`],
    // A value's end was looked for again from every blank of a run.
    ["value before blanks", () => `password=a${" ".repeat(size)}b`],
    // Every escaped quote restarted a JSON key scan.
    ["escaped quotes", () => `"${fill('\\"')}`],
    ["escaped JSON", () => `{"a":"${fill('\\"')}"}`],
    // Every unclosed wrapper was scanned to the end before falling back.
    ["unclosed braces", () => fill("a={ ")],
    ["unclosed brackets", () => fill("a=[ ")],
    ["unclosed parentheses", () => fill("a=( ")],
  ])("stays linear on 64KB of %s", (_, build) => {
    const value = build();

    expect(timed(() => redactText(value, { redact: true }))).toBeLessThan(250);
    expect(
      timed(() =>
        presentJob({ ...createJob(), data: { note: value } }, { redact: true }),
      ),
    ).toBeLessThan(250);
  });
});

// Shapes the adapters return for real jobs, captured from each library.
const adaptedJob = (
  job: Pick<AdaptedJob, "id" | "name"> & Partial<AdaptedJob>,
): AdaptedJob => ({
  data: {},
  opts: {},
  createdAt: new Date("2026-01-01T00:00:00Z"),
  processedAt: null,
  finishedAt: null,
  retriedAt: null,
  ...job,
});
const options = (opts: Record<string, unknown>) => opts as AdaptedJob["opts"];

describe("identifiers and traces inside job options", () => {
  const bullmqParent = adaptedJob({
    id: "alice-parent",
    name: "parent",
    opts: options({ attempts: 0, jobId: "alice-parent" }),
  });
  // [library, job, raw values that must not survive identity redaction]
  const jobIdShapes: [string, AdaptedJob, string[]][] = [
    [
      "BullMQ custom id",
      adaptedJob({
        id: "alice@example.com",
        name: "welcome",
        opts: options({ attempts: 0, jobId: "alice@example.com" }),
      }),
      ["alice@example.com"],
    ],
    [
      "BullMQ flow child",
      adaptedJob({
        id: "alice-child",
        name: "child",
        opts: options({
          attempts: 0,
          jobId: "alice-child",
          parent: { id: "alice-parent", queue: "bull:emails" },
        }),
      }),
      ["alice-child", "alice-parent"],
    ],
    [
      "BullMQ job scheduler",
      adaptedJob({
        id: "repeat:alice-digest:1790264104736",
        name: "digest",
        opts: options({
          attempts: 0,
          jobId: "repeat:alice-digest:1790264104736",
          repeat: { every: 600_000, count: 1 },
        }),
      }),
      ["alice-digest"],
    ],
    [
      "BullMQ 5 repeatable",
      adaptedJob({
        id: "repeat:005dd570324496274ef68f593e0e3dda:1790264400000",
        name: "digest",
        opts: options({
          attempts: 0,
          prevMillis: 1_790_264_400_000,
          jobId: "repeat:005dd570324496274ef68f593e0e3dda:1790264400000",
          repeat: { jobId: "alice-digest", count: 1, every: 600_000 },
        }),
      }),
      ["alice-digest", "005dd570324496274ef68f593e0e3dda"],
    ],
    [
      "Bull custom id",
      adaptedJob({
        id: "alice@example.com",
        name: "Default",
        opts: options({ jobId: "alice@example.com", attempts: 1, delay: 0 }),
      }),
      ["alice@example.com"],
    ],
    [
      "Bull repeatable",
      adaptedJob({
        id: "repeat:c7a3fac61136ac70e7974655fa316365:1790264400000",
        name: "digest",
        opts: options({
          repeat: {
            count: 1,
            key: "digest:alice-digest::600000",
            every: 600_000,
            jobId: "alice-digest",
          },
          jobId: "repeat:c7a3fac61136ac70e7974655fa316365:1790264400000",
          prevMillis: 1_790_264_400_000,
          attempts: 1,
        }),
      }),
      ["alice-digest", "c7a3fac61136ac70e7974655fa316365"],
    ],
    [
      "Bee-Queue custom id",
      adaptedJob({
        id: "alice@example.com",
        name: "alice@example.com",
        opts: options({ timestamp: 1_790_264_104_858 }),
      }),
      ["alice@example.com"],
    ],
    [
      "GroupMQ",
      adaptedJob({
        id: "alice-job",
        name: "sync",
        groupId: "tenant-7",
        opts: options({ attempts: 3 }),
      }),
      ["alice-job"],
    ],
  ];

  it.each([{ keys: ["id"] }, { paths: ["id"] }])(
    "hides every copy of a job id: %j",
    (rules) => {
      const privacy = { redact: { includeDefaultKeys: false, ...rules } };
      for (const [library, job, rawValues] of jobIdShapes) {
        const presented = presentJob(job, privacy);
        const output = JSON.stringify(presented);
        for (const raw of rawValues) {
          expect(output, `${library} leaked ${raw}`).not.toContain(raw);
        }
        expect(presented.id, library).toMatch(/^\[REDACTED\]:[0-9a-f]{16}$/u);
        // Every `jobId` above is the job's own id, so it gets the same
        // pseudonym.
        expect((presented.opts as Record<string, unknown>).jobId, library).toBe(
          "jobId" in job.opts ? presented.id : undefined,
        );
      }

      const [, child] = jobIdShapes[1]!;
      expect(presentJob(child, privacy).opts).toMatchObject({
        parent: {
          id: presentJob(bullmqParent, privacy).id,
          queue: "bull:emails",
        },
      });
    },
  );

  it.each([{ keys: ["groupId"] }, { paths: ["groupId"] }, { paths: ["*.id"] }])(
    "hides group ids kept in options: %j",
    (rules) => {
      const privacy = { redact: { includeDefaultKeys: false, ...rules } };
      for (const job of [
        adaptedJob({
          id: "1",
          name: "sync",
          groupId: "tenant-alice",
          opts: options({ attempts: 0, group: { id: "tenant-alice" } }),
        }),
        adaptedJob({
          id: "job-1",
          name: "tenant-alice",
          groupId: "tenant-alice",
          opts: options({ attempts: 3, groupId: "tenant-alice" }),
        }),
      ]) {
        const presented = presentJob(job, privacy);
        expect(JSON.stringify(presented)).not.toContain("tenant-alice");
        expect(presented.groupId).toBe("[REDACTED]");
      }
    },
  );

  it("keeps stacks out of options and failure reasons when traces are hidden", () => {
    const stack =
      "Error: boom\n    at processJob (/srv/app/worker.js:42:15)\n    at Queue._runJob (/srv/app/node_modules/bee-queue/lib/queue.js:612:17)";
    const failed = adaptedJob({
      id: "7",
      name: "charge",
      opts: options({ timestamp: 1_790_264_104_858, stacktraces: [stack] }),
      failedReason: stack,
      stacktrace: [stack],
    });

    for (const privacy of [
      { expose: { stacktraces: false } },
      { redact: true, expose: { stacktraces: false } },
    ]) {
      const presented = presentJob(failed, privacy);
      expect(presented.failedReason).toBe("Error: boom");
      expect(presented.stacktrace).toBeUndefined();
      expect(presented.opts).toEqual({ timestamp: 1_790_264_104_858 });
      expect(JSON.stringify(presented)).not.toContain("worker.js");
    }
    expect(presentJob(failed, { expose: { jobData: false } })).toMatchObject({
      failedReason: stack,
      opts: { stacktraces: [stack] },
    });
  });
});
