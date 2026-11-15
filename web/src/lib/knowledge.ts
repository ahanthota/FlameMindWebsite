/**
 * Counts from data/chunks.json, the text index that covers every PSI
 * investigation (data/investigations.json holds only those with extracted
 * test records). Read from disk at build time: the file is too large to
 * import as a typed module. Server Components only.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

interface ChunkRef {
  investigation_id: string;
  file_name: string;
}

export interface KnowledgeStats {
  /** Investigations with at least one indexed text chunk. */
  investigations: number;
  /** Distinct source documents (one file within one investigation). */
  sources: number;
}

export function knowledgeStats(): KnowledgeStats {
  let chunks: ChunkRef[] = [];
  try {
    chunks = JSON.parse(readFileSync(path.join(process.cwd(), "..", "data", "chunks.json"), "utf8")) as ChunkRef[];
  } catch {
    // No index yet: the page shows zero and the pipeline hint.
  }
  return {
    investigations: new Set(chunks.map((chunk) => chunk.investigation_id)).size,
    sources: new Set(chunks.map((chunk) => `${chunk.investigation_id}/${chunk.file_name}`)).size,
  };
}
