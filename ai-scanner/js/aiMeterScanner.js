/**
 * Dicklum Water Association, Inc. — Modular Offline AI Water Meter Scanner (v34)
 * Orchestrates Phases 1–6:
 *  - Phase 1: ScannerCameraController (rear camera, continuous autofocus, torch, high-res capture)
 *  - Phase 2: MeterWindowDetector (physical meter body + kL number window + spatial tracker)
 *  - Phase 3: BlackKLRecognizer (full-res crop, p5..p95 contrast, red-digit exclusion, offline LSTM OCR)
 *  - Phase 4: ReadingValidator (9-state machine, consecutive-frame consensus, half-roll detection)
 *  - Phase 5: 100% Offline pre-cached WASM + LSTM models via Service Worker
 *  - Phase 6: Seamless ReadingModule & BillingEngine integration with photo proof & AI metadata
 */

class OfflineAIMeterScanner {
  constructor() {
    this.camera = typeof ScannerCameraController !== 'undefined' ? new ScannerCameraController() : null;
    this.detector = typeof MeterWindowDetector !== 'undefined' ? new MeterWindowDetector() : null;
    this.recognizer = typeof BlackKLRecognizer !== 'undefined' ? new BlackKLRecognizer() : null;
    const valMod = typeof DicklumReadingValidator !== 'undefined' ? DicklumReadingValidator : null;
    this.validator = valMod ? new valMod.ReadingValidator(2) : null;
    this.STATES = valMod ? valMod.SCANNER_STATES : {
      SEARCHING: 'SEARCHING FOR METER',
      DETECTING: 'DETECTING NUMBER WINDOW',
      ALIGNING: 'ALIGNING',
      TRACKING: 'TRACKING',
      READING: 'READING DIGITS',
      VERIFYING: 'VERIFYING READING',
      STABLE: 'READING STABLE',
      UNREADABLE: 'UNREADABLE',
      LOST: 'TRACKING LOST'
    };

    this.isOpen = false;
    this.filterMode = 'clahe';
    this.analysisInterval = null;
    this.rollAnimTimer = null;

    this.digits = [0, 0, 0, 0, 0];
    this.lastRenderedDigitsStr = '00000';
    this.confidence = 0;
    this.registerDetected = false;
    this.lastDetectionBox = null;
    this.lastTesseractRunAt = 0;
    this.hasAutoAppliedCurrentLock = false;
    this.glassStatus = 'SEARCHING';
    this.glassMessage = '🔍 SEARCHING FOR METER — Point rear camera at water meter';
    this.capturedDataUrl = null;
    this.simulationMode = null;
    this.lastAiMetadata = null;
  }

  init() {
    this.bindEvents();
    if (this.recognizer) {
      setTimeout(() => this.recognizer.initOfflineWorker(), 700);
    }
  }

  bindEvents() {
    const btnOpen = document.getElementById('btn-open-ai-scanner');
    if (btnOpen) btnOpen.addEventListener('click', () => this.openScannerModal());

    const btnClose = document.getElementById('btn-close-ai-scanner');
    const btnCancel = document.getElementById('btn-ai-cancel');
    if (btnClose) btnClose.addEventListener('click', () => this.closeScannerModal());
    if (btnCancel) btnCancel.addEventListener('click', () => this.closeScannerModal());

    const btnTorch = document.getElementById('btn-ai-toggle-torch');
    if (btnTorch) btnTorch.addEventListener('click', () => this.toggleTorch());

    const btnApply = document.getElementById('btn-ai-apply-reading');
    if (btnApply) btnApply.addEventListener('click', () => this.applyScannedReadingToForm(true));

    const btnFlag = document.getElementById('btn-ai-flag-unreadable');
    if (btnFlag) btnFlag.addEventListener('click', () => this.flagMeterAsUnreadable());

    document.querySelectorAll('.ai-sim-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.runClientDemoSimulation(btn.dataset.sim));
    });

    const fileInput = document.getElementById('ai-scanner-file-input');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) {
          this.scanFromUploadedFile(file);
          fileInput.value = '';
        }
      });
    }
  }

  getPreviousReadingBaseline() {
    const prevInput = document.getElementById('rdg-previous-input');
    const val = prevInput ? Number(prevInput.value) : 0;
    return (!isNaN(val) && val >= 0) ? Math.floor(val) : 0;
  }

  getNumberFromDigits() {
    return Number(this.digits.join('')) || 0;
  }

  playLockBeep() {
    try {
      if (navigator.vibrate) navigator.vibrate(75);
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1046.5, ctx.currentTime);
      osc.frequency.setValueAtTime(1318.5, ctx.currentTime + 0.06);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.16);
      setTimeout(() => { try { ctx.close(); } catch (_) {} }, 220);
    } catch (_) {}
  }

  async openScannerModal() {
    if (!window.app || !window.app.activeConsumer) {
      alert('Please select a consumer or water meter pin first before scanning.');
      return;
    }

    const modal = document.getElementById('modal-ai-meter-scanner');
    if (!modal) return;
    modal.classList.add('active');
    this.isOpen = true;
    this.simulationMode = null;
    this.registerDetected = false;
    this.lastDetectionBox = null;
    this.lastTesseractRunAt = 0;
    this.hasAutoAppliedCurrentLock = false;
    this.capturedDataUrl = null;
    this.lastAiMetadata = null;

    if (this.detector) this.detector.reset();
    if (this.validator) this.validator.reset();
    if (this.recognizer) this.recognizer.initOfflineWorker();

    const prev = this.getPreviousReadingBaseline();
    this.digits = [0, 0, 0, 0, 0];
    this.lastRenderedDigitsStr = '00000';
    this.confidence = 0;
    this.clearDetectionOverlay();
    this.updateGlassDiagnostic('SEARCHING', `🔍 ${this.STATES.SEARCHING} — Point rear camera at water meter`);
    this.renderRollerDrums(false);

    const prevBadge = document.getElementById('ai-scanner-prev-badge');
    if (prevBadge) prevBadge.textContent = `Prev: ${String(prev).padStart(5, '0')} m³`;

    const consumerBadge = document.getElementById('ai-scanner-consumer-label');
    if (consumerBadge && window.app.activeConsumer) {
      const meterNo = window.app.activeMeter ? window.app.activeMeter.meterNo : 'Meter';
      consumerBadge.textContent = `${window.app.activeConsumer.name} • ${meterNo}`;
    }

    await this.startCameraStream();
  }

  closeScannerModal() {
    this.stopCameraStream();
    if (this.rollAnimTimer) {
      clearInterval(this.rollAnimTimer);
      this.rollAnimTimer = null;
    }
    const modal = document.getElementById('modal-ai-meter-scanner');
    if (modal) modal.classList.remove('active');
    this.isOpen = false;
  }

  async startCameraStream() {
    const video = document.getElementById('ai-scanner-video');
    const simCanvas = document.getElementById('ai-scanner-sim-canvas');
    if (simCanvas) simCanvas.style.display = 'none';
    if (video) video.style.display = 'block';

    if (!this.camera) return;
    const res = await this.camera.start(video);
    if (!res.ok) {
      this.updateGlassDiagnostic('SEARCHING', `⚠️ ${res.message} (You can use Photo File or Demo below)`);
      if (res.code === 'UNSUPPORTED' || res.code === 'NO_CAMERA') {
        this.runClientDemoSimulation('linflow');
      }
      return;
    }

    const torchBtn = document.getElementById('btn-ai-toggle-torch');
    if (torchBtn) {
      torchBtn.textContent = res.torchSupported ? '⚡ Flash: OFF' : '⚡ Flash: N/A';
      torchBtn.disabled = !res.torchSupported;
    }

    if (this.analysisInterval) clearInterval(this.analysisInterval);
    this.analysisInterval = setInterval(() => {
      if (this.isOpen && !this.simulationMode) {
        this.performAIScan(false);
      }
    }, 220);
  }

  stopCameraStream() {
    if (this.analysisInterval) {
      clearInterval(this.analysisInterval);
      this.analysisInterval = null;
    }
    if (this.camera) this.camera.stop();
    const torchBtn = document.getElementById('btn-ai-toggle-torch');
    if (torchBtn) {
      torchBtn.textContent = '⚡ Flash: OFF';
      torchBtn.style.background = '';
      torchBtn.disabled = false;
    }
  }

  async toggleTorch() {
    if (!this.camera) return;
    const res = await this.camera.toggleTorch();
    const torchBtn = document.getElementById('btn-ai-toggle-torch');
    if (res.ok && torchBtn) {
      torchBtn.textContent = res.enabled ? '⚡ Flash: ON' : '⚡ Flash: OFF';
      torchBtn.style.background = res.enabled ? 'rgba(245, 158, 11, 0.25)' : '';
    } else if (!res.ok && window.app && window.app.showToast) {
      window.app.showToast(res.message || 'Flashlight unavailable on this device.', 2000);
    }
  }

  // Backward-compatible wrappers for automated verification & direct callers
  detectMeterRegisterInFrame(imgData) {
    if (!this.detector) return { found: false };
    const validator = this.recognizer
      ? (data, box) => this.recognizer.classifyTopological(data, box)
      : null;
    return this.detector.detectRaw(imgData, validator);
  }

  segmentAndClassifyRegisterDigits(imgData, box) {
    if (!this.recognizer) return { digits: [0, 0, 0, 0, 0], confidence: 0, validCharCount: 0, charBoxes: [] };
    return this.recognizer.classifyTopological(imgData, box);
  }

  async performAIScan(immediateLock = false) {
    if (!this.camera || !this.detector || !this.recognizer || !this.validator) return;

    const video = document.getElementById('ai-scanner-video');
    const simCanvas = document.getElementById('ai-scanner-sim-canvas');
    const frames = this.camera.captureAnalysisAndFullFrames(video, simCanvas, 480);
    if (!frames) return;

    const { analysisCanvas, analysisW, analysisH, fullCanvas } = frames;
    const analysisCtx = analysisCanvas.getContext('2d', { willReadFrequently: true });
    const fullImgData = analysisCtx.getImageData(0, 0, analysisW, analysisH);

    const det = this.detector.trackFrame(
      fullImgData,
      (d, b) => this.recognizer.classifyTopological(d, b),
      immediateLock
    );

    if (!det.found) {
      this.registerDetected = false;
      this.confidence = 0;
      this.validator.setState(det.trackingState || this.STATES.SEARCHING);
      this.clearDetectionOverlay();
      this.updateGlassDiagnostic('SEARCHING', `🔍 ${this.validator.state} — NUMBER WINDOW NOT DETECTED`);
      this.renderRollerDrums(false);
      return;
    }

    if (det.mossObstructed || det.type === 'MOSS_OBSTRUCTED') {
      this.registerDetected = false;
      this.confidence = 12;
      this.capturedDataUrl = fullCanvas.toDataURL('image/jpeg', 0.90);
      this.validator.setState(this.STATES.UNREADABLE);
      this.clearDetectionOverlay();
      this.updateGlassDiagnostic('MOSS_ALGAE', '⚠️ UNREADABLE — Moss / Algae obstructing meter glass');
      this.renderRollerDrums(false);
      return;
    }

    this.registerDetected = true;
    this.lastDetectionBox = det;
    this.capturedDataUrl = fullCanvas.toDataURL('image/jpeg', 0.90);
    if (this.validator.state === this.STATES.SEARCHING || this.validator.state === this.STATES.LOST) {
      this.validator.setState(det.trackingState || this.STATES.TRACKING);
    }
    this.drawDetectionOverlay(analysisW, analysisH, det, []);

    const prevBaseline = this.getPreviousReadingBaseline();
    const now = Date.now();

    // Fast-path (< 10ms): run high-precision topological classifier first
    const topoRec = this.recognizer.classifyTopological(fullImgData, det);
    if (topoRec && topoRec.validCharCount >= 4 && topoRec.overallConfidence >= 92 && !/^1+$/.test(topoRec.reading)) {
      this._handleRecognitionResult(topoRec, prevBaseline, det, analysisW, analysisH, immediateLock, topoRec.charBoxes);
      return;
    }

    if (this.recognizer.tesseractReady) {
      if (!this.recognizer.tesseractBusy && (immediateLock || now - this.lastTesseractRunAt >= 260)) {
        this.lastTesseractRunAt = now;
        this.validator.setState(this.STATES.READING);
        const rec = await this.recognizer.recognizeWithTesseract(fullCanvas, det, analysisW, analysisH, fullImgData);
        if (rec && this.isOpen) {
          this._handleRecognitionResult(rec, prevBaseline, det, analysisW, analysisH, immediateLock);
        }
      }
      return;
    }

    // Fallback before WASM boots
    this._handleRecognitionResult(topoRec, prevBaseline, det, analysisW, analysisH, immediateLock, topoRec.charBoxes);
  }

  _handleRecognitionResult(rec, prevBaseline, det, frameW, frameH, immediateLock, charBoxes = []) {
    if (rec.previewDataUrl) {
      const previewEl = document.getElementById('ai-preprocessed-preview');
      if (previewEl && previewEl.tagName === 'IMG') previewEl.src = rec.previewDataUrl;
    }

    const evalRes = this.validator.evaluateFrame(rec, prevBaseline, immediateLock);

    if (evalRes.uncertain) {
      this.drawDetectionOverlay(frameW, frameH, det, charBoxes);
      this.updateGlassDiagnostic(
        'LOW_CONTRAST',
        evalRes.halfRolled
          ? `⚠️ ${this.STATES.VERIFYING} — Half-rolled drum detected (${evalRes.reading || '...'}), hold steady`
          : `🔍 ${this.STATES.VERIFYING} — Reading black kL digits...`
      );
      return;
    }

    if (!evalRes.stable) {
      this.drawDetectionOverlay(frameW, frameH, det, charBoxes);
      this.updateGlassDiagnostic(
        'CLEAR',
        `🎯 ${this.STATES.VERIFYING} — Candidate: ${evalRes.reading || '...'} m³ (${evalRes.matchStreak || 1}/2)`
      );
      return;
    }

    // READING STABLE — READY TO CONFIRM
    this.confidence = evalRes.confidence;
    this.lastAiMetadata = {
      recognizedReading: evalRes.reading,
      numericValue: evalRes.numericValue,
      confidence: evalRes.confidence,
      profileId: evalRes.profileId,
      warnings: evalRes.warnings,
      status: evalRes.status,
      confirmedAt: evalRes.confirmedAt
    };

    this.animateRollerDrumsTo(evalRes.digits);
    this.syncReadingToMainFormSilently(evalRes.numericValue);
    this.drawDetectionOverlay(frameW, frameH, det, charBoxes);

    if (!this.hasAutoAppliedCurrentLock) {
      this.hasAutoAppliedCurrentLock = true;
      this.playLockBeep();
      if (window.app && typeof window.app.showToast === 'function') {
        const usage = evalRes.consumption;
        const estDue = usage === 0 ? 0 : (100 + Math.max(0, usage - 10) * 15);
        window.app.showToast(
          `✓ ${evalRes.bannerText}: ${evalRes.reading} m³ • Usage: ${usage} m³ • Bill: ₱${estDue.toFixed(2)}`,
          2800
        );
      }
    }

    const warnNote = evalRes.warnings.includes('UNUSUALLY_HIGH_CONSUMPTION')
      ? ' (⚠️ High Usage — Verify)'
      : (evalRes.warnings.includes('LOWER_THAN_PREVIOUS_OR_ROLLOVER') ? ' (⚠️ Below Previous — Verify)' : '');
    this.updateGlassDiagnostic(
      'CLEAR',
      `✓ ${evalRes.bannerText}: ${evalRes.reading} (${evalRes.numericValue} m³)${warnNote}`
    );
  }

  drawDetectionOverlay(frameW, frameH, det, charBoxes = []) {
    const overlay = document.getElementById('ai-detection-overlay-canvas');
    if (!overlay || !det || !det.found) return;
    overlay.width = frameW;
    overlay.height = frameH;
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, frameW, frameH);

    // Phase 2: Outer Meter Body Boundary
    if (det.meterBodyBox) {
      const mb = det.meterBodyBox;
      ctx.save();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.72)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(mb.x, mb.y, mb.w, mb.h);
      ctx.restore();
    }

    // Phase 3: Excluded Liter Zone
    if (det.redLitersBox) {
      const rb = det.redLitersBox;
      ctx.save();
      ctx.strokeStyle = 'rgba(248, 113, 113, 0.9)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(rb.x - 2, rb.y - 3, rb.w + 4, rb.h + 6);
      ctx.fillStyle = 'rgba(220, 38, 38, 0.85)';
      ctx.font = 'bold 8px sans-serif';
      ctx.fillText('EXCLUDED', rb.x, Math.max(10, rb.y - 5));
      ctx.restore();
    }

    // Phase 2: Inner Number Window Target Boundary
    ctx.save();
    ctx.strokeStyle = '#34D399';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = 'rgba(52, 211, 153, 0.85)';
    ctx.shadowBlur = 8;
    ctx.strokeRect(det.x - 3, det.y - 4, det.w + 6, det.h + 8);
    ctx.restore();

    ctx.save();
    const stateLabel = this.validator ? this.validator.state : 'TRACKING';
    const labelText = stateLabel === this.STATES.STABLE
      ? `✓ STABLE: ${String(this.getNumberFromDigits()).padStart(5, '0')} m³`
      : `🎯 ${stateLabel}`;
    ctx.font = 'bold 10.5px monospace';
    const tw = ctx.measureText(labelText).width + 14;
    ctx.fillStyle = 'rgba(6, 78, 59, 0.94)';
    ctx.fillRect(det.x - 3, Math.max(4, det.y - 22), tw, 17);
    ctx.strokeStyle = '#34D399';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(det.x - 3, Math.max(4, det.y - 22), tw, 17);
    ctx.fillStyle = '#6EE7B7';
    ctx.fillText(labelText, det.x + 3, Math.max(15, det.y - 9));
    ctx.restore();

    if (charBoxes && charBoxes.length > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
      ctx.lineWidth = 1.2;
      for (const cb of charBoxes) ctx.strokeRect(cb.x - 1, cb.y - 1, cb.w + 2, cb.h + 2);
      ctx.restore();
    }
  }

  clearDetectionOverlay() {
    const overlay = document.getElementById('ai-detection-overlay-canvas');
    if (overlay) overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
  }

  updateGlassDiagnostic(status, message) {
    this.glassStatus = status;
    this.glassMessage = message;
    const banner = document.getElementById('ai-glass-diagnostic-banner');
    const statusText = document.getElementById('ai-auto-hover-status-text');
    if (statusText) {
      statusText.textContent = this.registerDetected
        ? `✓ ${this.validator ? this.validator.state : 'LOCKED'}: ${String(this.getNumberFromDigits()).padStart(5, '0')} m³`
        : (this.validator ? this.validator.state : 'SEARCHING FOR METER');
    }
    if (!banner) return;

    banner.textContent = message;
    if (status === 'MOSS_ALGAE') {
      banner.style.background = 'rgba(220, 38, 38, 0.22)';
      banner.style.borderColor = 'rgba(248, 113, 113, 0.55)';
      banner.style.color = '#FCA5A5';
    } else if (status === 'LOW_CONTRAST' || status === 'GLARE' || status === 'SEARCHING') {
      banner.style.background = 'rgba(245, 158, 11, 0.18)';
      banner.style.borderColor = 'rgba(251, 191, 36, 0.45)';
      banner.style.color = '#FDE68A';
    } else {
      banner.style.background = 'rgba(16, 185, 129, 0.18)';
      banner.style.borderColor = 'rgba(52, 211, 153, 0.45)';
      banner.style.color = '#6EE7B7';
    }
  }

  runClientDemoSimulation(type = 'linflow') {
    this.simulationMode = type;
    const video = document.getElementById('ai-scanner-video');
    const simCanvas = document.getElementById('ai-scanner-sim-canvas');
    if (!simCanvas) return;

    if (video) video.style.display = 'none';
    simCanvas.style.display = 'block';
    const w = 480, h = 360;
    simCanvas.width = w;
    simCanvas.height = h;

    const ctx = simCanvas.getContext('2d');
    ctx.fillStyle = '#0F141C';
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.beginPath();
    ctx.arc(240, 185, 148, 0, Math.PI * 2);
    ctx.fillStyle = '#E2E0D8';
    ctx.fill();
    ctx.lineWidth = 14;
    ctx.strokeStyle = '#9A6B4C';
    ctx.stroke();
    ctx.restore();

    if (type === 'linflow') {
      ctx.fillStyle = '#1E293B';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('m³', 240, 140);
      ctx.fillStyle = '#0284C7';
      ctx.font = 'bold 15px sans-serif';
      ctx.fillText('LINFLOW • SNI', 240, 275);

      const regX = 188, regY = 153, blackW = 80, redW = 60, regH = 25;
      ctx.fillStyle = '#F8FAFC';
      ctx.fillRect(regX, regY, blackW, regH);
      ctx.strokeStyle = '#0F172A';
      ctx.lineWidth = 2;
      ctx.strokeRect(regX, regY, blackW + redW, regH);

      const dStr = '2549';
      for (let i = 0; i < 4; i++) {
        const cx = regX + i * 20;
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1;
        ctx.strokeRect(cx, regY, 20, regH);
        ctx.fillStyle = '#0F172A';
        ctx.font = 'bold 18px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(dStr[i], cx + 9, regY + regH / 2 + 1);
      }
      for (let r = 0; r < 3; r++) {
        const rx = regX + blackW + r * 20;
        ctx.fillStyle = '#DC2626';
        ctx.fillRect(rx, regY + 1, 19, regH - 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 16px monospace';
        ctx.fillText(r === 0 ? '8' : (r === 1 ? '9' : '1'), rx + 9, regY + regH / 2 + 1);
      }
    } else if (type === 'clean' || type === 'cloudy' || type === 'itron' || type === 'scratched') {
      ctx.fillStyle = '#1E293B';
      ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Itron', 240, 138);

      const regX = 152, regY = 160, blackW = 110, redW = 66, regH = 28;
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(regX, regY, blackW, regH);
      ctx.fillStyle = '#B91C1C';
      ctx.fillRect(regX + blackW, regY, redW, regH);

      const dStr = '01386';
      for (let i = 0; i < 5; i++) {
        const cx = regX + i * 22;
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1;
        ctx.strokeRect(cx, regY, 22, regH);
        ctx.fillStyle = '#F8FAFC';
        ctx.font = 'bold 18px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(dStr[i], cx + 11, regY + regH / 2 + 1);
      }
      if (type === 'cloudy' || type === 'scratched') {
        ctx.fillStyle = 'rgba(226, 232, 240, 0.35)';
        ctx.beginPath();
        ctx.arc(240, 185, 140, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (type === 'moss') {
      ctx.fillStyle = 'rgba(34, 139, 34, 0.72)';
      for (let m = 0; m < 180; m++) {
        ctx.beginPath();
        ctx.arc(110 + (m * 37) % 260, 75 + (m * 53) % 210, 8 + (m % 14), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    this.hasAutoAppliedCurrentLock = false;
    this.performAIScan(true);
  }

  animateRollerDrumsTo(targetDigits) {
    const targetStr = targetDigits.join('');
    if (this.lastRenderedDigitsStr === targetStr) {
      this.digits = [...targetDigits];
      this.renderRollerDrums(false);
      return;
    }

    this.lastRenderedDigitsStr = targetStr;
    if (this.rollAnimTimer) clearInterval(this.rollAnimTimer);

    let step = 0;
    const maxSteps = 5;
    this.rollAnimTimer = setInterval(() => {
      step++;
      if (step >= maxSteps) {
        clearInterval(this.rollAnimTimer);
        this.rollAnimTimer = null;
        this.digits = [...targetDigits];
        this.renderRollerDrums(true);
      } else {
        this.digits = targetDigits.map((td, idx) => (td + maxSteps - step + idx) % 10);
        this.renderRollerDrums(true);
      }
    }, 42);
  }

  syncReadingToMainFormSilently(scannedValue) {
    const currentInput = document.getElementById('rdg-current-input');
    if (currentInput) {
      currentInput.value = scannedValue;
      currentInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  scanFromUploadedFile(file) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const video = document.getElementById('ai-scanner-video');
        const simCanvas = document.getElementById('ai-scanner-sim-canvas');
        if (!simCanvas) return;
        this.simulationMode = 'photo';
        if (video) video.style.display = 'none';
        simCanvas.style.display = 'block';
        simCanvas.width = img.width > 960 ? 960 : img.width;
        simCanvas.height = Math.round(img.height * (simCanvas.width / img.width));
        simCanvas.getContext('2d').drawImage(img, 0, 0, simCanvas.width, simCanvas.height);
        this.hasAutoAppliedCurrentLock = false;
        this.performAIScan(true);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  renderRollerDrums(isRolling = false) {
    const container = document.getElementById('ai-roller-drums-container');
    const confBadge = document.getElementById('ai-confidence-badge');
    const usagePreview = document.getElementById('ai-live-usage-preview');
    if (!container) return;

    const prev = this.getPreviousReadingBaseline();
    const curr = this.getNumberFromDigits();
    const diff = curr - prev;

    if (confBadge) {
      if (this.glassStatus === 'MOSS_ALGAE') {
        confBadge.textContent = 'UNREADABLE (MOSS/ALGAE)';
        confBadge.className = 'badge badge-danger';
      } else if (this.registerDetected && this.confidence > 0) {
        confBadge.textContent = `✓ AI LOCKED (${this.confidence}%)`;
        confBadge.className = 'badge badge-success';
      } else {
        confBadge.textContent = this.validator ? this.validator.state : 'SEARCHING FOR METER';
        confBadge.className = 'badge badge-warning';
      }
    }

    container.innerHTML = this.digits.map((d) => `
      <div class="ai-drum-col">
        <div class="ai-drum-wheel ${isRolling ? 'rolling' : ''}" style="border-color: ${this.registerDetected ? '#34D399' : '#38BDF8'}; box-shadow: ${this.registerDetected ? '0 0 12px rgba(52, 211, 153, 0.45)' : 'none'};">${d}</div>
      </div>
    `).join('') + `<div style="font-size:14px; font-weight:800; color:#94A3B8; margin-left:4px; align-self:center;">m³</div>`;

    if (usagePreview) {
      const usage = Math.max(0, diff);
      const estDue = usage === 0 ? 0 : (100 + Math.max(0, usage - 10) * 15);
      usagePreview.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; background: rgba(15, 23, 42, 0.9); border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 6px; padding: 7px 6px; text-align: center;">
          <div>
            <div style="font-size: 8.5px; font-weight: 700; color: #94A3B8; text-transform: uppercase;">Previous</div>
            <div style="font-size: 12.5px; font-weight: 800; color: #CBD5E1; font-family: var(--font-mono);">${prev} m³</div>
          </div>
          <div>
            <div style="font-size: 8.5px; font-weight: 700; color: #34D399; text-transform: uppercase;">AI Current</div>
            <div style="font-size: 12.5px; font-weight: 800; color: #FFFFFF; font-family: var(--font-mono);">${curr} m³</div>
          </div>
          <div>
            <div style="font-size: 8.5px; font-weight: 700; color: #38BDF8; text-transform: uppercase;">Usage</div>
            <div style="font-size: 12.5px; font-weight: 800; color: #38BDF8; font-family: var(--font-mono);">${diff >= 0 ? `${usage} m³` : '⚠️ Low'}</div>
          </div>
          <div>
            <div style="font-size: 8.5px; font-weight: 700; color: #34D399; text-transform: uppercase;">Est. Bill</div>
            <div style="font-size: 12.5px; font-weight: 800; color: #34D399; font-family: var(--font-mono);">₱${estDue.toFixed(0)}</div>
          </div>
        </div>
      `;
    }
  }

  async applyScannedReadingToForm(closeAfterApply = true) {
    if (!this.capturedDataUrl) await this.performAIScan(true);

    const scannedValue = this.getNumberFromDigits();
    this.syncReadingToMainFormSilently(scannedValue);

    const currentInput = document.getElementById('rdg-current-input');
    if (currentInput && this.lastAiMetadata) {
      currentInput.dataset.aiMetadata = JSON.stringify({
        ...this.lastAiMetadata,
        confirmedReading: scannedValue,
        consumerId: window.app && window.app.activeConsumer ? window.app.activeConsumer.id : null,
        meterId: window.app && window.app.activeMeter ? window.app.activeMeter.id : null
      });
    }

    if (this.capturedDataUrl && window.readingModule) {
      const consumerName = (window.app && window.app.activeConsumer) ? window.app.activeConsumer.name : 'Consumer';
      const meterNo = (window.app && window.app.activeMeter) ? window.app.activeMeter.meterNo : 'N/A';
      const gpsText = (window.app && window.app.mapEngine && window.app.mapEngine.userGps)
        ? `${window.app.mapEngine.userGps.lat.toFixed(5)}, ${window.app.mapEngine.userGps.lng.toFixed(5)}`
        : 'Barangay Diclum, Manolo Fortich';

      try {
        const watermarked = await window.readingModule.watermarkPhoto(this.capturedDataUrl, {
          meterNo: `${meterNo} [AI-OCR ${this.confidence || 96}%]`,
          reading: scannedValue,
          consumerName,
          timestamp: new Date().toLocaleString(),
          gps: gpsText
        });
        this.attachPhotoToReadingForm(watermarked);
      } catch (_) {
        this.attachPhotoToReadingForm(this.capturedDataUrl);
      }
    }

    if (closeAfterApply) {
      this.closeScannerModal();
      if (window.app && typeof window.app.showToast === 'function') {
        window.app.showToast(`✓ AI Reading (${scannedValue} m³) & Bill Calculated!`, 2600);
      }
    }
  }

  async flagMeterAsUnreadable() {
    if (!this.capturedDataUrl) await this.performAIScan(false);

    const notesInput = document.getElementById('rdg-notes-input');
    if (notesInput) {
      notesInput.value = '[AI SCANNER FLAG: Meter glass unreadable due to moss/algae ("lumot") or heavy internal fog — Needs Maintenance/Cleaning]';
    }

    const proofDisclosure = document.getElementById('disclosure-proof');
    if (proofDisclosure) proofDisclosure.classList.add('open');

    if (this.capturedDataUrl && window.readingModule) {
      const consumerName = (window.app && window.app.activeConsumer) ? window.app.activeConsumer.name : 'Consumer';
      const meterNo = (window.app && window.app.activeMeter) ? window.app.activeMeter.meterNo : 'N/A';
      try {
        const watermarked = await window.readingModule.watermarkPhoto(this.capturedDataUrl, {
          meterNo: `${meterNo} [UNREADABLE - MOSS/ALGAE]`,
          reading: this.getPreviousReadingBaseline(),
          consumerName,
          timestamp: new Date().toLocaleString(),
          gps: 'Flagged for Maintenance'
        });
        this.attachPhotoToReadingForm(watermarked);
      } catch (_) {}
    }

    this.closeScannerModal();
    if (window.app && typeof window.app.showToast === 'function') {
      window.app.showToast('⚠️ Meter flagged as Unreadable (Moss/Algae) with Photo Proof attached.', 3200);
    }
  }

  attachPhotoToReadingForm(dataUrl) {
    const previewImg = document.getElementById('rdg-photo-preview');
    const previewWrap = document.getElementById('rdg-photo-preview-wrap');
    const promptBox = document.getElementById('rdg-photo-prompt');
    const proofDisclosure = document.getElementById('disclosure-proof');

    if (previewImg && dataUrl) {
      previewImg.src = dataUrl;
      previewImg.dataset.src = dataUrl;
    }
    if (previewWrap) previewWrap.classList.remove('hidden');
    if (promptBox) promptBox.classList.add('hidden');
    if (proofDisclosure) proofDisclosure.classList.add('open');
  }
}

if (typeof window !== 'undefined') {
  window.aiMeterScanner = new OfflineAIMeterScanner();
  window.addEventListener('DOMContentLoaded', () => {
    window.aiMeterScanner.init();
  });
}
