// ─────────────────────────────────────────────────────────────────────────────
// Targeted, spec-correct polyfill for a real Node 23.4.0 defect: TextDecoder for
// SINGLE-BYTE encodings (ascii / latin1 / windows-1252 / iso-8859-1) returns a
// Buffer instead of a string. fontkit (used by @react-pdf) decodes font-name tables
// with these decoders, so on that build every embedded font fails to parse
// ("Unknown font format") and the PDF silently falls back to UNEMBEDDED standard-14
// fonts — which then render with viewer-dependent letter spacing (Poppler distorts,
// MuPDF/Preview are clean). Embedding the project fonts makes rendering identical
// across all viewers; this shim restores the correct single-byte decode so embedding
// works on the broken build.
//
// It is a NO-OP on healthy runtimes (single-byte already returns a string). It only
// corrects the buggy path — nothing correct ever relies on a Buffer here — and leaves
// utf-8 (and every multibyte decode) delegated to the native decoder untouched.
// ─────────────────────────────────────────────────────────────────────────────

const SINGLE_BYTE = /^(ascii|us-ascii|latin1|latin-1|iso-8859-1|iso8859-1|windows-1252|cp1252|x-user-defined)$/i;

function singleByteIsBroken(): boolean {
  try {
    return new TextDecoder("latin1").decode(new Uint8Array([65, 66])) !== "AB";
  } catch {
    return true;
  }
}

export function installTextDecoderFix(): void {
  const g = globalThis as unknown as { TextDecoder: typeof TextDecoder; __artifexTdFixed?: boolean };
  if (g.__artifexTdFixed) return;
  if (!singleByteIsBroken()) { g.__artifexTdFixed = true; return; } // healthy runtime — nothing to do

  const Native = g.TextDecoder;
  class FixedTextDecoder {
    private native: TextDecoder;
    private single: boolean;
    readonly encoding: string;
    readonly fatal: boolean;
    readonly ignoreBOM: boolean;
    constructor(label?: string, options?: TextDecoderOptions) {
      const enc = (label ?? "utf-8").toString();
      this.single = SINGLE_BYTE.test(enc);
      this.encoding = enc.toLowerCase();
      this.fatal = Boolean(options?.fatal);
      this.ignoreBOM = Boolean(options?.ignoreBOM);
      // utf-8 works natively on the broken build; use it for the delegated path.
      this.native = new Native(this.single ? "utf-8" : (label as string), options);
    }
    decode(input?: BufferSource, options?: { stream?: boolean }): string {
      if (!this.single) return this.native.decode(input, options);
      if (input == null) return "";
      const bytes = input instanceof Uint8Array ? input : new Uint8Array((input as ArrayBufferView).buffer ?? (input as ArrayBuffer));
      // latin1 / windows-1252 map byte → codepoint directly; ascii is a subset.
      let out = "";
      for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
      return out;
    }
  }
  g.TextDecoder = FixedTextDecoder as unknown as typeof TextDecoder;
  g.__artifexTdFixed = true;
}

// Install on import so a bare `import "./textdecoder-fix"` — placed BEFORE any
// @react-pdf/fontkit import — patches the global before fontkit captures a
// TextDecoder('ascii') instance at its own module load (fontkit line ~5386).
installTextDecoderFix();
