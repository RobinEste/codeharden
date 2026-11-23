import { defineConfig } from "vitest/config";
export default defineConfig({ test: { projects: [{ test: { name: "par", include: ["*.test.mjs"] } }] } });
