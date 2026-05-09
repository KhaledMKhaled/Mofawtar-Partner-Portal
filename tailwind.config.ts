import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./client/index.html", "./client/src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1rem" },
    extend: {
      colors: {
        // Mofawtar brand
        violet: {
          DEFAULT: "#4046B5",
          50: "#F1F2FB",
          100: "#E4E5F6",
          200: "#C7CAEC",
          300: "#9DA2DD",
          400: "#6B72CB",
          500: "#4046B5",
          600: "#363CA0",
          700: "#2D3284",
          800: "#252968",
          900: "#1B1F4F",
        },
        magnolia: "#ECECF7",
        ink: "#07081A",
        // Semantic
        background: "#FFFFFF",
        surface: "#FAFAFE",
        border: "#E4E5F0",
        muted: "#6B7280",
        success: "#16A34A",
        warning: "#D97706",
        danger: "#DC2626",
        info: "#2563EB",
      },
      fontFamily: {
        sans: [
          "Inter",
          "Dubai",
          "IBM Plex Sans Arabic",
          "system-ui",
          "sans-serif",
        ],
        display: ["Jomhuria", "Inter", "Dubai", "sans-serif"],
        arabic: ["Dubai", "IBM Plex Sans Arabic", "Inter", "sans-serif"],
      },
      borderRadius: {
        stamp: "14px",
      },
      boxShadow: {
        stamp: "0 1px 0 0 rgba(7,8,26,0.04), 0 8px 24px -12px rgba(64,70,181,0.18)",
        soft: "0 1px 2px rgba(7,8,26,0.04), 0 1px 3px rgba(7,8,26,0.06)",
      },
      backgroundImage: {
        "dashed-x":
          "repeating-linear-gradient(90deg, currentColor 0 6px, transparent 6px 12px)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
