module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: "#f8fafc",
        foreground: "#0f172a",
        card: "#ffffff",
        primary: "#6366f1",
        accent: "#8b5cf6",
        muted: "#f1f5f9",
        border: "#e2e8f0"
      },
      boxShadow: {
        glow: "0 0 20px rgba(99, 102, 241, 0.2)",
        soft: "0 4px 20px rgba(0, 0, 0, 0.08)",
        card: "0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06)"
      }
    }
  },
  plugins: []
}