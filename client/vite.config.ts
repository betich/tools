import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@tools/shared": fileURLToPath(new URL("../shared/src/index.ts", import.meta.url)),
    },
  },
  // The codec worker imports its encoders on demand, which needs a real module worker.
  worker: { format: "es" },

  // jSquash ships its own wasm; Vite's dep pre-bundler mangles the module URLs.
  optimizeDeps: {
    exclude: ["@jsquash/avif", "@jsquash/jpeg", "@jsquash/png", "@jsquash/webp", "@jsquash/oxipng"],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: process.env.VITE_API_TARGET ?? "http://localhost:8787", changeOrigin: true },
    },
  },
  build: {
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          sheets: ["papaparse", "read-excel-file/browser"],
        },
      },
    },
  },
});
