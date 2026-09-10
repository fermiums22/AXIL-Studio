import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const studioDirectory = path.resolve(scriptDirectory, "..");
const distDirectory = path.join(studioDirectory, "dist");
const sourceHtmlPath = path.join(distDirectory, "index.html");
const outputHtmlPath = path.join(studioDirectory, "index.html");

let html = await readFile(sourceHtmlPath, "utf8");

const scriptTag = html.match(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/);
const styleTag = html.match(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/);

if (!scriptTag || !styleTag) {
  throw new Error("Vite output does not contain the expected script and stylesheet tags.");
}

function assetPath(reference) {
  return path.join(distDirectory, reference.replace(/^\.\//, "").replace(/^\//, ""));
}

const javascript = (await readFile(assetPath(scriptTag[1]), "utf8")).replace(/<\/script/gi, "<\\/script");
const stylesheet = (await readFile(assetPath(styleTag[1]), "utf8")).replace(/<\/style/gi, "<\\/style");

html = html
  .replace(scriptTag[0], () => `<script type="module">\n${javascript}\n</script>`)
  .replace(styleTag[0], () => `<style>\n${stylesheet}\n</style>`);

await writeFile(outputHtmlPath, html, "utf8");
console.log(`Standalone page: ${outputHtmlPath}`);
