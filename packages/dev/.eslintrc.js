module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: "./tsconfig.json",
  },
  ignorePatterns: [
    "**/node_modules",
    "**/.cache",
    "build",
    ".next",
    ".eslintrc.js",
    "next.config.js",
  ],
  plugins: ["@typescript-eslint", "tailwindcss"],
  extends: [
    "next/core-web-vitals",
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:tailwindcss/recommended",
    "prettier",
  ],
  rules: {
    "@typescript-eslint/consistent-type-imports": "warn",
    "@typescript-eslint/no-unused-vars": "error",
    "@typescript-eslint/no-explicit-any": "error",
  },
};
