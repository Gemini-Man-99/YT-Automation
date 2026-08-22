import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dev server proxies /excido -> https://api.excido.app so the browser
// makes same-origin requests and never hits CORS during local development.
// Set VITE_EXCIDO_API_BASE=/excido in your .env to use it (see .env.example).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/excido": {
        target: "https://api.excido.app",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/excido/, ""),
      },
    },
  },
});
