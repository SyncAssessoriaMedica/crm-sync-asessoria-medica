import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Sync Marketing brand tokens
        background: "#ffffff",
        "background-subtle": "#f7faf8",
        surface: "#ffffff",
        "surface-elevated": "#f2f7f3",
        "sidebar-dark": "#07100b",
        border: "#dfe7e1",
        "border-strong": "#c5d1c8",
        "text-primary": "#07100b",
        "text-secondary": "#526058",
        "text-muted": "#8a948d",
        // Brand greens
        "brand-green": "#22c55e",
        "brand-green-dark": "#16a34a",
        "brand-green-bright": "#46e27f",
        "brand-green-soft": "#e8f9ee",
        "brand-green-deep": "#0f4f2a",
        // Semantic
        "danger-red": "#dc2626",
        "danger-soft": "#fee2e2",
        "warning-amber": "#f59e0b",
        // shadcn compat
        foreground: "#07100b",
        card: { DEFAULT: "#ffffff", foreground: "#07100b" },
        popover: { DEFAULT: "#ffffff", foreground: "#07100b" },
        primary: { DEFAULT: "#22c55e", foreground: "#07100b" },
        secondary: { DEFAULT: "#f7faf8", foreground: "#07100b" },
        muted: { DEFAULT: "#f7faf8", foreground: "#526058" },
        accent: { DEFAULT: "#e8f9ee", foreground: "#07100b" },
        destructive: { DEFAULT: "#dc2626", foreground: "#ffffff" },
        input: "#dfe7e1",
        ring: "#22c55e",
      },
      borderRadius: {
        lg: "12px",
        md: "8px",
        sm: "6px",
        xl: "16px",
        "2xl": "20px",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
      },
      fontSize: {
        "2xs": ["0.625rem", { lineHeight: "0.875rem" }],
      },
      letterSpacing: {
        widest: "0.15em",
      },
      boxShadow: {
        card: "0 1px 3px 0 rgba(7,16,11,0.06), 0 1px 2px -1px rgba(7,16,11,0.04)",
        "card-hover":
          "0 4px 12px 0 rgba(7,16,11,0.08), 0 2px 4px -1px rgba(7,16,11,0.05)",
        "success-glow": "0 0 0 3px rgba(34, 197, 94, 0.18)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;
