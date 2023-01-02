/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    fontFamily: {
      sans: [
        "Inter var, sans-serif",
        { fontFeatureSettings: '"cv11", "ss01", "rlig", "calt" 0, "tnum"' },
      ],
    },
    extend: {
      colors: {
        brand: {
          50: "#edfbff",
          100: "#d6f5ff",
          200: "#b5efff",
          300: "#83e8ff",
          400: "#48d8ff",
          500: "#1ebcff",
          600: "#069fff",
          700: "#008cff",
          800: "#086ac5",
          900: "#0d5b9b",
        },
      },
    },
  },
  plugins: [require("tailwindcss-radix")()],
};
