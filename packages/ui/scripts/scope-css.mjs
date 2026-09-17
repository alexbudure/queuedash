import { watch } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";

import postcss from "postcss";

const stylesheetPath = new URL("../dist/styles.css", import.meta.url);
const rootSelector = "[data-queuedash-root]";
const scopedRootSelector = rootSelector.repeat(3);

const splitSelectorList = (selectorList) => {
  const selectors = [];
  let current = "";
  let depth = 0;
  let quote = null;

  for (const character of selectorList) {
    if (quote) {
      current += character;
      if (character === quote) quote = null;
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }

    if (character === "(" || character === "[") depth += 1;
    if (character === ")" || character === "]") depth -= 1;

    if (character === "," && depth === 0) {
      selectors.push(current.trim());
      current = "";
      continue;
    }

    current += character;
  }

  if (current.trim()) selectors.push(current.trim());
  return selectors;
};

const hasRuleAncestor = (rule) => {
  let parent = rule.parent;
  while (parent) {
    if (parent.type === "rule") return true;
    parent = parent.parent;
  }
  return false;
};

const isInsideKeyframes = (rule) => {
  let parent = rule.parent;
  while (parent) {
    if (
      parent.type === "atrule" &&
      (parent.name === "keyframes" || parent.name.endsWith("keyframes"))
    ) {
      return true;
    }
    parent = parent.parent;
  }
  return false;
};

/**
 * Tailwind v4 emits `space-*` / `divide-*` as a nested, zero-specificity rule:
 *
 *   .space-y-3 { :where(& > :not(:last-child)) { margin-block-end: … } }
 *
 * That works upstream because preflight's `*, ::before, ::after { margin: 0 }`
 * sits in a lower cascade layer. We unwrap layers below (so the stylesheet wins
 * against unlayered host CSS), which drops back to pure specificity - and the
 * scoped preflight is `[data-queuedash-root]x3 *`, i.e. (0,3,0), against
 * `:where(...)` at (0,0,0). Every space-y in the app silently collapsed to 0.
 *
 * Unwrapping the `:where()` gives the nested selector the parent's specificity,
 * which restores the intended precedence.
 */
const unwrapWhereAroundParentSelector = (selector) => {
  const prefix = ":where(";
  if (!selector.startsWith(prefix) || !selector.endsWith(")")) return selector;

  // Only unwrap when the opening `:where(` closes at the very end, so we never
  // touch a selector that merely starts with one.
  let depth = 0;
  for (let index = prefix.length - 1; index < selector.length; index += 1) {
    const character = selector[index];
    if (character === "(") depth += 1;
    else if (character === ")") {
      depth -= 1;
      if (depth === 0) {
        if (index !== selector.length - 1) return selector;
        break;
      }
    }
  }

  const inner = selector.slice(prefix.length, -1).trim();
  // `&` has to be present, or the unwrap would change what the rule matches.
  return inner.startsWith("&") ? inner : selector;
};

const scopeSelector = (selector) => {
  if (!selector || selector.includes(scopedRootSelector)) return selector;

  if (selector.includes(rootSelector)) {
    return selector.replaceAll(rootSelector, scopedRootSelector);
  }

  if (selector === ":root" || selector === ":host") {
    return scopedRootSelector;
  }

  if (selector === "html" || selector === "body") {
    return scopedRootSelector;
  }

  if (selector === "*") {
    return `${scopedRootSelector}, ${scopedRootSelector} *`;
  }

  if (selector.startsWith("::")) {
    return `${scopedRootSelector}${selector}, ${scopedRootSelector} *${selector}`;
  }

  return `${scopedRootSelector} ${selector}`;
};

const scopeStylesheet = async () => {
  const source = await readFile(stylesheetPath, "utf8");
  const root = postcss.parse(source);
  const animationNames = new Map();
  const tailwindVariablePrefix = "--tw-";
  const queuedashTailwindVariablePrefix = "--queuedash-tw-";

  const namespaceTailwindVariables = (value) =>
    value.replaceAll(tailwindVariablePrefix, queuedashTailwindVariablePrefix);

  root.walkAtRules("property", (atRule) => {
    atRule.params = namespaceTailwindVariables(atRule.params);
  });

  root.walkAtRules((atRule) => {
    if (atRule.name !== "keyframes" && !atRule.name.endsWith("keyframes")) {
      return;
    }

    const originalName = atRule.params.trim();
    const scopedName = originalName.startsWith("queuedash-")
      ? originalName
      : `queuedash-${originalName}`;
    animationNames.set(originalName, scopedName);
    atRule.params = scopedName;
  });

  const escapeRegExp = (value) =>
    value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");

  root.walkDecls((declaration) => {
    declaration.prop = namespaceTailwindVariables(declaration.prop);
    declaration.value = namespaceTailwindVariables(declaration.value);
    for (const [originalName, scopedName] of animationNames) {
      const animationName = new RegExp(
        `(?<![-_a-zA-Z0-9])${escapeRegExp(originalName)}(?![-_a-zA-Z0-9])`,
        "gu",
      );
      declaration.value = declaration.value.replaceAll(
        animationName,
        scopedName,
      );
    }
  });

  root.walkRules((rule) => {
    if (isInsideKeyframes(rule)) return;

    if (hasRuleAncestor(rule)) {
      rule.selector = splitSelectorList(rule.selector)
        .map(unwrapWhereAroundParentSelector)
        .join(", ");
      return;
    }

    rule.selector = Array.from(
      new Set(splitSelectorList(rule.selector).map(scopeSelector)),
    ).join(", ");
  });

  // Tailwind v4 emits its rules in cascade layers. Unlayered rules in a host
  // application beat layered rules regardless of selector specificity, so unwrap
  // Queuedash's layers after scoping. This keeps the stylesheet self-contained
  // while allowing the root specificity above to win normal host CSS collisions.
  root.walkAtRules("layer", (atRule) => {
    if (atRule.nodes) {
      atRule.replaceWith(...atRule.nodes);
    } else {
      atRule.remove();
    }
  });

  root.walkAtRules("property", (atRule) => {
    if (atRule.params.includes(tailwindVariablePrefix)) {
      throw new Error(
        `Unscoped Tailwind property registration: ${atRule.params}`,
      );
    }
  });
  root.walkDecls((declaration) => {
    if (
      declaration.prop.includes(tailwindVariablePrefix) ||
      declaration.value.includes(tailwindVariablePrefix)
    ) {
      throw new Error(`Unscoped Tailwind variable: ${declaration.toString()}`);
    }
  });

  const scoped = root.toString();
  if (scoped !== source) await writeFile(stylesheetPath, scoped);
};

if (process.argv.includes("--watch")) {
  let timer;
  let tail = Promise.resolve();
  watch(new URL("../dist", import.meta.url), (_, filename) => {
    if (filename?.toString() !== "styles.css") return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      tail = tail.then(scopeStylesheet).catch((error) => {
        console.error(error);
      });
    }, 75);
  });
}

await scopeStylesheet();
