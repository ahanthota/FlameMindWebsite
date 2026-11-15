import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const webDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Firebase Hosting serves the static export in web/out.
  output: "export",
  // Emit /explore/index.html so every route works on a plain static host.
  trailingSlash: true,
  turbopack: {
    // The repository root, so src/lib/data.ts can import ../data/*.json.
    // Turbopack does not resolve files outside its root. Setting it here also
    // stops a lockfile in the home directory from being picked as the root.
    root: path.dirname(webDir),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
