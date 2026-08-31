// Content Studio — the ONE canonical object-key builder. Every artifact key is built here so keys are
// collision-safe, traversal-safe, and version-bound. A raw user filename is NEVER used as a path; keys
// bind environment + class + owning job/operator + an immutable version identity + a safe extension.
// Approved outputs are immutable (their version is in the key); regenerating produces a NEW key.

export type ArtifactClass = "upload" | "render-input" | "render-output" | "poster" | "share-media";

const SAFE_SEG = /^[a-z0-9][a-z0-9_-]{0,63}$/i; // one path segment: alnum + _- , bounded, no dots/slashes
const SAFE_EXT = /^[a-z0-9]{1,8}$/i;
const ENVS = new Set(["development", "test", "staging", "production"]);

function seg(name: string, value: string): string {
  if (!value || !SAFE_SEG.test(value)) throw new Error(`cs-object-key: unsafe ${name} segment: ${JSON.stringify(value)}`);
  return value;
}

export interface KeyParts {
  artifactClass: ArtifactClass;
  env: string; // development | test | staging | production
  version: string; // immutable identity (inputVersion / share token / upload id) — makes the key unique+stable
  ext: string; // mp4 | mp3 | jpg | png ...
  operatorId?: string | null; // for uploads (tenant scoping)
  jobId?: string | null; // for render-input/output/poster
  shareToken?: string | null; // for share-media
}

// Build a canonical, safe object key. Throws on any unsafe/missing required component (fail closed).
export function buildObjectKey(p: KeyParts): string {
  const env = (p.env || "").toLowerCase();
  if (!ENVS.has(env)) throw new Error(`cs-object-key: unknown env ${JSON.stringify(p.env)}`);
  if (!SAFE_EXT.test(p.ext.replace(/^\./, ""))) throw new Error(`cs-object-key: unsafe ext ${JSON.stringify(p.ext)}`);
  const ext = p.ext.replace(/^\./, "").toLowerCase();
  const version = seg("version", p.version);

  let owner: string;
  switch (p.artifactClass) {
    case "upload":
      owner = seg("operatorId", p.operatorId || "op");
      return `content-studio/${env}/upload/${owner}/${version}.${ext}`;
    case "render-input":
    case "render-output":
    case "poster":
      owner = seg("jobId", p.jobId || "");
      return `content-studio/${env}/${p.artifactClass}/${owner}/${version}.${ext}`;
    case "share-media":
      owner = seg("shareToken", p.shareToken || "");
      return `content-studio/${env}/share-media/${owner}/${version}.${ext}`;
    default:
      throw new Error(`cs-object-key: unknown artifact class`);
  }
}

// Validate an already-built key is well-formed (used at route boundaries to reject arbitrary/hostile keys).
export function isValidObjectKey(key: string): boolean {
  if (typeof key !== "string" || key.length === 0 || key.length > 512) return false;
  if (key.includes("..") || key.startsWith("/") || key.includes("\\") || key.includes("\0")) return false;
  const parts = key.split("/");
  if (parts[0] !== "content-studio") return false;
  if (!ENVS.has(parts[1])) return false;
  if (!parts[2] || !["upload", "render-input", "render-output", "poster", "share-media"].includes(parts[2])) return false;
  // every remaining segment (except the final name.ext) must be a safe segment
  const last = parts[parts.length - 1];
  const m = /^([a-z0-9][a-z0-9_-]{0,63})\.([a-z0-9]{1,8})$/i.exec(last);
  if (!m) return false;
  for (const s of parts.slice(3, -1)) if (!SAFE_SEG.test(s)) return false;
  return true;
}
