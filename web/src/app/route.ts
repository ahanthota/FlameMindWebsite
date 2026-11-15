/**
 * The site's front page ("/") is the landing page kept in web/index.html.
 * It is served as-is, outside the app's layout. Its "Launch FlameMind" button
 * opens the app at /home/.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

// Required for the static export: the response is rendered once at build time.
export const dynamic = "force-static";

export async function GET() {
  const html = await readFile(path.join(process.cwd(), "index.html"), "utf8");
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
