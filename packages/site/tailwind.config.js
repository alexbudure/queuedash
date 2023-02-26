/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    fontFamily: {
      sans: [
        "Inter var, sans-serif",
        { fontFeatureSettings: '"cv11", "ss01", "rlig", "calt" 0, "tnum"' },
      ],
    },
  },
  plugins: [require("@tailwindcss/forms")],
};
