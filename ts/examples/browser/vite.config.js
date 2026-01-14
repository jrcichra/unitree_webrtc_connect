import { defineConfig } from "vite"
import { nodePolyfills } from "vite-plugin-node-polyfills"

export default defineConfig({
    root: ".",
    plugins: [nodePolyfills()],
    server: {
        proxy: {
            "/offer": {
                target: "http://10.0.0.207:8081",
                changeOrigin: true,
            },
            "/con_notify": {
                target: "http://10.0.0.207:9991",
                changeOrigin: true,
            },
            "/con_ing_": {
                target: "http://10.0.0.207:9991",
                changeOrigin: true,
            },
        },
    },
    build: {
        outDir: "dist",
        rollupOptions: {
            input: "main.ts",
            output: {
                entryFileNames: "main.js",
            },
        },
    },
})
