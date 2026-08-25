import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/* In production FastAPI serves FE/dist itself, so there is one process and one
   port on the site LAN. In development Vite serves the UI and proxies the API
   and the uploaded scans through to the backend, so both look same-origin. */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8000",
      "/uploads": "http://localhost:8000",
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
