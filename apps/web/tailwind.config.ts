import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        "brand-900": "#0b1324",
        "brand-700": "#1b2a4a",
        "brand-500": "#365a9c",
        "brand-300": "#9bb6f0",
        "brand-100": "#e6edff"
      }
    }
  },
  plugins: []
};

export default config;
