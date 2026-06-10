import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
  build: {
    outDir: "fbuild",
  },
  server: {
    port: 5173,
    host: true,
  },
});
