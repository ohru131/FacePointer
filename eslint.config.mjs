import globals from "globals";

export default [
    {
        ignores: ["dist/mediapipe/**", "src-tauri/**", "node_modules/**", "outputs/**", "models/**", "test-results/**", "playwright-report/**"]
    },
    {
        files: ["dist/**/*.js", "scripts/**/*.{js,mjs}", "tests/**/*.{js,mjs}", "*.mjs"],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: { ...globals.browser }
        },
        rules: {
            "no-undef": "error",
            "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }]
        }
    },
    {
        files: ["scripts/**/*.{js,mjs}", "tests/**/*.{js,mjs}", "*.mjs"],
        languageOptions: { globals: { ...globals.node } }
    }
];
