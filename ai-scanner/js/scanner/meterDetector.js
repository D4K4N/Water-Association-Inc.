/**
 * Phase 2: Physical Water Meter & Mechanical Number-Window Detector
 * 1. Locates the physical water meter body / faceplate boundary.
 * 2. Localizes the mechanical kL number window inside the meter body across diverse brands.
 * 3. Separates the excluded red/black liter drum zone from the kL reading window.
 * 4. Stabilizes tracking across frames with EMA smoothing and hysteresis.
 */
(function (global) {
  'use strict';

  class MeterWindowDetector {
    constructor() {
      this.trackedWindow = null;
      this.trackedMeterBody = null;
      this.missedFrames = 0;
    }

    reset() {
      this.trackedWindow = null;
      this.trackedMeterBody = null;
      this.missedFrames = 0;
    }

    /**
     * Estimates the physical meter housing / circular dial boundary surrounding a candidate window.
     */
    _estimateMeterBodyBox(w, h, winBox) {
      const cx = winBox.x + winBox.w / 2 + (winBox.redLitersBox ? winBox.redLitersBox.w * 0.35 : 0);
      const cy = winBox.y + winBox.h * 1.15;
      const bodyW = Math.min(w - 12, Math.max(winBox.w * 2.4, Math.round(w * 0.56)));
      const bodyH = Math.min(h - 12, Math.max(winBox.h * 5.2, Math.round(bodyW * 0.96)));
      return {
        x: Math.max(6, Math.min(w - bodyW - 6, Math.round(cx - bodyW / 2))),
        y: Math.max(6, Math.min(h - bodyH - 6, Math.round(cy - bodyH / 2))),
        w: Math.round(bodyW),
        h: Math.round(bodyH)
      };
    }

    /**
     * Core frame detector: finds moss obstruction, red-anchored registers (4 & 5 drum),
     * polarity-split registers (0053|59), and monochrome odometer slots (01073 m³).
     */
    detectRaw(imgData, fallbackValidator = null) {
      const w = imgData.width;
      const h = imgData.height;
      const data = imgData.data;

      const lum = new Int16Array(w * h);
      const pureRed = new Uint8Array(w * h);
      let totalGreenMoss = 0;

      for (let i = 0; i < w * h; i++) {
        const r = data[i * 4];
        const g = data[i * 4 + 1];
        const b = data[i * 4 + 2];
        const l = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        lum[i] = l;

        const rg = r - g;
        const gb = g - b;
        if (rg > 21 && rg > gb * 1.15 && r > 85 && l > 50 && l < 195) {
          pureRed[i] = 1;
        }
        if (g > 65 && g > r * 1.24 && g > b * 1.28 && (g - Math.max(r, b)) > 18) {
          totalGreenMoss++;
        }
      }

      if (totalGreenMoss / (w * h) > 0.12) {
        return {
          found: true,
          mossObstructed: true,
          type: 'MOSS_OBSTRUCTED',
          polarity: 'WHITE_ON_BLACK',
          x: Math.floor(w * 0.22),
          y: Math.floor(h * 0.38),
          w: Math.floor(w * 0.56),
          h: Math.floor(h * 0.22)
        };
      }

      // Pass A: Red-Anchored Register Detector (Solid Red Drums OR Red-Ink-on-White Digits)
      const validRows = [];
      const yMinSearch = Math.floor(h * 0.12);
      const yMaxSearch = Math.floor(h * 0.88);
      const minRedPerRow = Math.max(4, Math.floor(w * 0.008));

      for (let y = yMinSearch; y < yMaxSearch; y++) {
        const redXs = [];
        for (let x = Math.floor(w * 0.30); x < Math.floor(w * 0.90); x++) {
          if (pureRed[y * w + x]) redXs.push(x);
        }

        let rMin = 9999, rMax = 0, rowRed = 0;
        if (redXs.length >= minRedPerRow) {
          let curMin = redXs[0], curMax = redXs[0], curCnt = 1;
          for (let k = 1; k < redXs.length; k++) {
            if (redXs[k] - redXs[k - 1] <= 26) {
              curMax = redXs[k];
              curCnt++;
            } else {
              if (curCnt > rowRed) { rowRed = curCnt; rMin = curMin; rMax = curMax; }
              curMin = redXs[k]; curMax = redXs[k]; curCnt = 1;
            }
          }
          if (curCnt > rowRed) { rowRed = curCnt; rMin = curMin; rMax = curMax; }
        }

        const redSpan = rMax - rMin;
        const fillRatio = redSpan > 0 ? (rowRed / redSpan) : 0;
        if (rowRed >= minRedPerRow && redSpan >= Math.floor(w * 0.04) && redSpan <= Math.floor(w * 0.38) && fillRatio >= 0.12) {
          const lookLeftW = Math.min(Math.floor(w * 0.48), Math.max(Math.floor(w * 0.20), Math.round(redSpan * 1.45)));
          const checkLeftStart = Math.max(6, rMin - lookLeftW);
          let minL = 255, maxL = 0, edges = 0;
          const step = redSpan > Math.floor(w * 0.24) ? 5 : 2;
          for (let x = checkLeftStart; x < rMin - 2; x++) {
            const l = lum[y * w + x];
            if (l < minL) minL = l;
            if (l > maxL) maxL = l;
            if (x >= checkLeftStart + step && Math.abs(l - lum[y * w + x - step]) > 22) {
              edges++;
            }
          }
          const minEdges = redSpan > Math.floor(w * 0.24) ? 2 : 5;
          if ((maxL - minL) >= 32 && edges >= minEdges) {
            validRows.push({ y, rMin, rMax, rowRed, redSpan, edges });
          }
        }
      }

      const bands = [];
      let curBand = null;
      for (const r of validRows) {
        if (!curBand) {
          curBand = { rows: [r], yStart: r.y, yEnd: r.y };
        } else if (r.y - curBand.yEnd <= 4 && Math.abs(r.rMin - curBand.rows[curBand.rows.length - 1].rMin) <= 12) {
          curBand.rows.push(r);
          curBand.yEnd = r.y;
        } else {
          bands.push(curBand);
          curBand = { rows: [r], yStart: r.y, yEnd: r.y };
        }
      }
      if (curBand) bands.push(curBand);

      let bestBox = null;
      let bestScore = -1;

      for (const b of bands) {
        const bandH = b.yEnd - b.yStart + 1;
        if (bandH < Math.floor(h * 0.022) || bandH > Math.floor(h * 0.55)) continue;

        const sortedMin = b.rows.map(r => r.rMin).sort((a, z) => a - z);
        const sortedMax = b.rows.map(r => r.rMax).sort((a, z) => a - z);
        const rMin = sortedMin[Math.floor(sortedMin.length * 0.50)];
        const rMax = sortedMax[Math.floor(sortedMax.length * 0.50)];
        const redSpan = rMax - rMin;

        if (bandH < redSpan * 0.22) continue;

        let devSum = 0;
        for (const r of b.rows) devSum += Math.abs(r.rMin - rMin);
        const meanDev = devSum / b.rows.length;
        if (meanDev > 8.5) continue;

        const regY1 = Math.max(0, b.yStart + 1);
        const regY2 = Math.min(h - 1, b.yEnd + 1);
        const regH = regY2 - regY1 + 1;
        const regX2 = rMin - 2;

        if ((rMax - rMin + 1) < regH * 1.45) continue;

        const sampleLums = [];
        const sampleLeft = Math.max(8, regX2 - Math.round(regH * 3.0));
        const ySample1 = regY1 + Math.floor(regH * 0.35);
        const ySample2 = Math.max(ySample1 + 1, regY2 - Math.floor(regH * 0.10));
        for (let y = ySample1; y <= ySample2; y++) {
          for (let x = sampleLeft; x < regX2 - 2; x++) {
            sampleLums.push(lum[y * w + x]);
          }
        }
        sampleLums.sort((a, z) => a - z);
        const p10 = sampleLums.length > 0 ? sampleLums[Math.floor(sampleLums.length * 0.10)] : 0;
        const p50 = sampleLums.length > 0 ? sampleLums[Math.floor(sampleLums.length * 0.50)] : 100;
        const p90 = sampleLums.length > 0 ? sampleLums[Math.floor(sampleLums.length * 0.90)] : 255;
        const relP50 = (p50 - p10) / Math.max(20, p90 - p10);
        const polarity = relP50 >= 0.50 ? 'BLACK_ON_WHITE' : 'WHITE_ON_BLACK';

        let regX1 = Math.max(4, regX2 - Math.round(regH * 5.5));
        if (polarity === 'WHITE_ON_BLACK') {
          let rollerSum = 0, rollerCnt = 0;
          for (let y = regY1; y <= regY2; y++) {
            for (let x = Math.max(8, regX2 - Math.round(regH * 4.0)); x < regX2; x += 2) {
              rollerSum += lum[y * w + x]; rollerCnt++;
            }
          }
          const rollerMean = rollerCnt > 0 ? (rollerSum / rollerCnt) : 95;
          const edgeThresh = Math.min(220, rollerMean + 34);

          const startScanLeft = Math.max(20, regX2 - Math.floor(w * 0.185));
          for (let x = startScanLeft; x >= Math.floor(w * 0.08); x--) {
            let winLumSum = 0, winCount = 0;
            for (let wx = x - 6; wx <= x; wx++) {
              for (let y = regY1; y <= regY2; y++) {
                winLumSum += lum[y * w + wx];
                winCount++;
              }
            }
            if ((winLumSum / Math.max(1, winCount)) > edgeThresh) {
              regX1 = x + 1;
              break;
            }
          }
          let aboveLumSum = 0, aboveCnt = 0;
          for (let y = Math.max(2, regY1 - Math.floor(h * 0.05)); y < regY1 - 2; y++) {
            for (let x = regX1; x < regX2; x += 2) {
              aboveLumSum += lum[y * w + x];
              aboveCnt++;
            }
          }
          const aboveMean = aboveCnt > 0 ? (aboveLumSum / aboveCnt) : 0;
          if (aboveMean < rollerMean + 12) continue;
        } else {
          const span4 = Math.max(Math.round(regH * 3.04), Math.round(redSpan * 1.35));
          const span5 = Math.max(Math.round(regH * 3.85), Math.round(redSpan * 1.72));
          const x4 = Math.max(6, regX2 - span4);
          const x5 = Math.max(6, regX2 - span5);
          let has5thDrum = false;
          if (x4 - x5 >= 10) {
            let hasDarkBorderAt4 = false;
            for (let x = Math.max(0, x4 - 6); x <= Math.min(w - 1, x4 + 3); x++) {
              let colSum = 0, colCnt = 0;
              for (let y = ySample1; y <= ySample2; y++) {
                colSum += lum[y * w + x];
                colCnt++;
              }
              if (colCnt > 0 && (colSum / colCnt) < Math.max(115, p50 * 0.65)) {
                hasDarkBorderAt4 = true;
                break;
              }
            }
            if (!hasDarkBorderAt4) {
              let bright5 = 0, dark5 = 0, edges5 = 0, cnt5 = 0;
              const mid5Start = x5 + Math.floor((x4 - x5) * 0.18);
              const mid5End = x4 - Math.floor((x4 - x5) * 0.22);
              for (let y = ySample1; y <= ySample2; y++) {
                for (let x = mid5Start; x < mid5End; x++) {
                  const l = lum[y * w + x];
                  if (l > p50 * 0.85) bright5++;
                  if (l < 105) dark5++;
                  if (x > mid5Start + 1 && Math.abs(l - lum[y * w + x - 1]) > 28) edges5++;
                  cnt5++;
                }
              }
              if (cnt5 > 0 && (bright5 / cnt5) >= 0.38 && (dark5 / cnt5) >= 0.08 && edges5 >= 10) {
                has5thDrum = true;
              }
            }
          }
          regX1 = has5thDrum ? x5 : x4;
        }

        let candidateBox = {
          found: true,
          type: polarity === 'WHITE_ON_BLACK' ? 'ITRON_WHITE_ON_BLACK' : 'LINFLOW_BLACK_ON_WHITE',
          polarity,
          x: regX1,
          y: regY1,
          w: regX2 - regX1 + 1,
          h: regH,
          redLitersBox: {
            x: rMin,
            y: regY1,
            w: rMax - rMin + 1,
            h: regH
          }
        };

        let score = 60 + Math.min(30, b.rows.length * 0.5) - meanDev * 8.0;
        if (fallbackValidator) {
          let ocr = fallbackValidator(imgData, candidateBox);
          if (polarity === 'BLACK_ON_WHITE') {
            const x4 = Math.max(8, regX2 - Math.round(regH * 3.04));
            const box4 = { ...candidateBox, x: x4, w: regX2 - x4 + 1 };
            const ocr4 = fallbackValidator(imgData, box4);
            if (ocr4.validCharCount >= 4 && (ocr.validCharCount < 4 || ocr4.confidence > ocr.confidence)) {
              candidateBox = box4;
              ocr = ocr4;
            }
          }
          if (ocr.validCharCount < 4) continue;
          score = ocr.confidence * 2.0 + ocr.validCharCount * 10 - meanDev * 8.0;
        }

        if (score > bestScore) {
          bestScore = score;
          bestBox = candidateBox;
        }
      }

      if (bestBox) {
        bestBox.meterBodyBox = this._estimateMeterBodyBox(w, h, bestBox);
        return bestBox;
      }

      // Pass B: Polarity-Split Register Detector (e.g. 0053 | 59)
      let bestSplitBox = null;
      let bestSplitScore = -1;
      const splitHeights = [
        Math.max(16, Math.round(h * 0.065)),
        Math.max(20, Math.round(h * 0.095)),
        Math.max(24, Math.round(h * 0.13)),
        Math.max(28, Math.round(h * 0.175))
      ];
      for (const bandH of splitHeights) {
        for (let yCenter = Math.floor(h * 0.22); yCenter < Math.floor(h * 0.72); yCenter += 4) {
          const y1 = Math.max(4, yCenter - Math.floor(bandH / 2));
          const y2 = Math.min(h - 4, y1 + bandH);
          for (let splitX = Math.floor(w * 0.44); splitX < Math.floor(w * 0.78); splitX += 6) {
            let leftWhite = 0, leftCnt = 0, leftEdges = 0;
            let rightDark = 0, rightCnt = 0;
            const leftStart = Math.max(8, splitX - Math.round(bandH * 3.1));
            const rightEnd = Math.min(w - 8, splitX + Math.round(bandH * 1.45));
            for (let y = y1; y < y2; y += 2) {
              for (let x = leftStart; x < splitX - 2; x += 2) {
                if (lum[y * w + x] > 142) leftWhite++;
                if (x > leftStart + 2 && Math.abs(lum[y * w + x] - lum[y * w + x - 2]) > 24) leftEdges++;
                leftCnt++;
              }
              for (let x = splitX + 2; x < rightEnd; x += 2) {
                if (lum[y * w + x] < 105) rightDark++;
                rightCnt++;
              }
            }
            const lwRatio = leftCnt > 0 ? leftWhite / leftCnt : 0;
            const rdRatio = rightCnt > 0 ? rightDark / rightCnt : 0;
            if (leftCnt > 20 && rightCnt > 10 && lwRatio >= 0.45 && rdRatio >= 0.52 && leftEdges >= 18) {
              let borderEdges = 0;
              for (let x = leftStart; x < splitX; x += 3) {
                if (y1 >= 4 && Math.abs(lum[y1 * w + x] - lum[(y1 - 4) * w + x]) > 20) borderEdges++;
                if (y2 + 4 < h && Math.abs(lum[y2 * w + x] - lum[(y2 + 4) * w + x]) > 20) borderEdges++;
              }
              const centerBonus = 1 - (Math.abs(yCenter - h * 0.48) / (h * 0.5));
              const sizeBonus = Math.min(20, (bandH / Math.max(1, h * 0.14)) * 20);
              const sScore = lwRatio * 40 + rdRatio * 45 + Math.min(35, (leftEdges / Math.max(1, bandH)) * 16) + borderEdges * 0.5 + centerBonus * 12 + sizeBonus;
              if (sScore > bestSplitScore) {
                bestSplitScore = sScore;
                bestSplitBox = {
                  found: true,
                  type: 'POLARITY_SPLIT_REGISTER',
                  polarity: 'BLACK_ON_WHITE',
                  x: leftStart,
                  y: y1,
                  w: splitX - leftStart,
                  h: bandH,
                  redLitersBox: { x: splitX, y: y1, w: rightEnd - splitX, h: bandH }
                };
              }
            }
          }
        }
      }
      if (bestSplitBox) {
        bestSplitBox.meterBodyBox = this._estimateMeterBodyBox(w, h, bestSplitBox);
        return bestSplitBox;
      }

      // Pass C: Universal Monochrome Odometer Slot Detector (e.g. 01073 m³)
      let bestMonoBox = null;
      let bestMonoScore = -1;
      const monoHeights = [
        Math.max(18, Math.round(h * 0.07)),
        Math.max(22, Math.round(h * 0.10)),
        Math.max(26, Math.round(h * 0.135)),
        Math.max(30, Math.round(h * 0.175))
      ];
      for (const bandH of monoHeights) {
        const boxW = Math.round(bandH * 3.75);
        if (boxW > Math.floor(w * 0.65)) continue;
        for (let y1 = Math.floor(h * 0.22); y1 <= Math.floor(h * 0.66) - bandH; y1 += 6) {
          const y2 = y1 + bandH;
          for (let x1 = Math.floor(w * 0.14); x1 <= Math.floor(w * 0.86) - boxW; x1 += 10) {
            let minL = 255, maxL = 0, edgeCnt = 0;
            const cellDark = [0, 0, 0, 0, 0];
            const cellTotal = [0, 0, 0, 0, 0];
            const cellW = boxW / 5;
            for (let y = y1 + 2; y < y2 - 2; y += 2) {
              for (let x = x1 + 2; x < x1 + boxW - 2; x += 2) {
                const l = lum[y * w + x];
                if (l < minL) minL = l;
                if (l > maxL) maxL = l;
                if (x > x1 + 4 && Math.abs(l - lum[y * w + x - 2]) > 26) edgeCnt++;
                const ci = Math.min(4, Math.floor((x - x1) / cellW));
                cellTotal[ci]++;
                if (l < 115) cellDark[ci]++;
              }
            }
            if ((maxL - minL) < 55 || maxL < 140 || edgeCnt < 22) continue;

            let activeDrums = 0;
            for (let c = 0; c < 5; c++) {
              const ratio = cellTotal[c] > 0 ? cellDark[c] / cellTotal[c] : 0;
              if (ratio >= 0.06 && ratio <= 0.55) activeDrums++;
            }
            if (activeDrums < 4) continue;

            let aboveEdges = 0, belowEdges = 0;
            const yAbove = Math.max(2, y1 - Math.max(5, Math.floor(bandH * 0.28)));
            const yBelow = Math.min(h - 3, y2 + Math.max(5, Math.floor(bandH * 0.28)));
            for (let x = x1 + 4; x < x1 + boxW - 4; x += 3) {
              if (Math.abs(lum[yAbove * w + x] - lum[yAbove * w + x - 3]) > 26) aboveEdges++;
              if (Math.abs(lum[yBelow * w + x] - lum[yBelow * w + x - 3]) > 26) belowEdges++;
            }
            if ((aboveEdges + belowEdges) >= edgeCnt * 0.65) continue;

            const candidate = {
              found: true,
              type: 'MONO_ODOMETER_REGISTER',
              polarity: 'BLACK_ON_WHITE',
              x: x1,
              y: y1,
              w: boxW,
              h: bandH
            };
            let ocrScore = 88;
            if (fallbackValidator) {
              const ocr = fallbackValidator(imgData, candidate);
              if (ocr.validCharCount < 4 || ocr.confidence < 82) continue;
              ocrScore = ocr.confidence;
            }

            const cx = x1 + boxW / 2;
            const cy = y1 + bandH / 2;
            const distCenter = Math.hypot(cx - w / 2, cy - h / 2) / Math.hypot(w / 2, h / 2);
            const sizeBonus = Math.min(24, (bandH / Math.max(1, h * 0.14)) * 24);
            const mScore = ocrScore * 1.5 + activeDrums * 8 + Math.min(30, (edgeCnt / Math.max(1, bandH)) * 12) + sizeBonus - distCenter * 20;
            if (mScore > bestMonoScore) {
              bestMonoScore = mScore;
              bestMonoBox = candidate;
            }
          }
        }
      }
      if (bestMonoBox) {
        bestMonoBox.meterBodyBox = this._estimateMeterBodyBox(w, h, bestMonoBox);
        return bestMonoBox;
      }

      return { found: false, reason: 'NUMBER WINDOW NOT DETECTED' };
    }

    /**
     * Stabilized multi-frame detection + EMA spatial tracking.
     */
    trackFrame(imgData, fallbackValidator = null, immediate = false) {
      const rawDet = this.detectRaw(imgData, fallbackValidator);

      if (rawDet.found && rawDet.type === 'MOSS_OBSTRUCTED') {
        this.reset();
        return { ...rawDet, trackingState: 'UNREADABLE' };
      }

      if (rawDet.found) {
        if (this.trackedWindow && !immediate) {
          const cx1 = this.trackedWindow.x + this.trackedWindow.w / 2;
          const cy1 = this.trackedWindow.y + this.trackedWindow.h / 2;
          const cx2 = rawDet.x + rawDet.w / 2;
          const cy2 = rawDet.y + rawDet.h / 2;
          const dist = Math.hypot(cx2 - cx1, cy2 - cy1);
          const wRatio = rawDet.w / Math.max(1, this.trackedWindow.w);

          if (dist <= 48 && wRatio >= 0.65 && wRatio <= 1.55) {
            this.trackedWindow = {
              ...rawDet,
              x: Math.round(this.trackedWindow.x * 0.6 + rawDet.x * 0.4),
              y: Math.round(this.trackedWindow.y * 0.6 + rawDet.y * 0.4),
              w: Math.round(this.trackedWindow.w * 0.6 + rawDet.w * 0.4),
              h: Math.round(this.trackedWindow.h * 0.6 + rawDet.h * 0.4)
            };
            this.trackedMeterBody = rawDet.meterBodyBox;
            this.missedFrames = 0;
            return { ...this.trackedWindow, trackingState: 'TRACKING' };
          } else if (this.missedFrames < 3) {
            this.missedFrames++;
            return { ...this.trackedWindow, trackingState: 'ALIGNING' };
          }
        }

        this.trackedWindow = { ...rawDet };
        this.trackedMeterBody = rawDet.meterBodyBox;
        this.missedFrames = 0;
        return { ...this.trackedWindow, trackingState: 'DETECTING NUMBER WINDOW' };
      }

      if (this.trackedWindow && !immediate && this.missedFrames < 3) {
        this.missedFrames++;
        return { ...this.trackedWindow, trackingState: 'TRACKING LOST' };
      }

      this.reset();
      return {
        found: false,
        reason: 'NUMBER WINDOW NOT DETECTED',
        trackingState: 'SEARCHING FOR METER'
      };
    }
  }

  if (typeof window !== 'undefined') window.MeterWindowDetector = MeterWindowDetector;
  if (typeof module !== 'undefined' && module.exports) module.exports = MeterWindowDetector;
})(typeof window !== 'undefined' ? window : globalThis);
