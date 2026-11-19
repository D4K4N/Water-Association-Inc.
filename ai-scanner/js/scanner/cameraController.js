/**
 * Phase 1: Smartphone Camera Foundation Controller
 * Handles rear camera stream, continuous autofocus, torch/flashlight, permissions,
 * full-resolution frame capture, and clean hardware shutdown.
 */
(function (global) {
  'use strict';

  class ScannerCameraController {
    constructor() {
      this.stream = null;
      this.videoTrack = null;
      this.torchEnabled = false;
      this.torchSupported = false;
      this.autofocusSupported = false;
      // Reusable in-memory offscreen canvases (zero permanent photo storage)
      this._fullCanvas = null;
      this._analysisCanvas = null;
    }

    isSupported() {
      return !!(
        typeof navigator !== 'undefined' &&
        navigator.mediaDevices &&
        typeof navigator.mediaDevices.getUserMedia === 'function'
      );
    }

    async start(videoEl) {
      this.stop();
      if (!this.isSupported()) {
        return {
          ok: false,
          code: 'UNSUPPORTED',
          message: 'Camera API is unavailable on this browser or insecure origin (HTTPS/localhost required).'
        };
      }

      const constraintsList = [
        {
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          },
          audio: false
        },
        {
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 960 }
          },
          audio: false
        },
        { video: { facingMode: 'environment' }, audio: false },
        { video: true, audio: false }
      ];

      let lastErr = null;
      for (const constraints of constraintsList) {
        try {
          this.stream = await navigator.mediaDevices.getUserMedia(constraints);
          break;
        } catch (err) {
          lastErr = err;
          if (err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
            break;
          }
        }
      }

      if (!this.stream) {
        const name = lastErr && lastErr.name ? lastErr.name : 'Error';
        const denied = name === 'NotAllowedError' || name === 'PermissionDeniedError';
        const missing = name === 'NotFoundError' || name === 'DevicesNotFoundError';
        return {
          ok: false,
          code: denied ? 'PERMISSION_DENIED' : (missing ? 'NO_CAMERA' : 'CAMERA_ERROR'),
          message: denied
            ? 'Camera permission denied. Please allow camera access in browser settings and retry.'
            : (missing
              ? 'No rear camera detected on this device.'
              : `Unable to start camera (${name}).`)
        };
      }

      if (videoEl) {
        videoEl.srcObject = this.stream;
        await videoEl.play().catch(() => {});
      }

      const tracks = this.stream.getVideoTracks();
      this.videoTrack = tracks && tracks.length > 0 ? tracks[0] : null;
      this.torchEnabled = false;
      this.torchSupported = false;
      this.autofocusSupported = false;

      if (this.videoTrack && typeof this.videoTrack.getCapabilities === 'function') {
        try {
          const caps = this.videoTrack.getCapabilities() || {};
          this.torchSupported = !!caps.torch;
          if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
            this.autofocusSupported = true;
            await this.videoTrack.applyConstraints({
              advanced: [{ focusMode: 'continuous' }]
            }).catch(() => {});
          }
        } catch (_) {}
      }

      return {
        ok: true,
        torchSupported: this.torchSupported,
        autofocusSupported: this.autofocusSupported
      };
    }

    async toggleTorch() {
      if (!this.videoTrack || !this.torchSupported) {
        return { ok: false, enabled: false, message: 'Flashlight/torch is not supported on this camera.' };
      }
      const next = !this.torchEnabled;
      try {
        await this.videoTrack.applyConstraints({ advanced: [{ torch: next }] });
        this.torchEnabled = next;
        return { ok: true, enabled: this.torchEnabled };
      } catch (err) {
        return { ok: false, enabled: this.torchEnabled, message: 'Could not toggle LED flashlight.' };
      }
    }

    captureAnalysisAndFullFrames(videoEl, simCanvas, analysisWidth = 480) {
      if (simCanvas && simCanvas.style.display !== 'none' && simCanvas.width > 0) {
        const w = simCanvas.width;
        const h = simCanvas.height;
        if (!this._fullCanvas) this._fullCanvas = document.createElement('canvas');
        if (this._fullCanvas.width !== w || this._fullCanvas.height !== h) {
          this._fullCanvas.width = w;
          this._fullCanvas.height = h;
        }
        this._fullCanvas.getContext('2d', { willReadFrequently: true }).drawImage(simCanvas, 0, 0, w, h);
        return {
          analysisCanvas: this._fullCanvas,
          analysisW: w,
          analysisH: h,
          fullCanvas: this._fullCanvas,
          fullW: w,
          fullH: h
        };
      }

      if (!videoEl || videoEl.readyState < 2 || !videoEl.videoWidth) {
        return null;
      }

      const fullW = videoEl.videoWidth;
      const fullH = videoEl.videoHeight;
      if (!this._fullCanvas) this._fullCanvas = document.createElement('canvas');
      if (this._fullCanvas.width !== fullW || this._fullCanvas.height !== fullH) {
        this._fullCanvas.width = fullW;
        this._fullCanvas.height = fullH;
      }
      this._fullCanvas.getContext('2d', { willReadFrequently: true }).drawImage(videoEl, 0, 0, fullW, fullH);

      const analysisW = analysisWidth;
      const analysisH = Math.max(1, Math.round(fullH * (analysisWidth / fullW)));
      if (!this._analysisCanvas) this._analysisCanvas = document.createElement('canvas');
      if (this._analysisCanvas.width !== analysisW || this._analysisCanvas.height !== analysisH) {
        this._analysisCanvas.width = analysisW;
        this._analysisCanvas.height = analysisH;
      }
      this._analysisCanvas.getContext('2d', { willReadFrequently: true }).drawImage(this._fullCanvas, 0, 0, analysisW, analysisH);

      return {
        analysisCanvas: this._analysisCanvas,
        analysisW,
        analysisH,
        fullCanvas: this._fullCanvas,
        fullW,
        fullH
      };
    }

    stop() {
      if (this.videoTrack && this.torchEnabled) {
        try {
          this.videoTrack.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {});
        } catch (_) {}
      }
      if (this.stream) {
        this.stream.getTracks().forEach((t) => {
          try { t.stop(); } catch (_) {}
        });
      }
      this.stream = null;
      this.videoTrack = null;
      this.torchEnabled = false;
    }
  }

  if (typeof window !== 'undefined') window.ScannerCameraController = ScannerCameraController;
  if (typeof module !== 'undefined' && module.exports) module.exports = ScannerCameraController;
})(typeof window !== 'undefined' ? window : globalThis);
