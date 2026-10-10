import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

// Firebase Hosting serves this app as a static single-page application. Data and
// authentication are provided by the Firebase browser SDK, not a server worker.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  server: { host: "127.0.0.1", port: 5173 },
});
