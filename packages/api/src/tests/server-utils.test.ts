import { describe, expect, test } from "vitest";

import { createQueuedashHtml } from "../server-adapters/utils";

describe("createQueuedashHtml", () => {
  test("includes server-provided UI configuration in the bootstrap", () => {
    const html = createQueuedashHtml("/admin/queuedash", {
      instanceId: "operations",
      branding: {
        name: "Acme Queues",
        logoUrl: "/assets/acme.svg",
        logoAlt: "Acme",
      },
      defaults: {
        theme: "dark",
      },
    });

    expect(html).toContain("<title>Acme Queues</title>");
    expect(html).toContain('"apiUrl":"/admin/queuedash/trpc"');
    expect(html).toContain('"instanceId":"operations"');
    expect(html).toContain('"logoUrl":"/assets/acme.svg"');
    expect(html).toContain('"theme":"dark"');
  });

  test("escapes branding and bootstrap values before embedding them", () => {
    const html = createQueuedashHtml("</script><script>alert(1)</script>", {
      branding: {
        name: "</title><script>alert(1)</script>",
      },
    });

    expect(html).toContain(
      "<title>&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;</title>",
    );
    expect(html).toContain("\\u003c/script\\u003e");
    expect(html).not.toContain(
      'window.__INITIAL_STATE__ = {"apiUrl":"</script>',
    );
  });

  test("uses Queuedash when no custom product name is configured", () => {
    const html = createQueuedashHtml("/queuedash");
    expect(html).toContain("<title>Queuedash</title>");
  });
});
