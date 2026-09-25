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
    // .shots holds a live browser-automation profile (screenshots/CDP tooling),
    // not source — its files get locked/rewritten while a browser session is
    // open, which crashes Vite's fs watcher (EBUSY) if it tries to watch them.
    watch: { ignored: ["**/.shots/**"] },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
