import { buildXDC, eruda, mockWebxdc } from "@webxdc/vite-plugins";
import { defineConfig } from "vite";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({plugins: [buildXDC({filter: (fileName) => fileName != "privacy.html"}), eruda(), mockWebxdc()]});
