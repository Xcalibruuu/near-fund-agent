import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/browser/main.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  outfile: "public/app.js",
  legalComments: "none",
  logLevel: "info",
});
