// ===========================================================================
// SEGMENTER — background swap (cut the player out, composite over the realm).
// ---------------------------------------------------------------------------
// STUB. The full implementation would use MediaPipe ImageSegmenter
// (selfie/multiclass model) to produce a person mask, then composite the
// masked webcam frame over the Pixi background. Left as a clear interface so
// the render layer can adopt it without changes elsewhere.
//
// TODO: implement using @mediapipe/tasks-vision ImageSegmenter:
//   - load selfie_segmenter.tflite from the same CDN pattern
//   - segmentForVideo(video) -> category mask
//   - draw video to an offscreen canvas, multiply alpha by mask, return canvas
// ===========================================================================

export function createSegmenter() {
  return {
    /** Load the segmentation model. Returns false in this stub. */
    async init() {
      console.info('[segmenter] stub — background swap not yet implemented');
      return false;
    },
    /**
     * Produce a person-only canvas for compositing.
     * @returns {HTMLCanvasElement|null} null in the stub (renderer falls back
     *          to the static realm background).
     */
    segment(/* video */) {
      return null;
    },
    dispose() {},
  };
}
