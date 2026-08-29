// ─────────────────────────────────────────────────────────────────────────────
// Gate 9 — durable PostgreSQL storage for signed-artifact BYTES.
//
// A concrete DurableStorage that persists the raw signed PDF / audit certificate
// bytes into the `signed_artifact_blobs` table (falling back to the in-memory
// store in local dev / tests). The retention key produced by
// retainCompletedDocument — `agreements/<agreementId>/<esignRequestId>/<kind>.pdf`
// — is used verbatim as the row's `artifact_id`: stable, unique, and the natural
// idempotency boundary.
//
// `put` is idempotent (a key already present is not re-written) and atomic in the
// sense the retention orchestrator relies on: `exists` only reports true after the
// row is committed, so a document is never marked "retained" ahead of its bytes.
// ─────────────────────────────────────────────────────────────────────────────
import type { DurableStorage } from "./retention";
import { sha256 } from "./retention";
import { insertSignedArtifactBlob, signedArtifactBlobExists } from "../repo";

export class PostgresBlobStorage implements DurableStorage {
  async put(key: string, bytes: Uint8Array): Promise<{ ok: boolean; error?: string }> {
    try {
      // Idempotency: if the bytes for this key are already durably present, do not
      // rewrite them. The unique index on artifact_id also guards concurrent races.
      if (await signedArtifactBlobExists(key)) return { ok: true };
      await insertSignedArtifactBlob({
        artifactId: key,
        contentType: "application/pdf",
        byteSize: bytes.byteLength,
        sha256: sha256(bytes),
        data: bytes,
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  async exists(key: string): Promise<boolean> {
    return signedArtifactBlobExists(key);
  }
}
