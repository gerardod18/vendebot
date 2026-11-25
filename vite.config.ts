import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Lets a quick tunnel (cloudflared) expose the dev UI, e.g. for Meta's privacy/terms URL checks.
  server: { allowedHosts: [".trycloudflare.com"] },
});
