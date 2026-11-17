/**
 * Phase 3: Black kL Digit-Only Recognition Engine
 * - Crops the detected kL number window at full native camera resolution.
 * - Strictly excludes red/black liter drums.
 * - Normalizes polarity & contrast (p5..p95) before adding quiet border.
 * - Detects partially rotated / half-rolled drum digits.
 * - Runs 100% offline Tesseract LSTM WASM OCR with topological fallback.
 */
(function (global) {
  'use strict';

  class BlackKLRecognizer {
    constructor() {
      this.tesseractWorker = null;
      this.tesseractReady = false;
      this.tesseractBusy = false;
      this.digitTemplates = this._buildMechanicalDigitTemplates();
    }

    _buildMechanicalDigitTemplates() {
      const raw = {
        0: ['01110', '11011', '10001', '10001', '10001', '11011', '01110'],
        1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
        2: ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
        3: ['01110', '10001', '00001', '00110', '00001', '10001', '01110'],
        4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
        5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
        6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
        7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
        8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
        9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100']
      };
      const out = {};
      for (let d = 0; d <= 9; d++) {
        out[d] = raw[d].map(row => row.split('').map(ch => Number(ch)));
      }
      return out;
    }

    async initOfflineWorker() {
      if (this.tesseractWorker || typeof window === 'undefined' || typeof window.Tesseract === 'undefined') {
        return false;
      }
      try {
        const worker = await window.Tesseract.createWorker('eng', 1, {
          workerPath: './vendor/tesseract/worker.min.js',
          corePath: './vendor/tesseract/tesseract-core-lstm.wasm.js',
          langPath: './vendor/tesseract',
          workerBlobURL: false,
          cacheMethod: 'none'
        });
        await worker.setParameters({
          tessedit_char_whitelist: '0123456789',
          tessedit_pageseg_mode: '7'
        });
        this.tesseractWorker = worker;
        this.tesseractReady = true;
        return true;
      } catch (err) {
        console.warn('Offline LSTM worker fallback to topological classifier:', err);
        return false;
      }
    }

    /**
     * Checks whether any drum cell has split top/bottom ink indicating a half-rolled mechanical drum.
     */
    detectHalfRolledDrums(normImgData, expectedDigits = 5) {
      const { width: w, height: h, data } = normImgData;
      const cellW = w / Math.max(1, expectedDigits);
      const halfRolledFlags = [];
      for (let k = 0; k < expectedDigits; k++) {
        const x1 = Math.floor(k * cellW + cellW * 0.2);
        const x2 = Math.ceil((k + 1) * cellW - cellW * 0.2);
        let topInk = 0, midInk = 0, botInk = 0;
        let topCnt = 0, midCnt = 0, botCnt = 0;
        const yTopEnd = Math.floor(h * 0.25);
        const yMidStart = Math.floor(h * 0.40);
        const yMidEnd = Math.floor(h * 0.60);
        const yBotStart = Math.floor(h * 0.75);

        for (let y = 0; y < h; y++) {
          for (let x = x1; x < x2; x++) {
            const isInk = data[(y * w + x) * 4] < 110;
            if (y < yTopEnd) { topCnt++; if (isInk) topInk++; }
            else if (y >= yMidStart && y <= yMidEnd) { midCnt++; if (isInk) midInk++; }
            else if (y >= yBotStart) { botCnt++; if (isInk) botInk++; }
          }
        }
        const topRatio = topCnt > 0 ? topInk / topCnt : 0;
        const midRatio = midCnt > 0 ? midInk / midCnt : 0;
        const botRatio = botCnt > 0 ? botInk / botCnt : 0;
        // Classic half-rolled drum: ink at both top and bottom edges with a blank gap across the center
        const isHalf = topRatio > 0.22 && botRatio > 0.22 && midRatio < 0.05;
        halfRolledFlags.push(isHalf);
      }
      return halfRolledFlags;
    }

    /**
     * Normalizes a cropped kL register canvas (p5..p95 contrast stretch + polarity inversion).
     * Does NOT include white padding so contrast statistics are never skewed.
     */
    prepareNormalizedCrop(fullCanvas, det, analysisW, analysisH) {
      const scaleX = fullCanvas.width / Math.max(1, analysisW);
      const scaleY = fullCanvas.height / Math.max(1, analysisH);

      const srcX = Math.max(0, Math.round(det.x * scaleX));
      const rawSrcY = Math.round(det.y * scaleY);
      const rawSrcH = Math.round(det.h * scaleY);
      const srcY = Math.max(0, rawSrcY + Math.round(rawSrcH * 0.08));
      const srcW = Math.max(12, Math.min(fullCanvas.width - srcX, Math.round(det.w * scaleX)));
      const srcH = Math.max(8, Math.min(fullCanvas.height - srcY, Math.round(rawSrcH * 0.86)));

      const targetH = Math.max(40, Math.min(64, srcH * 2));
      const targetW = Math.max(88, Math.round(srcW * (targetH / Math.max(1, srcH))));

      const rawCanvas = document.createElement('canvas');
      rawCanvas.width = targetW;
      rawCanvas.height = targetH;
      const rawCtx = rawCanvas.getContext('2d');
      rawCtx.imageSmoothingEnabled = true;
      rawCtx.drawImage(fullCanvas, srcX, srcY, srcW, srcH, 0, 0, targetW, targetH);

      const imgData = rawCtx.getImageData(0, 0, targetW, targetH);
      const d = imgData.data;
      const hist = new Int32Array(256);
      const totalPx = targetW * targetH;
      for (let i = 0; i < d.length; i += 4) {
        const l = Math.max(0, Math.min(255, Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])));
        hist[l]++;
      }
      let p5 = 0, p95 = 255, acc = 0;
      for (let v = 0; v < 256; v++) {
        acc += hist[v];
        if (acc <= totalPx * 0.05) p5 = v;
        if (acc <= totalPx * 0.95) p95 = v;
      }
      const span = Math.max(28, p95 - p5);
      for (let i = 0; i < d.length; i += 4) {
        const rawL = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
        let norm = Math.max(0, Math.min(255, Math.round(((rawL - p5) / span) * 255)));
        if (det.polarity === 'WHITE_ON_BLACK') norm = 255 - norm;
        const val = norm > 142 ? 255 : (norm < 92 ? 0 : norm);
        d[i] = val; d[i + 1] = val; d[i + 2] = val;
      }

      // Remove full-height thin vertical drum-divider seams (prevents Tesseract reading "|" as "1")
      for (let x = 0; x < targetW; x++) {
        let darkRows = 0;
        for (let y = 0; y < targetH; y++) {
          if (d[(y * targetW + x) * 4] < 110) darkRows++;
        }
        if (darkRows >= Math.floor(targetH * 0.88)) {
          for (let y = 0; y < targetH; y++) {
            const idx = (y * targetW + x) * 4;
            d[idx] = 255; d[idx + 1] = 255; d[idx + 2] = 255;
          }
        }
      }
      rawCtx.putImageData(imgData, 0, 0);

      // Step 2B: Dynamically segment individual digit columns (4, 5, or 6 digits — never hardcoded!)
      const colInk = new Int16Array(targetW);
      const yTop = Math.floor(targetH * 0.12);
      const yBot = Math.ceil(targetH * 0.88);
      for (let x = 0; x < targetW; x++) {
        let cnt = 0;
        for (let y = yTop; y < yBot; y++) {
          if (d[(y * targetW + x) * 4] < 110) cnt++;
        }
        colInk[x] = cnt;
      }

      const segs = [];
      let inSeg = false, segStart = 0;
      for (let x = 1; x < targetW - 1; x++) {
        if (colInk[x] >= 2) {
          if (!inSeg) { inSeg = true; segStart = x; }
        } else if (inSeg) {
          if (x - segStart >= 3) segs.push({ x1: segStart, x2: x - 1 });
          inSeg = false;
        }
      }
      if (inSeg && targetW - 1 - segStart >= 3) segs.push({ x1: segStart, x2: targetW - 2 });

      // Filter out tiny noise specks and split merged double-wide blobs if needed
      const cleanSegs = [];
      const maxDigitW = Math.max(12, Math.floor(targetW * 0.24));
      for (const s of segs) {
        const sw = s.x2 - s.x1 + 1;
        if (sw > maxDigitW && sw < targetW * 0.65) {
          const parts = Math.max(2, Math.round(sw / Math.max(10, targetW / 5)));
          const pw = sw / parts;
          for (let k = 0; k < parts; k++) {
            cleanSegs.push({ x1: Math.round(s.x1 + k * pw), x2: Math.round(s.x1 + (k + 1) * pw - 1) });
          }
        } else if (sw >= 3 && sw <= targetW * 0.45) {
          cleanSegs.push(s);
        }
      }

      const pad = 22;
      const digitGap = 18;
      let prepCanvas;
      if (cleanSegs.length >= 4 && cleanSegs.length <= 6) {
        // Assemble clean spaced digits with wide white gaps (zero drum dividers!)
        const totalSegW = cleanSegs.reduce((acc, s) => acc + (s.x2 - s.x1 + 1), 0);
        prepCanvas = document.createElement('canvas');
        prepCanvas.width = totalSegW + (cleanSegs.length - 1) * digitGap + pad * 2;
        prepCanvas.height = targetH + pad * 2;
        const prepCtx = prepCanvas.getContext('2d');
        prepCtx.fillStyle = '#FFFFFF';
        prepCtx.fillRect(0, 0, prepCanvas.width, prepCanvas.height);
        let curX = pad;
        for (const s of cleanSegs) {
          const sw = s.x2 - s.x1 + 1;
          prepCtx.drawImage(rawCanvas, s.x1, 0, sw, targetH, curX, pad, sw, targetH);
          curX += sw + digitGap;
        }
      } else {
        prepCanvas = document.createElement('canvas');
        prepCanvas.width = targetW + pad * 2;
        prepCanvas.height = targetH + pad * 2;
        const prepCtx = prepCanvas.getContext('2d');
        prepCtx.fillStyle = '#FFFFFF';
        prepCtx.fillRect(0, 0, prepCanvas.width, prepCanvas.height);
        prepCtx.drawImage(rawCanvas, pad, pad);
      }

      return { rawCanvas, prepCanvas, imgData, segmentedCount: cleanSegs.length, segs: cleanSegs, targetW };
    }

    async recognizeWithTesseract(fullCanvas, det, analysisW, analysisH, analysisImgData = null) {
      if (!this.tesseractWorker || !this.tesseractReady || this.tesseractBusy) {
        return null;
      }
      this.tesseractBusy = true;
      try {
        const { rawCanvas, prepCanvas, imgData, segs, targetW } = this.prepareNormalizedCrop(fullCanvas, det, analysisW, analysisH);
        const previewDataUrl = rawCanvas.toDataURL('image/png');
        const { data: res } = await this.tesseractWorker.recognize(prepCanvas);
        const digitsOnly = (res && res.text ? res.text : '').replace(/\D/g, '');
        const conf = res && typeof res.confidence === 'number' ? Math.round(res.confidence) : 0;

        const isAllOnes = /^1+$/.test(digitsOnly) && conf < 82;
        if (digitsOnly.length < 4 || digitsOnly.length > 6 || conf < 35 || isAllOnes) {
          if (analysisImgData) {
            const topo = this.classifyTopological(analysisImgData, det);
            if (topo && topo.validCharCount >= 4 && topo.overallConfidence >= 94) {
              return { ...topo, previewDataUrl };
            }
          }
          return {
            reading: digitsOnly.padStart(5, '0').slice(-5),
            numericValue: Number(digitsOnly) || 0,
            digits: digitsOnly.padStart(5, '0').slice(-5).split('').map(Number),
            digitPredictions: [],
            overallConfidence: conf,
            profileId: det.type || 'UNKNOWN',
            status: 'UNCERTAIN',
            previewDataUrl
          };
        }

        const halfFlags = this.detectHalfRolledDrums(imgData, digitsOnly.length);
        const hasHalfRolled = halfFlags.some(Boolean);
        const paddedStr = digitsOnly.length <= 5 ? digitsOnly.padStart(5, '0') : digitsOnly.slice(-5);
        const digitsArr = paddedStr.split('').map(Number);

        const digitPredictions = digitsArr.map((d, idx) => ({
          digit: d,
          confidence: Math.max(55, Math.min(99, conf)),
          halfRolled: halfFlags[idx] || false
        }));

        // Map individual green digit boxes directly from detected digit segments when available
        const boxConf = Math.max(75, Math.min(99, conf));
        let charBoxes;
        if (segs && segs.length === digitsOnly.length && targetW > 0) {
          charBoxes = segs.map((s, idx) => ({
            x: Math.round(det.x + (s.x1 / targetW) * det.w) - 1,
            y: det.y + 1,
            w: Math.max(6, Math.round(((s.x2 - s.x1 + 1) / targetW) * det.w) + 2),
            h: Math.max(8, det.h - 2),
            digit: Number(digitsOnly[idx]),
            confidence: boxConf
          }));
        } else {
          const count = digitsOnly.length;
          const cellW = det.w / Math.max(1, count);
          charBoxes = digitsOnly.split('').map((ch, idx) => ({
            x: Math.round(det.x + idx * cellW + 1),
            y: det.y + 1,
            w: Math.max(6, Math.round(cellW - 2)),
            h: Math.max(8, det.h - 2),
            digit: Number(ch),
            confidence: boxConf
          }));
        }

        // Ensure 5 separate tracking boxes (Box 1..Box 5)
        if (charBoxes.length === 4) {
          const first = charBoxes[0];
          const estW = first.w;
          charBoxes.unshift({
            x: Math.max(2, first.x - estW - 2),
            y: first.y,
            w: estW,
            h: first.h,
            digit: 0,
            confidence: 99,
            isLeadingZeroSlot: true
          });
        }
        charBoxes = charBoxes.slice(0, 5).map((cb, idx) => ({ ...cb, boxIndex: idx + 1 }));

        return {
          reading: paddedStr,
          numericValue: Number(paddedStr),
          digits: digitsArr,
          digitPredictions,
          charBoxes,
          overallConfidence: Math.max(82, Math.min(99, conf)),
          profileId: det.type || 'LINFLOW_BLACK_ON_WHITE',
          status: hasHalfRolled ? 'HALF_ROLLED' : 'CONFIRMED',
          previewDataUrl
        };
      } catch (err) {
        return null;
      } finally {
        this.tesseractBusy = false;
      }
    }

    /**
     * Fast synchronous topological classifier (used for detector scoring & fallback before WASM boots).
     */
    classifyTopological(imgData, box) {
      const { width: W, data } = imgData;
      const { x: bx, y: by, w: bw, h: bh, polarity } = box;

      let lumSum = 0;
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          const idx = ((by + y) * W + (bx + x)) * 4;
          lumSum += Math.round(0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]);
        }
      }
      const patchMean = lumSum / Math.max(1, bw * bh);
      const targetMean = polarity === 'BLACK_ON_WHITE' ? 121 : 119;
      const lumShift = Math.abs(targetMean - patchMean) > 4 ? Math.round(targetMean - patchMean) : 0;

      const patch = [];
      for (let y = 0; y < bh; y++) {
        const row = new Int16Array(bw);
        for (let x = 0; x < bw; x++) {
          const idx = ((by + y) * W + (bx + x)) * 4;
          const rawL = Math.round(0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]);
          const l = Math.max(0, Math.min(255, rawL + lumShift));
          row[x] = polarity === 'BLACK_ON_WHITE' ? (255 - l) : l;
        }
        patch.push(row);
      }

      const inkThresh = polarity === 'BLACK_ON_WHITE' ? 136 : 134;
      const yStart = polarity === 'BLACK_ON_WHITE' ? Math.max(3, Math.floor(bh * 0.28)) : Math.max(1, Math.floor(bh * 0.08));
      const yEnd = polarity === 'BLACK_ON_WHITE' ? Math.min(bh - 1, Math.ceil(bh * 0.94)) : Math.min(bh - 1, Math.ceil(bh * 0.92));

      const colBrightCount = new Int16Array(bw);
      for (let x = 0; x < bw; x++) {
        for (let y = yStart; y < yEnd; y++) {
          if (patch[y][x] >= inkThresh) colBrightCount[x]++;
        }
      }

      if (polarity === 'BLACK_ON_WHITE') {
        const numDrums = (box.type === 'MONO_ODOMETER_REGISTER' || bw >= bh * 3.55) ? 5 : 4;
        const cellW = bw / numDrums;
        const digits = [];
        const charBoxes = [];
        let sumScore = 0;

        for (let k = 0; k < numDrums; k++) {
          const cx1 = Math.max(1, Math.floor(k * cellW + cellW * 0.06));
          const rightTrim = numDrums === 4 ? 0.44 : 0.14;
          const cx2 = Math.min(bw - 2, Math.floor((k + 1) * cellW - cellW * rightTrim));
          let tx1 = cx1, tx2 = cx2;
          while (tx1 < tx2 && colBrightCount[tx1] < 2) tx1++;
          while (tx2 > tx1 && colBrightCount[tx2] < 2) tx2--;
          const d = this.classifySingleRollerBlob(patch, tx1, tx2, yStart, yEnd, inkThresh);
          digits.push(d.digit);
          sumScore += d.score;
          charBoxes.push({
            x: bx + tx1,
            y: by + yStart,
            w: Math.max(4, tx2 - tx1 + 1),
            h: yEnd - yStart,
            digit: d.digit
          });
        }

        const avgConf = Math.min(99, Math.round((sumScore / numDrums) * 100));
        const padded = numDrums === 5 ? digits.slice(0, 5) : [0, ...digits].slice(0, 5);
        return {
          reading: padded.join(''),
          numericValue: Number(padded.join('')),
          digits: padded,
          confidence: avgConf,
          overallConfidence: avgConf,
          validCharCount: charBoxes.length,
          charBoxes,
          profileId: box.type || 'LINFLOW_BLACK_ON_WHITE',
          status: avgConf >= 91 ? 'CONFIRMED' : 'UNCERTAIN'
        };
      }

      // WHITE_ON_BLACK (5 drums)
      const blobs = [];
      let inBlob = false;
      let sX = 0;
      for (let x = 1; x < bw - 1; x++) {
        if (colBrightCount[x] >= 2) {
          if (!inBlob) {
            inBlob = true;
            sX = x;
          }
        } else if (inBlob) {
          if (x + 1 < bw - 1 && colBrightCount[x + 1] >= 2 && (x - sX) < 6) {
            continue;
          }
          inBlob = false;
          const eX = x - 1;
          if (eX - sX + 1 >= 3) {
            blobs.push({ x1: sX, x2: eX, w: eX - sX + 1 });
          }
        }
      }
      if (inBlob && (bw - 2 - sX + 1) >= 3) {
        blobs.push({ x1: sX, x2: bw - 2, w: bw - 2 - sX + 1 });
      }

      const validBlobs = blobs.filter((b) => {
        let sumBright = 0;
        for (let x = b.x1; x <= b.x2; x++) sumBright += colBrightCount[x];
        return sumBright >= 7 && b.w <= Math.floor(bw * 0.28);
      });

      const digits = [];
      const charBoxes = [];
      let sumScore = 0;
      let validCells = validBlobs.slice(0, 5);
      // If blob extraction missed a drum (e.g. Sensus 620 09702), fall back to 5 equal drum cells
      if (validCells.length !== 5 && bw >= bh * 3.2) {
        validCells = [];
        const cellW = bw / 5;
        for (let k = 0; k < 5; k++) {
          let tx1 = Math.max(1, Math.floor(k * cellW + cellW * 0.10));
          let tx2 = Math.min(bw - 2, Math.floor((k + 1) * cellW - cellW * 0.10));
          while (tx1 < tx2 && colBrightCount[tx1] < 2) tx1++;
          while (tx2 > tx1 && colBrightCount[tx2] < 2) tx2--;
          validCells.push({ x1: tx1, x2: tx2, w: Math.max(4, tx2 - tx1 + 1) });
        }
      }
      for (const c of validCells) {
        const res = this.classifySingleRollerBlob(patch, c.x1, c.x2, yStart, yEnd, inkThresh);
        digits.push(res.digit);
        sumScore += res.score * 100;
        charBoxes.push({ x: bx + c.x1, y: by + yStart, w: c.w, h: yEnd - yStart, digit: res.digit });
      }

      while (digits.length < 5) digits.unshift(0);
      const avgConf = validCells.length > 0 ? Math.round(sumScore / validCells.length) : 0;

      return {
        reading: digits.join(''),
        numericValue: Number(digits.join('')),
        digits: digits.slice(0, 5),
        confidence: avgConf,
        overallConfidence: avgConf,
        validCharCount: validCells.length,
        charBoxes,
        profileId: box.type || 'ITRON_WHITE_ON_BLACK',
        status: (validCells.length >= 4 && avgConf >= 91) ? 'CONFIRMED' : 'UNCERTAIN'
      };
    }

    classifySingleRollerBlob(patch, x1, x2, y1, y2, inkThresh = 134) {
      const trimThresh = inkThresh - 2;
      let ty1 = y1, ty2 = y2 - 1;
      while (ty1 < ty2) {
        let hasBright = false;
        for (let x = x1; x <= x2; x++) if (patch[ty1][x] >= trimThresh) hasBright = true;
        if (hasBright) break;
        ty1++;
      }
      while (ty2 > ty1) {
        let hasBright = false;
        for (let x = x1; x <= x2; x++) if (patch[ty2][x] >= trimThresh) hasBright = true;
        if (hasBright) break;
        ty2--;
      }

      const cw = x2 - x1 + 1;
      const ch = Math.max(1, ty2 - ty1 + 1);
      if (cw <= Math.max(5, Math.floor(ch * 0.42))) return { digit: 1, score: 0.98 };

      function zoneDensity(rx0, rx1, ry0, ry1) {
        let on = 0, tot = 0;
        const sx0 = x1 + Math.floor(rx0 * cw);
        const sx1 = Math.max(sx0 + 1, x1 + Math.ceil(rx1 * cw));
        const sy0 = ty1 + Math.floor(ry0 * ch);
        const sy1 = Math.max(sy0 + 1, ty1 + Math.ceil(ry1 * ch));
        for (let y = sy0; y < sy1 && y <= ty2; y++) {
          for (let x = sx0; x < sx1 && x <= x2; x++) {
            if (patch[y][x] >= inkThresh) on++;
            tot++;
          }
        }
        return tot > 0 ? Number((on / tot).toFixed(2)) : 0;
      }

      const topBar     = zoneDensity(0.15, 0.85, 0.00, 0.24);
      const midBar     = zoneDensity(0.20, 0.80, 0.38, 0.62);
      const botBar     = zoneDensity(0.15, 0.85, 0.76, 1.00);
      const centerHole = zoneDensity(0.30, 0.70, 0.36, 0.64);
      const upperLeft  = zoneDensity(0.00, 0.36, 0.22, 0.42);
      const lowerLeft  = zoneDensity(0.00, 0.36, 0.58, 0.80);
      const upperRight = zoneDensity(0.64, 1.00, 0.22, 0.42);
      const lowerRight = zoneDensity(0.64, 1.00, 0.58, 0.80);

      if (centerHole < 0.38 && upperLeft >= 0.45 && lowerLeft >= 0.45 && upperRight >= 0.45 && lowerRight >= 0.45) return { digit: 0, score: 0.96 };
      if (lowerLeft < 0.35 && upperRight >= 0.50 && lowerRight >= 0.50 && midBar >= 0.45 && (upperLeft < 0.55 || cw <= 7)) return { digit: 3, score: 0.95 };
      if (upperLeft >= 0.45 && lowerLeft >= 0.50 && lowerRight >= 0.50 && upperRight < lowerRight - 0.15 && midBar >= 0.42) return { digit: 6, score: 0.95 };
      if (centerHole >= 0.40 && upperLeft >= 0.42 && lowerLeft >= 0.42 && upperRight >= 0.42 && lowerRight >= 0.42) return { digit: 8, score: 0.94 };
      if (topBar >= 0.45 && botBar >= 0.55 && upperRight >= 0.48 && lowerLeft >= 0.45 && lowerRight < 0.42) return { digit: 2, score: 0.96 };
      if (topBar >= 0.52 && midBar >= 0.50 && upperLeft >= 0.40 && upperRight >= 0.45 && lowerLeft < 0.38) return { digit: 9, score: 0.96 };
      if (topBar >= 0.50 && botBar >= 0.48 && upperLeft >= 0.48 && lowerLeft < 0.42 && lowerRight >= 0.45) return { digit: 5, score: 0.95 };
      if (topBar < 0.55 && midBar >= 0.48 && upperLeft < 0.48) return { digit: 4, score: 0.95 };
      if (topBar >= 0.58 && upperLeft < 0.35 && lowerLeft < 0.35 && botBar < 0.45) return { digit: 7, score: 0.92 };
      return { digit: 8, score: 0.72 };
    }
  }

  if (typeof window !== 'undefined') window.BlackKLRecognizer = BlackKLRecognizer;
  if (typeof module !== 'undefined' && module.exports) module.exports = BlackKLRecognizer;
})(typeof window !== 'undefined' ? window : globalThis);
