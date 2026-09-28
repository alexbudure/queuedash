// Apps install only the queue library and server framework they use, so the
// built package has to load with every other optional peer missing. One
// imported at the top of a module breaks every app without it, as groupmq did
// in 4.0.0.
import nodeModule, { createRequire } from "node:module";

if (!nodeModule.registerHooks) {
  console.warn(
    "Skipped the optional peer check: it needs Node 22.15 or newer.",
  );
  process.exit(0);
}

const require = createRequire(import.meta.url);
const { peerDependenciesMeta } = require("../package.json");
const optionalPeers = Object.keys(peerDependenciesMeta).filter(
  (name) => peerDependenciesMeta[name].optional,
);

nodeModule.registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      optionalPeers.some(
        (name) => specifier === name || specifier.startsWith(`${name}/`),
      )
    ) {
      throw new Error(
        `${context.parentURL} imports the optional peer "${specifier}" as it loads. Import it with await import() where it is used instead.`,
      );
    }
    return nextResolve(specifier, context);
  },
});

await import("../dist/main.mjs");
require("../dist/main.js");
console.log(`Loads without its optional peers: ${optionalPeers.join(", ")}`);
