// Runs after `next build`. The landing page (../index.html) is the site's front
// page. The static export writes the "/" route handler to out/index, which static
// hosts do not serve at "/", so place the landing page at out/index.html.
import { copyFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
await copyFile(path.join(web, "..", "index.html"), path.join(web, "out", "index.html"));
await rm(path.join(web, "out", "index"), { force: true });
console.log("Landing page copied to out/index.html");
