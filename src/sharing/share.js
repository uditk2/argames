// ===========================================================================
// SHARE — Web Share API wrapper with a download fallback.
// ---------------------------------------------------------------------------
// Tries navigator.canShare({ files }) + navigator.share (the file-sharing path
// available on most mobile browsers / Safari). If that's unavailable or the
// user cancels in a way that isn't an abort, we fall back to triggering a
// download of the file so desktop users still get something usable.
//
// Returns { method: 'share' | 'download' | 'unsupported' }.
// ===========================================================================

/** Can this browser share these specific files via the Web Share API? */
export function canShareFiles(files) {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files })
  );
}

/** Force-download a Blob with the given filename. */
export function downloadBlob(blob, filename) {
  if (typeof document === 'undefined') return false;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke a tick later so the download has a chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}

/**
 * Share a single file (clip or image), falling back to download.
 * @param {Object} args
 * @param {Blob}   args.blob
 * @param {string} args.filename
 * @param {string} [args.title]
 * @param {string} [args.text]
 * @returns {Promise<{ method: 'share'|'download'|'unsupported' }>}
 */
export async function shareFile({ blob, filename, title, text }) {
  if (!blob) return { method: 'unsupported' };

  // File constructor is needed for the Web Share files path.
  let file = null;
  if (typeof File !== 'undefined') {
    try {
      file = new File([blob], filename, { type: blob.type });
    } catch {
      file = null;
    }
  }

  if (file && canShareFiles([file])) {
    try {
      await navigator.share({ files: [file], title, text });
      return { method: 'share' };
    } catch (e) {
      // AbortError = user dismissed the sheet on purpose; respect that and don't
      // silently download behind their back.
      if (e && e.name === 'AbortError') return { method: 'share' };
      // Any other failure (e.g. NotAllowedError, share unsupported for type):
      // fall through to download.
      console.warn('[share] navigator.share failed, falling back to download:', e);
    }
  }

  if (downloadBlob(blob, filename)) return { method: 'download' };
  return { method: 'unsupported' };
}
