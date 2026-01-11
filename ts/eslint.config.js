import js from "@eslint/js"
import tseslint from "@typescript-eslint/eslint-plugin"
import tsparser from "@typescript-eslint/parser"
import prettier from "eslint-plugin-prettier"
import prettierConfig from "eslint-config-prettier"

export default [
    js.configs.recommended,
    {
        files: ["src/**/*.ts"],
        languageOptions: {
            parser: tsparser,
            ecmaVersion: 2020,
            sourceType: "module",
            globals: {
                console: "readonly",
                window: "readonly",
                document: "readonly",
                crypto: "readonly",
                fetch: "readonly",
                WebSocket: "readonly",
                RTCPeerConnection: "readonly",
                RTCDataChannel: "readonly",
                RTCConfiguration: "readonly",
                RTCIceServer: "readonly",
                RTCSessionDescription: "readonly",
                MediaStream: "readonly",
                MediaStreamTrack: "readonly",
                AudioContext: "readonly",
                File: "readonly",
                Response: "readonly",
                URLSearchParams: "readonly",
                TextEncoder: "readonly",
                TextDecoder: "readonly",
                Event: "readonly",
                WebAssembly: "readonly",
                atob: "readonly",
                btoa: "readonly",
                setTimeout: "readonly",
                clearTimeout: "readonly",
                setInterval: "readonly",
                clearInterval: "readonly",
            },
        },
        plugins: {
            "@typescript-eslint": tseslint,
            prettier: prettier,
        },
        rules: {
            ...tseslint.configs.recommended.rules,
            ...prettierConfig.rules,
            "prettier/prettier": "error",
            "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
            "@typescript-eslint/explicit-function-return-type": "off",
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/no-non-null-assertion": "warn",
            "no-console": "off",
            "prefer-const": "error",
            "no-var": "error",
        },
    },
]
