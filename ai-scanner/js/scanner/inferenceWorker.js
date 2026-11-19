/**
 * Dedicated Offline AI Inference Web Worker (ONNX Runtime Web + OpenCV.js)
 * - Runs completely off the main UI thread (prevents Android Chrome UI freezes).
 * - Uses WebGPU where supported, falling back to WASM SIMD / CPU automatically.
 * - Stage 1: Model 1 (meter_window_det.onnx) -> detects meter_body, odometer_window, red_liter_zone.
 * - Stage 2: Model 2 (digit_crnn.onnx) -> CRNN + CTC decoding (0-9 + '?' ambiguous/half-rolled).
 * - Honestly reports MODELS_MISSING until custom-trained ONNX models are placed in vendor/models/.
 */
'use strict';

const MODEL_DET_URL = '../../vendor/models/meter_window_det.onnx';
const MODEL_CRNN_URL = '../../vendor/models/digit_crnn.onnx';
const ORT_JS_URL = '../../vendor/onnx/ort.min.js';
const OPENCV_JS_URL = '../../vendor/opencv/opencv.js';

const CRNN_CHARS = '0123456789?';
let detSession = null;
let crnnSession = null;
let activeProvider = 'none';
let cvReady = false;

async function fileExists(url) {
  try {
    const resp = await fetch(url, { method: 'HEAD', cache: 'no-cache' });
    return resp.ok;
  } catch (_) {
    return false;
  }
}

async function initEngine() {
  const missing = [];
  const hasOrt = await fileExists(ORT_JS_URL);
  const hasDet = await fileExists(MODEL_DET_URL);
  const hasCrnn = await fileExists(MODEL_CRNN_URL);
  const hasCv = await fileExists(OPENCV_JS_URL);

  if (!hasOrt) missing.push('vendor/onnx/ort.min.js');
  if (!hasDet) missing.push('vendor/models/meter_window_det.onnx');
  if (!hasCrnn) missing.push('vendor/models/digit_crnn.onnx');

  if (missing.length > 0) {
    self.postMessage({
      type: 'INIT_STATUS',
      ready: false,
      status: 'MODELS_MISSING',
      missing,
      hasOpenCV: hasCv
    });
    return;
  }

  try {
    importScripts(ORT_JS_URL);
    if (hasCv) {
      try {
        importScripts(OPENCV_JS_URL);
        cvReady = typeof self.cv !== 'undefined';
      } catch (_) {
        cvReady = false;
      }
    }

    const providers = (typeof navigator !== 'undefined' && navigator.gpu)
      ? ['webgpu', 'wasm']
      : ['wasm'];

    if (self.ort && self.ort.env && self.ort.env.wasm) {
      self.ort.env.wasm.wasmPaths = '../../vendor/onnx/';
      self.ort.env.wasm.numThreads = 2;
    }

    detSession = await self.ort.InferenceSession.create(MODEL_DET_URL, { executionProviders: providers });
    crnnSession = await self.ort.InferenceSession.create(MODEL_CRNN_URL, { executionProviders: providers });
    activeProvider = providers[0];

    self.postMessage({
      type: 'INIT_STATUS',
      ready: true,
      status: 'ONNX_READY',
      provider: activeProvider,
      hasOpenCV: cvReady
    });
  } catch (err) {
    self.postMessage({
      type: 'INIT_STATUS',
      ready: false,
      status: 'INIT_ERROR',
      error: String(err && err.message ? err.message : err)
    });
  }
}

function decodeCrnnCTC(logitsData, dims, minCharConf = 0.80) {
  // dims: [T, B=1, C=12]
  const T = dims[0];
  const C = dims[2];
  let prev = 0;
  let chars = '';
  let minConf = 1.0;

  for (let t = 0; t < T; t++) {
    const base = t * C;
    let maxVal = -Infinity;
    for (let c = 0; c < C; c++) {
      if (logitsData[base + c] > maxVal) maxVal = logitsData[base + c];
    }
    let sumExp = 0;
    let bestIdx = 0;
    let bestProb = 0;
    for (let c = 0; c < C; c++) {
      sumExp += Math.exp(logitsData[base + c] - maxVal);
    }
    for (let c = 0; c < C; c++) {
      const p = Math.exp(logitsData[base + c] - maxVal) / sumExp;
      if (p > bestProb) {
        bestProb = p;
        bestIdx = c;
      }
    }
    if (bestIdx !== 0 && bestIdx !== prev) {
      chars += CRNN_CHARS[bestIdx - 1];
      if (bestProb < minConf) minConf = bestProb;
    }
    prev = bestIdx;
  }

  const uncertain = !chars || chars.includes('?') || minConf < minCharConf;
  return {
    reading: chars,
    minConfidence: Math.round(minConf * 100),
    uncertain
  };
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  if (msg.type === 'INIT') {
    await initEngine();
    return;
  }

  if (msg.type === 'INFER_CRNN' && crnnSession && msg.tensorBuffer) {
    const t0 = performance.now();
    try {
      const inputTensor = new self.ort.Tensor('float32', new Float32Array(msg.tensorBuffer), [1, 3, 48, 192]);
      const outputs = await crnnSession.run({ input: inputTensor });
      const out = outputs.logits || Object.values(outputs)[0];
      const decoded = decodeCrnnCTC(out.data, out.dims, 0.80);
      self.postMessage({
        type: 'CRNN_RESULT',
        requestId: msg.requestId,
        latencyMs: Math.round(performance.now() - t0),
        ...decoded
      });
    } catch (err) {
      self.postMessage({
        type: 'CRNN_RESULT',
        requestId: msg.requestId,
        uncertain: true,
        error: String(err && err.message ? err.message : err)
      });
    }
  }
};
