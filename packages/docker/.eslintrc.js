module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
  ignorePatterns: ["**/node_modules", "**/.cache", "dist", ".eslintrc.js"],
  extends: ["eslint:recommended", "prettier"],
  rules: {
    "no-unused-vars": "error",
  },
};
