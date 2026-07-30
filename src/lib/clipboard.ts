// Copy text to the clipboard, reliably, with no new dependency. Prefers the async
// Clipboard API (works on modern iOS/Chrome/Safari over HTTPS); falls back to a
// hidden, off-screen textarea + execCommand for older/denied environments. The
// fallback never scrolls the page, never leaves a selection behind, and always
// cleans up the temporary element. Returns whether the copy actually succeeded —
// callers must never claim success on a false return.
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path (permission denied, insecure context, etc.) */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.setAttribute("aria-hidden", "true");
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.left = "-9999px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
