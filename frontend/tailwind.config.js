export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#122023",
        ember: "#f05d23",
        mint: "#27d5a7",
        steel: "#38454a",
        fog: "#f4f7f6",
      },
      fontFamily: {
        display: ["Syne", "sans-serif"],
        body: ["Space Grotesk", "sans-serif"],
      },
      boxShadow: {
        card: "0 14px 40px rgba(10, 32, 38, 0.15)",
      },
      keyframes: {
        riseIn: {
          "0%": { opacity: 0, transform: "translateY(10px)" },
          "100%": { opacity: 1, transform: "translateY(0)" },
        },
      },
      animation: {
        riseIn: "riseIn 400ms ease-out both",
      },
    },
  },
  plugins: [],
};
