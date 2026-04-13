export const FACE_EMBEDDING_DIM = 128;

function l2Normalize(values) {
  const norm = Math.sqrt(values.reduce((acc, v) => acc + v * v, 0));
  if (!norm) {
    return values.map(() => 0);
  }
  return values.map((v) => Number((v / norm).toFixed(6)));
}

function signatureToFallbackEmbedding(signatureHex, dim = FACE_EMBEDDING_DIM) {
  const clean = String(signatureHex || "").toLowerCase().replace(/[^0-9a-f]/g, "");
  if (!clean) {
    return [];
  }

  const bits = [];
  for (const ch of clean) {
    const n = parseInt(ch, 16);
    bits.push((n >> 3) & 1, (n >> 2) & 1, (n >> 1) & 1, n & 1);
  }
  if (bits.length === 0) {
    return [];
  }

  const values = [];
  for (let i = 0; i < dim; i += 1) {
    const b = bits[i % bits.length];
    values.push(b ? 1 : -1);
  }
  return l2Normalize(values);
}

export function embeddingFromSignature(signatureHex, dim = FACE_EMBEDDING_DIM) {
  const validDim = Number(dim) === 512 ? 512 : 128;
  return signatureToFallbackEmbedding(signatureHex, validDim);
}

export function computeFaceSignatureFromCanvas(canvas) {
  if (!canvas) {
    return "";
  }
  const size = 16;
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = size;
  tempCanvas.height = size;
  const tempCtx = tempCanvas.getContext("2d");
  if (!tempCtx) {
    return "";
  }

  tempCtx.drawImage(canvas, 0, 0, size, size);
  const imageData = tempCtx.getImageData(0, 0, size, size).data;
  const grayscale = [];
  for (let i = 0; i < imageData.length; i += 4) {
    const r = imageData[i];
    const g = imageData[i + 1];
    const b = imageData[i + 2];
    grayscale.push(Math.round(0.299 * r + 0.587 * g + 0.114 * b));
  }
  const avg = grayscale.reduce((sum, value) => sum + value, 0) / grayscale.length;
  const bits = grayscale.map((value) => (value >= avg ? 1 : 0)).join("");
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

export function computeFaceEmbeddingFromCanvas(canvas, dim = FACE_EMBEDDING_DIM) {
  if (!canvas) {
    return [];
  }

  const validDim = Number(dim) === 512 ? 512 : 128;
  const cols = validDim === 512 ? 32 : 16;
  const rows = 16;
  const sampleWidth = cols * 2;
  const sampleHeight = rows * 2;

  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = sampleWidth;
  tempCanvas.height = sampleHeight;
  const ctx =
    tempCanvas.getContext("2d", { willReadFrequently: true }) ||
    tempCanvas.getContext("2d");
  if (!ctx) {
    return signatureToFallbackEmbedding(computeFaceSignatureFromCanvas(canvas), validDim);
  }

  ctx.drawImage(canvas, 0, 0, sampleWidth, sampleHeight);
  const data = ctx.getImageData(0, 0, sampleWidth, sampleHeight).data;

  const values = [];
  for (let by = 0; by < rows; by += 1) {
    for (let bx = 0; bx < cols; bx += 1) {
      let blockSum = 0;
      let blockCount = 0;
      for (let py = 0; py < 2; py += 1) {
        for (let px = 0; px < 2; px += 1) {
          const x = bx * 2 + px;
          const y = by * 2 + py;
          const idx = (y * sampleWidth + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          blockSum += 0.299 * r + 0.587 * g + 0.114 * b;
          blockCount += 1;
        }
      }
      values.push(blockCount > 0 ? blockSum / (255 * blockCount) : 0);
    }
  }

  const mean = values.reduce((acc, item) => acc + item, 0) / values.length;
  const centered = values.map((item) => item - mean);
  const normalized = l2Normalize(centered);
  if (normalized.every((item) => item === 0)) {
    return signatureToFallbackEmbedding(computeFaceSignatureFromCanvas(canvas), validDim);
  }
  return normalized;
}

function getLandmarkPoint(landmarks, names) {
  if (!Array.isArray(landmarks)) return null;
  for (const name of names) {
    const found = landmarks.find((item) => String(item?.type || "").toLowerCase() === name.toLowerCase());
    if (found?.location?.x != null && found?.location?.y != null) {
      return { x: Number(found.location.x), y: Number(found.location.y) };
    }
  }
  return null;
}

export function estimatePoseOffset(detectedFace) {
  const box = detectedFace?.boundingBox;
  if (!box) {
    return null;
  }
  const faceWidth = Number(box.width || 0);
  if (!faceWidth) {
    return null;
  }
  const centerX = Number(box.x || 0) + faceWidth / 2;
  const nose = getLandmarkPoint(detectedFace.landmarks, ["nose_tip", "nose", "nosetip"]);
  if (!nose) {
    return null;
  }
  return (nose.x - centerX) / faceWidth;
}
