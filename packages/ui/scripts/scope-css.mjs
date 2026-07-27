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

const source = await readFile(stylesheetPath, "utf8");
const root = postcss.parse(source);

root.walkRules((rule) => {
  if (hasRuleAncestor(rule) || isInsideKeyframes(rule)) return;

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

await writeFile(stylesheetPath, root.toString());
