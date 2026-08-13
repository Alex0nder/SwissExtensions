const readonly = "readonly"

export default [
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: Object.fromEntries(
        [
          "Array",
          "Boolean",
          "Date",
          "Error",
          "FileReader",
          "Map",
          "Math",
          "Number",
          "Object",
          "OffscreenCanvas",
          "Promise",
          "Set",
          "String",
          "SwissCore",
          "URL",
          "URLSearchParams",
          "chrome",
          "clearTimeout",
          "console",
          "createImageBitmap",
          "decodeURIComponent",
          "encodeURIComponent",
          "fetch",
          "globalThis",
          "importScripts",
          "indexedDB",
          "isNaN",
          "parseInt",
          "setTimeout",
        ].map((name) => [name, readonly])
      ),
    },
    rules: { "no-undef": "error" },
  },
]
