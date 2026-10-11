/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,html}",
    "./pages/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./app/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // ─────────────────────────────────────────────
      // SOULIDITY COLOR SYSTEM
      // ─────────────────────────────────────────────
      colors: {
        // Background layers (darkest → lightest)
        soul: {
          bg:       "#0D0A1E", // page base — deep space purple-black
          card:     "#1A1040", // primary card / panel
          card2:    "#261558", // nested card / secondary surface
          border:   "#2E1B6E", // subtle border between surfaces
        },

        // Brand purple (Soul / identity layer)
        purple: {
          DEFAULT:  "#A855F7",
          light:    "#C084FC",
          dark:     "#7C3AED",
          deep:     "#4C1D95",
          glow:     "#7C3AED", // glow orb / radial bg
        },

        // Gold / amber (SoulPass / value layer)
        gold: {
          DEFAULT:  "#F59E0B",
          light:    "#FCD34D",
          dark:     "#D97706",
        },

        // Teal (SoulGrant / access layer)
        teal: {
          DEFAULT:  "#14B8A6",
          light:    "#5EEAD4",
          dark:     "#0F766E",
        },

        // Text
        white: {
          DEFAULT:  "#F8F5FF", // brand white — slightly purple-tinted
          pure:     "#FFFFFF",
        },
        muted:      "#9B8EC4", // secondary body text

        // Status
        success:    "#10B981",
        danger:     "#EF4444",
        planned:    "#A855F7",
      },

      // ─────────────────────────────────────────────
      // TYPOGRAPHY
      // ─────────────────────────────────────────────
      fontFamily: {
        heading: ["Space Grotesk", "Inter", "Trebuchet MS", "sans-serif"],
        body:    ["Inter", "DM Sans", "Calibri", "sans-serif"],
        mono:    ["JetBrains Mono", "Fira Code", "monospace"],
      },
      fontSize: {
        // Label (all-caps small tag above title)
        "label":   ["0.6875rem", { lineHeight: "1", letterSpacing: "0.12em", fontWeight: "700" }],
        // Body
        "body-sm": ["0.8125rem", { lineHeight: "1.6" }],
        "body":    ["0.875rem",  { lineHeight: "1.6" }],
        "body-lg": ["1rem",      { lineHeight: "1.6" }],
        // Cards
        "card-title": ["1.125rem", { lineHeight: "1.3", fontWeight: "700" }],
        // Section headings
        "h3": ["1.5rem",   { lineHeight: "1.25", fontWeight: "700" }],
        "h2": ["2rem",     { lineHeight: "1.2",  fontWeight: "700" }],
        "h1": ["2.5rem",   { lineHeight: "1.15", fontWeight: "700" }],
        // Hero
        "hero": ["3.5rem",  { lineHeight: "1.1",  fontWeight: "700" }],
        "display": ["4rem", { lineHeight: "1.05", fontWeight: "700" }],
      },

      // ─────────────────────────────────────────────
      // SPACING (matches deck's ~0.6" base margin → ~48px)
      // ─────────────────────────────────────────────
      spacing: {
        "page-x": "3rem",       // 48px horizontal page padding
        "section": "5rem",      // 80px between sections
        "card-pad": "1.5rem",   // 24px inner card padding
      },

      // ─────────────────────────────────────────────
      // BORDER RADIUS
      // ─────────────────────────────────────────────
      borderRadius: {
        card: "0.5rem",    // 8px — panels & cards
        badge: "0.25rem",  // 4px — status badges
        pill: "9999px",    // pills / tags
      },

      // ─────────────────────────────────────────────
      // BOX SHADOWS (glow effects)
      // ─────────────────────────────────────────────
      boxShadow: {
        "glow-purple": "0 0 24px 4px rgba(168,85,247,0.25)",
        "glow-gold":   "0 0 24px 4px rgba(245,158,11,0.25)",
        "glow-teal":   "0 0 24px 4px rgba(20,184,166,0.25)",
        "card":        "0 4px 24px 0 rgba(0,0,0,0.45)",
        "card-hover":  "0 8px 40px 0 rgba(168,85,247,0.18)",
      },

      // ─────────────────────────────────────────────
      // BACKGROUND GRADIENTS
      // ─────────────────────────────────────────────
      backgroundImage: {
        // Deep space base
        "space":        "radial-gradient(ellipse at 70% 30%, #261558 0%, #0D0A1E 60%)",
        // Purple glow orb (top-right decorative)
        "orb-purple":   "radial-gradient(circle, rgba(124,58,237,0.22) 0%, transparent 70%)",
        "orb-gold":     "radial-gradient(circle, rgba(245,158,11,0.15) 0%, transparent 70%)",
        // Card accent bar gradients
        "bar-purple":   "linear-gradient(90deg, #A855F7, #7C3AED)",
        "bar-gold":     "linear-gradient(90deg, #F59E0B, #FCD34D)",
        "bar-teal":     "linear-gradient(90deg, #14B8A6, #5EEAD4)",
        // Hero section
        "hero-bg":      "radial-gradient(ellipse 80% 60% at 75% 20%, rgba(124,58,237,0.18) 0%, transparent 100%)",
      },

      // ─────────────────────────────────────────────
      // ANIMATIONS
      // ─────────────────────────────────────────────
      keyframes: {
        "glow-pulse": {
          "0%, 100%": { opacity: "0.6" },
          "50%":      { opacity: "1" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(20px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "glow-pulse": "glow-pulse 3s ease-in-out infinite",
        "fade-up":    "fade-up 0.5s ease-out both",
      },
    },
  },
  plugins: [],
};
