import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as pdfjsLib from 'pdfjs-dist';
import {
  MultiFormatReader,
  BarcodeFormat,
  DecodeHintType,
  RGBLuminanceSource,
  BinaryBitmap,
  HybridBinarizer
} from '@zxing/library';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { readBarcodes as readWasmBarcodes, prepareZXingModule } from 'zxing-wasm/reader';
import zxingReaderWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { auditLabel, groupValidations, SERVICE_CODE_MAP, SERVICE_TO_PRODUCT_MAP, PRODUCT_CODE_MAP, STARTRACK_PRODUCT_CODE_MAP, STARTRACK_LABEL_CODE_MAP } from './auditEngine.js';
import australiaPostLogoUrl from '../Australia_Post_logo_logotype.png';
import './styles.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

prepareZXingModule({
  overrides: {
    locateFile: (filePath, prefix) => filePath.endsWith('.wasm') ? zxingReaderWasmUrl : prefix + filePath
  }
});

// The scan pipeline tries several decoders. Native BarcodeDetector is fast when the
// browser supports it, while ZXing-WASM and ZXing JS provide broader Code128/DataMatrix
// coverage for the label types this app audits.
const barcodeFormats = ['code_128', 'data_matrix', 'qr_code', 'pdf417', 'ean_13', 'ean_8'];

// These internal categories let the scanner choose barcode-specific crop and transform
// strategies, then route the resulting evidence into the correct report section.
const FORMAT_KIND = { linear: 'linear', datamatrix: 'datamatrix', qr: 'qr', mixed: 'mixed' };
const APP_TITLE = 'Australia Post - eCommerce Integration Label Auditor';
const ACCEPTED_LABEL_FILE_TYPES = 'application/pdf,image/png,image/jpeg,image/webp,image/bmp';
const LABEL_FAMILY_NAMES = { eparcel: 'eParcel', startrack: 'StarTrack' };
const BARCODE_BOX_MARGIN_PX = 36;

// ZXing and native browser scans use different format names. Normalizing them here
// keeps the audit engine and report renderer independent of the decoder that succeeded.
const zxingFormatMap = new Map([
  [BarcodeFormat.CODE_128, 'code_128'],
  [BarcodeFormat.DATA_MATRIX, 'data_matrix'],
  [BarcodeFormat.QR_CODE, 'qr_code'],
  [BarcodeFormat.PDF_417, 'pdf417'],
  [BarcodeFormat.EAN_13, 'ean_13'],
  [BarcodeFormat.EAN_8, 'ean_8'],
  [BarcodeFormat.UPC_A, 'upc_a'],
  [BarcodeFormat.ITF, 'itf'],
  [BarcodeFormat.CODE_39, 'code_39'],
  [BarcodeFormat.CODE_93, 'code_93']
]);

/** Returns the display name shown for a carrier-specific upload/audit path. */
function labelFamilyName(labelFamily) {
  return LABEL_FAMILY_NAMES[labelFamily] || LABEL_FAMILY_NAMES.eparcel;
}

/** Checks whether the current browser exposes the optional native BarcodeDetector API. */
function canUseBarcodeDetector() {
  return 'BarcodeDetector' in window;
}

/** Creates a native detector when available; callers should continue with ZXing when this returns null. */
async function createDetector() {
  if (!canUseBarcodeDetector()) return null;
  try {
    const supported = await window.BarcodeDetector.getSupportedFormats?.();
    const formats = Array.isArray(supported)
      ? barcodeFormats.filter(f => supported.includes(f))
      : barcodeFormats;
    if (formats.length === 0) return null;
    return new window.BarcodeDetector({ formats });
  } catch (_error) {
    try {
      return new window.BarcodeDetector({ formats: barcodeFormats });
    } catch (_error2) {
      return null;
    }
  }
}

/** Collapses duplicate barcode values while preserving the best available page-location evidence. */
function dedupeBarcodes(items) {
  const map = new Map();
  for (const item of items) {
    if (!item?.rawValue) continue;
    const normalized = String(item.rawValue).replace(/\s+/g, '').trim();
    const key = `${item.format || 'unknown'}:${normalized}`;
    const clean = { ...item, rawValue: item.rawValue.trim?.() ?? item.rawValue };
    if (!map.has(key)) {
      map.set(key, clean);
      continue;
    }
    const existing = map.get(key);
    // A value can decode several times from different crops. Prefer the copy that can
    // prove where it came from on the original page, because that drives crop evidence.
    map.set(key, {
      ...existing,
      ...(!existing.pageBoundingBox && clean.pageBoundingBox ? { pageBoundingBox: clean.pageBoundingBox } : {}),
      ...(!existing.boundingBox && clean.boundingBox ? { boundingBox: clean.boundingBox } : {}),
      ...(!existing.locationQuality && clean.locationQuality ? { locationQuality: clean.locationQuality } : {}),
      ...(!existing.targetBox && clean.targetBox ? { targetBox: clean.targetBox } : {}),
      // Keep the source label that explains the successful location read in the UI.
      ...(clean.pageBoundingBox && !existing.pageBoundingBox ? {
        source: clean.source,
        regionLabel: clean.regionLabel,
        variantLabel: clean.variantLabel
      } : {})
    });
  }
  return [...map.values()];
}

/** Runs the native browser decoder against one rendered canvas region. */
async function detectWithBrowserBarcodeDetector(canvas, detector, pageNumber = 1, regionLabel = 'full-page') {
  if (!detector) return [];
  try {
    const results = await detector.detect(canvas);
    return results.map((r, index) => ({
      rawValue: r.rawValue,
      format: r.format || 'unknown',
      source: 'Browser BarcodeDetector',
      pageNumber,
      index,
      regionLabel,
      boundingBox: r.boundingBox ? {
        x: Math.round(r.boundingBox.x),
        y: Math.round(r.boundingBox.y),
        width: Math.round(r.boundingBox.width),
        height: Math.round(r.boundingBox.height)
      } : null
    }));
  } catch (error) {
    console.warn('BarcodeDetector failed on canvas', error);
    return [];
  }
}

/** Builds the pure-JS ZXing fallback reader for the requested symbologies. */
function makeZxingReader(formats = ['Code128', 'DataMatrix']) {
  const formatMap = {
    Code128: BarcodeFormat.CODE_128,
    DataMatrix: BarcodeFormat.DATA_MATRIX,
    QRCode: BarcodeFormat.QR_CODE,
    PDF417: BarcodeFormat.PDF_417,
    EAN13: BarcodeFormat.EAN_13,
    EAN8: BarcodeFormat.EAN_8,
    UPCA: BarcodeFormat.UPC_A,
    ITF: BarcodeFormat.ITF,
    Code39: BarcodeFormat.CODE_39,
    Code93: BarcodeFormat.CODE_93
  };
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, formats.map(f => formatMap[f]).filter(Boolean));
  hints.set(DecodeHintType.TRY_HARDER, true);
  const reader = new MultiFormatReader();
  reader.setHints(hints);
  return reader;
}

/** Attempts one pure-JS ZXing decode and returns the same barcode shape used by other decoders. */
function zxingDecodeCanvas(canvas, pageNumber = 1, regionLabel = 'full-page', formats = ['Code128', 'DataMatrix'], kind = FORMAT_KIND.mixed, variantLabel = 'original') {
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const luminanceSource = new RGBLuminanceSource(imageData.data, canvas.width, canvas.height);
    const bitmap = new BinaryBitmap(new HybridBinarizer(luminanceSource));
    const reader = makeZxingReader(formats);
    const decoded = reader.decodeWithState ? reader.decodeWithState(bitmap) : reader.decode(bitmap);
    const format = zxingFormatMap.get(decoded.getBarcodeFormat()) || String(decoded.getBarcodeFormat());
    const points = decoded.getResultPoints?.() || [];
    return [{
      rawValue: decoded.getText(),
      format,
      kind,
      source: 'ZXing JS fallback',
      pageNumber,
      index: 0,
      regionLabel,
      variantLabel,
      boundingBox: points.length ? pointsToBox(points) : null
    }];
  } catch (_error) {
    return [];
  }
}

/** Runs ZXing-WASM, the primary decoder for reliable Code128/DataMatrix reads in local browsers. */
async function wasmDecodeCanvas(canvas, pageNumber = 1, regionLabel = 'full-page', formats = ['Code128', 'DataMatrix'], kind = FORMAT_KIND.mixed, variantLabel = 'original', options = {}) {
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const results = await readWasmBarcodes(imageData, {
      formats,
      tryHarder: true,
      tryRotate: true,
      tryInvert: true,
      tryDownscale: true,
      tryDenoise: kind === FORMAT_KIND.datamatrix,
      maxNumberOfSymbols: 0,
      minLineCount: kind === FORMAT_KIND.linear ? 1 : 2,
      textMode: 'HRI',
      binarizer: options.binarizer || 'LocalAverage',
      isPure: Boolean(options.isPure),
      returnErrors: false
    });
    return (results || [])
      .filter(r => r && r.text && r.isValid !== false)
      .map((r, index) => ({
        rawValue: r.text,
        format: r.format || r.symbology || 'unknown',
        symbology: r.symbology || '',
        source: 'ZXing-WASM crop scanner',
        pageNumber,
        index,
        regionLabel,
        kind,
        variantLabel,
        orientation: r.orientation,
        symbologyIdentifier: r.symbologyIdentifier || '',
        boundingBox: r.position ? {
          x: Math.round(Math.min(r.position.topLeft?.x ?? 0, r.position.bottomLeft?.x ?? 0, r.position.topRight?.x ?? 0, r.position.bottomRight?.x ?? 0)),
          y: Math.round(Math.min(r.position.topLeft?.y ?? 0, r.position.bottomLeft?.y ?? 0, r.position.topRight?.y ?? 0, r.position.bottomRight?.y ?? 0)),
          width: Math.round(Math.max(r.position.topLeft?.x ?? 0, r.position.bottomLeft?.x ?? 0, r.position.topRight?.x ?? 0, r.position.bottomRight?.x ?? 0) - Math.min(r.position.topLeft?.x ?? 0, r.position.bottomLeft?.x ?? 0, r.position.topRight?.x ?? 0, r.position.bottomRight?.x ?? 0)),
          height: Math.round(Math.max(r.position.topLeft?.y ?? 0, r.position.bottomLeft?.y ?? 0, r.position.topRight?.y ?? 0, r.position.bottomRight?.y ?? 0) - Math.min(r.position.topLeft?.y ?? 0, r.position.bottomLeft?.y ?? 0, r.position.topRight?.y ?? 0, r.position.bottomRight?.y ?? 0))
        } : null
      }));
  } catch (error) {
    console.warn('ZXing-WASM scan failed', regionLabel, variantLabel, error);
    return [];
  }
}

/** Converts ZXing result points into the rectangular evidence box used by crops and overlays. */
function pointsToBox(points) {
  const xs = points.map(p => p.getX());
  const ys = points.map(p => p.getY());
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    x: Math.round(minX),
    y: Math.round(minY),
    width: Math.round(maxX - minX),
    height: Math.round(maxY - minY)
  };
}

/** Clamps an evidence/crop box so image extraction never reads outside the source canvas. */
function clampBox(box, width, height) {
  if (!box) return null;
  const x = Math.max(0, Math.min(width - 1, Math.round(box.x || 0)));
  const y = Math.max(0, Math.min(height - 1, Math.round(box.y || 0)));
  const right = Math.max(x + 1, Math.min(width, Math.round((box.x || 0) + (box.width || 0))));
  const bottom = Math.max(y + 1, Math.min(height, Math.round((box.y || 0) + (box.height || 0))));
  return { x, y, width: right - x, height: bottom - y };
}

/** Adds a consistent visual margin around barcode boxes so report crops are readable and comparable. */
function expandBox(box, canvasWidth, canvasHeight, marginPx = BARCODE_BOX_MARGIN_PX) {
  if (!box) return null;
  const pad = Math.max(0, Math.round(marginPx));
  return clampBox({
    x: box.x - pad,
    y: box.y - pad,
    width: box.width + pad * 2,
    height: box.height + pad * 2
  }, canvasWidth, canvasHeight);
}

/** Returns the user-facing barcode type label used in captions and report sections. */
function barcodeKindLabel(b) {
  if (isDataMatrixBarcode(b)) return 'GS1 DataMatrix';
  if (isQrBarcode(b)) return 'QR Barcode';
  if (isLinearBarcode(b)) return 'Linear Barcode';
  return b?.format || 'Barcode';
}

/** Maps a crop-local barcode box back to page coordinates when the crop was not transformed. */
function mapBarcodeToPage(barcode, target, variantLabel = '') {
  const base = { ...barcode };
  const targetBox = {
    x: Math.round(target.x || 0),
    y: Math.round(target.y || 0),
    width: Math.round(target.w || target.canvas?.width || 0),
    height: Math.round(target.h || target.canvas?.height || 0)
  };
  base.targetBox = targetBox;

  // Transformed crops are useful for decoding, but their coordinates are not reliable
  // evidence of final label placement. Only untransformed reads can prove location.
  const isUntransformed = !variantLabel || variantLabel === 'original';
  if (base.boundingBox && isUntransformed) {
    base.pageBoundingBox = clampBox({
      x: targetBox.x + base.boundingBox.x,
      y: targetBox.y + base.boundingBox.y,
      width: base.boundingBox.width,
      height: base.boundingBox.height
    }, targetBox.x + Math.max(targetBox.width, 1), targetBox.y + Math.max(targetBox.height, 1));
    base.locationQuality = 'decoded-symbol-bounding-box';
  } else if (target.label === 'Full page safety scan' && base.boundingBox) {
    base.pageBoundingBox = clampBox(base.boundingBox, target.canvas.width, target.canvas.height);
    base.locationQuality = 'decoded-symbol-bounding-box';
  } else {
    base.locationQuality = 'decoded-no-page-box';
  }
  return base;
}

function pageBoxInfo(b) {
  const box = b?.pageBoundingBox;
  if (!box) return '';
  return `${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}×${Math.round(box.height)} px`;
}

function imageBoxCaption(images = {}, kind = FORMAT_KIND.datamatrix) {
  if (kind === FORMAT_KIND.qr) {
    const box = images.qrBarcodeBox;
    const label = 'Detected QR barcode location for this label';
    if (!box) return 'QR fallback crop used for scanning/assessment';
    return `${label} · box ${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}×${Math.round(box.height)}px`;
  }
  if (kind === 'startrack-routing') {
    const box = images.routingBarcodeBox;
    const label = 'Detected StarTrack routing barcode location for this label';
    if (!box) return `${label} · fallback crop only`;
    return `${label} · box ${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}×${Math.round(box.height)}px`;
  }
  if (kind === 'startrack-atl') {
    const box = images.atlBarcodeBox;
    const label = 'Detected StarTrack ATL barcode location for this label';
    if (!box) return `${label} Â· fallback crop only`;
    return `${label} Â· box ${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}Ã—${Math.round(box.height)}px`;
  }
  if (kind === 'startrack-freight') {
    const box = images.freightBarcodeBox;
    const label = 'Detected StarTrack freight item barcode location for this label';
    if (!box) return `${label} · fallback crop only`;
    return `${label} · box ${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}×${Math.round(box.height)}px`;
  }
  const box = kind === FORMAT_KIND.datamatrix ? images.dataMatrixBox : images.linearBarcodeBox;
  const label = kind === FORMAT_KIND.datamatrix ? 'Detected GS1 DataMatrix location for this label' : 'Detected linear barcode location for this label';
  if (!box) return `${label} · fallback crop only`;
  return `${label} · box ${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}×${Math.round(box.height)}px`;
}

function rotateCanvas(sourceCanvas, degrees) {
  if (degrees === 0) return sourceCanvas;
  const out = document.createElement('canvas');
  const radians = degrees * Math.PI / 180;
  const swap = degrees === 90 || degrees === 270;
  out.width = swap ? sourceCanvas.height : sourceCanvas.width;
  out.height = swap ? sourceCanvas.width : sourceCanvas.height;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate(radians);
  ctx.drawImage(sourceCanvas, -sourceCanvas.width / 2, -sourceCanvas.height / 2);
  return out;
}

function cropCanvas(sourceCanvas, x, y, width, height) {
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.floor(width));
  out.height = Math.max(1, Math.floor(height));
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(sourceCanvas, x, y, width, height, 0, 0, out.width, out.height);
  return out;
}


function scaleCanvas(sourceCanvas, factor = 2) {
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(sourceCanvas.width * factor));
  out.height = Math.max(1, Math.round(sourceCanvas.height * factor));
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sourceCanvas, 0, 0, out.width, out.height);
  return out;
}

function thresholdCanvas(sourceCanvas, threshold = 150) {
  const out = document.createElement('canvas');
  out.width = sourceCanvas.width;
  out.height = sourceCanvas.height;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(sourceCanvas, 0, 0);
  const img = ctx.getImageData(0, 0, out.width, out.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const grey = (img.data[i] * 0.299) + (img.data[i + 1] * 0.587) + (img.data[i + 2] * 0.114);
    const v = grey < threshold ? 0 : 255;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

function addWhiteBorder(sourceCanvas, borderRatio = 0.10) {
  const border = Math.max(12, Math.round(Math.min(sourceCanvas.width, sourceCanvas.height) * borderRatio));
  const out = document.createElement('canvas');
  out.width = sourceCanvas.width + border * 2;
  out.height = sourceCanvas.height + border * 2;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(sourceCanvas, border, border);
  return out;
}

function trimDarkBounds(sourceCanvas, padding = 14, threshold = 205) {
  const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  const { width, height } = sourceCanvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 600));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const grey = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (grey < threshold) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < minX || maxY < minY) return sourceCanvas;
  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(width, maxX + padding);
  maxY = Math.min(height, maxY + padding);
  return cropCanvas(sourceCanvas, minX, minY, Math.max(1, maxX - minX), Math.max(1, maxY - minY));
}

function squareCanvas(sourceCanvas, paddingRatio = 0.08) {
  const size = Math.max(sourceCanvas.width, sourceCanvas.height);
  const pad = Math.round(size * paddingRatio);
  const out = document.createElement('canvas');
  out.width = size + pad * 2;
  out.height = size + pad * 2;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(sourceCanvas, pad + (size - sourceCanvas.width) / 2, pad + (size - sourceCanvas.height) / 2);
  return out;
}

function makeScanVariants(baseCanvas, kind, labels = null) {
  const allowed = labels ? new Set(labels) : null;
  const variants = [];
  const add = (label, makeCanvas, options = {}) => {
    if (!allowed || allowed.has(label)) variants.push({ label, canvas: makeCanvas(), options });
  };
  const trimmed = trimDarkBounds(baseCanvas, kind === FORMAT_KIND.datamatrix ? 8 : 18, kind === FORMAT_KIND.datamatrix ? 220 : 210);
  const bordered = addWhiteBorder(trimmed, kind === FORMAT_KIND.datamatrix ? 0.18 : 0.08);
  let bordered2x = null;
  const getBordered2x = () => {
    if (!bordered2x) bordered2x = scaleCanvas(bordered, 2);
    return bordered2x;
  };
  add('original', () => baseCanvas);
  add('trimmed + border', () => bordered);
  add('2x nearest', getBordered2x);
  add('4x nearest', () => scaleCanvas(bordered, 4));
  add('threshold 150', () => thresholdCanvas(getBordered2x(), 150), { binarizer: 'FixedThreshold' });
  add('threshold 185', () => thresholdCanvas(getBordered2x(), 185), { binarizer: 'FixedThreshold' });
  if (kind === FORMAT_KIND.datamatrix || kind === FORMAT_KIND.qr) {
    add('square pure 2x', () => scaleCanvas(squareCanvas(trimmed, 0.20), 2), { isPure: true, binarizer: 'FixedThreshold' });
    add('square pure 4x', () => scaleCanvas(kind === FORMAT_KIND.datamatrix ? squareCanvas(trimmed, 0.16) : bordered, 4), { isPure: true });
  }
  return variants;
}

function selectScanVariants(baseCanvas, kind) {
  const preferred = {
    [FORMAT_KIND.linear]: ['original', 'trimmed + border', '2x nearest', 'threshold 150'],
    [FORMAT_KIND.qr]: ['original', 'trimmed + border', '2x nearest', 'square pure 2x'],
    [FORMAT_KIND.datamatrix]: ['original', 'trimmed + border', '2x nearest', '4x nearest', 'threshold 150', 'square pure 2x'],
    [FORMAT_KIND.mixed]: ['original', 'trimmed + border', '2x nearest']
  }[kind] || ['original', 'trimmed + border', '2x nearest'];
  return makeScanVariants(baseCanvas, kind, preferred);
}

function shouldStopTargetScan(target, found) {
  if (!found.length) return false;
  if (target.kind === FORMAT_KIND.datamatrix || target.kind === FORMAT_KIND.qr) return true;
  if (target.kind === FORMAT_KIND.linear) return true;
  return found.length >= 2;
}

function shortenBarcodeValue(value, maxLength = 42) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function detectorResultSummary(decoded) {
  if (!decoded.length) return 'no detector results';
  return decoded.map(barcode => {
    const source = barcode.source || 'Unknown detector';
    const format = barcode.format || barcode.symbology || 'unknown format';
    const variant = barcode.variantLabel ? ` via ${barcode.variantLabel}` : '';
    return `${source} (${format}${variant}) "${shortenBarcodeValue(barcode.rawValue)}"`;
  }).join('; ');
}

function makeTarget(sourceCanvas, kind, label, x, y, w, h, formats) {
  const targetCanvas = (x === 0 && y === 0 && w === sourceCanvas.width && h === sourceCanvas.height)
    ? sourceCanvas
    : cropCanvas(sourceCanvas, x, y, w, h);
  return { kind, label, x, y, w, h, canvas: targetCanvas, formats };
}

function hasBarcodeKind(barcodes, kind) {
  return (barcodes || []).some(barcode => (
    kind === FORMAT_KIND.qr ? isQrBarcode(barcode)
      : kind === FORMAT_KIND.datamatrix ? isDataMatrixBarcode(barcode)
        : kind === FORMAT_KIND.linear ? isLinearBarcode(barcode) && !isDataMatrixBarcode(barcode) && !isQrBarcode(barcode)
          : false
  ));
}

function shouldSkipFullPageSafetyScan(found, labelFamily = 'eparcel') {
  const unique = dedupeBarcodes(found);
  if (labelFamily === 'startrack') {
    return unique.length >= 3 && hasBarcodeKind(unique, FORMAT_KIND.qr);
  }
  return unique.length >= 2;
}

function buildCategorizedScanTargets(canvas, labelFamily = 'eparcel') {
  const w = canvas.width;
  const h = canvas.height;
  if (labelFamily === 'startrack') {
    return [
      makeTarget(canvas, FORMAT_KIND.qr, 'StarTrack QR full label scan', 0, 0, w, h, ['QRCode']),
      makeTarget(canvas, FORMAT_KIND.linear, 'StarTrack routing barcode expected crop', w * 0.04, h * 0.23, w * 0.62, h * 0.22, ['Code128']),
      makeTarget(canvas, FORMAT_KIND.linear, 'StarTrack freight item barcode expected crop', w * 0.04, h * 0.50, w * 0.92, h * 0.20, ['Code128']),
      makeTarget(canvas, FORMAT_KIND.linear, 'Linear barcode lower horizontal crop', w * 0.03, h * 0.43, w * 0.94, h * 0.32, ['Code128']),
      makeTarget(canvas, FORMAT_KIND.mixed, 'Full page safety scan', 0, 0, w, h, ['Code128', 'QRCode'])
    ];
  }
  return [
    makeTarget(canvas, FORMAT_KIND.linear, 'eParcel primary linear barcode crop', w * 0.04, h * 0.23, w * 0.62, h * 0.22, ['Code128']),
    makeTarget(canvas, FORMAT_KIND.mixed, 'Full page safety scan', 0, 0, w, h, ['Code128', 'DataMatrix'])
  ];
}
function buildScanRegions(canvas) {
  const w = canvas.width;
  const h = canvas.height;
  const regions = [
    { label: 'full page', x: 0, y: 0, w, h },
    { label: 'top right DataMatrix zone', x: w * 0.55, y: 0, w: w * 0.45, h: h * 0.35 },
    { label: 'right barcode stripe', x: w * 0.68, y: 0, w: w * 0.32, h },
    { label: 'lower barcode zone', x: 0, y: h * 0.42, w, h: h * 0.40 },
    { label: 'middle barcode zone', x: 0, y: h * 0.30, w, h: h * 0.45 },
    { label: 'bottom half', x: 0, y: h * 0.50, w, h: h * 0.50 },
    { label: 'upper half', x: 0, y: 0, w, h: h * 0.55 }
  ];
  return regions.map(r => ({ ...r, canvas: cropCanvas(canvas, r.x, r.y, r.w, r.h) }));
}


function imageStats(canvas, label) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width, height } = canvas;
  if (!width || !height) return { label, blackRatio: 0, transitionRate: 0, evidence: `${label}: empty region` };
  const imageData = ctx.getImageData(0, 0, width, height).data;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 180));
  let samples = 0;
  let black = 0;
  let transitions = 0;
  let previous = null;

  for (let y = 0; y < height; y += step) {
    previous = null;
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const grey = (imageData[i] + imageData[i + 1] + imageData[i + 2]) / 3;
      const isBlack = grey < 110;
      if (isBlack) black += 1;
      if (previous !== null && previous !== isBlack) transitions += 1;
      previous = isBlack;
      samples += 1;
    }
  }

  const blackRatio = samples ? black / samples : 0;
  const transitionRate = samples ? transitions / samples : 0;
  return {
    label,
    blackRatio,
    transitionRate,
    evidence: `${label}: blackRatio=${blackRatio.toFixed(3)}, transitionRate=${transitionRate.toFixed(3)}, size=${width}x${height}`
  };
}

function bestStatsOverGrid(canvas, label, cellsX = 5, cellsY = 5) {
  let best = null;
  const minCell = 40;
  for (let gy = 0; gy < cellsY; gy += 1) {
    for (let gx = 0; gx < cellsX; gx += 1) {
      const cw = Math.max(minCell, Math.floor(canvas.width / cellsX * 1.5));
      const ch = Math.max(minCell, Math.floor(canvas.height / cellsY * 1.5));
      const x = Math.min(canvas.width - cw, Math.floor((canvas.width - cw) * (gx / Math.max(1, cellsX - 1))));
      const y = Math.min(canvas.height - ch, Math.floor((canvas.height - ch) * (gy / Math.max(1, cellsY - 1))));
      const crop = cropCanvas(canvas, Math.max(0, x), Math.max(0, y), cw, ch);
      const stats = imageStats(crop, `${label} grid ${gx},${gy}`);
      const score = (stats.blackRatio * 1.2) + (stats.transitionRate * 3.0);
      if (!best || score > best.score) best = { ...stats, score, x, y, width: cw, height: ch };
    }
  }
  return best || imageStats(canvas, `${label} grid empty`);
}

function detectVisualBarcodeEvidence(canvas) {
  const w = canvas.width;
  const h = canvas.height;

  // Visual evidence is a backup when a symbol appears on the label but does not decode.
  // These heuristics are not pass/fail barcode verification; they help explain likely
  // scanner misses in the report so a reviewer knows where to look.
  const dataMatrixBroadRegion = cropCanvas(canvas, w * 0.55, h * 0.02, w * 0.43, h * 0.30);
  const dataMatrixExactRegion = cropCanvas(canvas, w * 0.74, h * 0.09, w * 0.23, h * 0.17);
  const rightStripeRegion = cropCanvas(canvas, w * 0.70, h * 0.25, w * 0.28, h * 0.62);
  const lowerBarcodeRegion = cropCanvas(canvas, w * 0.05, h * 0.45, w * 0.90, h * 0.25);

  const dmBroadStats = imageStats(dataMatrixBroadRegion, 'top-right DataMatrix broad visual region');
  const dmExactStats = imageStats(dataMatrixExactRegion, 'top-right DataMatrix expected visual region');
  const dmGridStats = bestStatsOverGrid(dataMatrixBroadRegion, 'top-right DataMatrix', 5, 4);
  const rightStats = imageStats(rightStripeRegion, 'right-side linear barcode visual region');
  const lowerStats = imageStats(lowerBarcodeRegion, 'lower linear barcode visual region');

  const dmCandidates = [dmBroadStats, dmExactStats, dmGridStats];
  const dataMatrixVisible = dmCandidates.some(stats => (
    stats.blackRatio > 0.055 && stats.transitionRate > 0.012
  )) || dmCandidates.some(stats => (
    stats.blackRatio > 0.11 && stats.transitionRate > 0.008
  ));

  const linearBarcodeVisible = (rightStats.blackRatio > 0.08 && rightStats.transitionRate > 0.035) ||
    (lowerStats.blackRatio > 0.08 && lowerStats.transitionRate > 0.035);

  return {
    dataMatrixVisible,
    linearBarcodeVisible,
    dataMatrixEvidence: [dmBroadStats.evidence, dmExactStats.evidence, dmGridStats.evidence].join('; '),
    linearEvidence: `${rightStats.evidence}; ${lowerStats.evidence}`,
    regions: [dmBroadStats, dmExactStats, dmGridStats, rightStats, lowerStats]
  };
}

function mergeVisualEvidence(existing, next) {
  if (!existing) return next;
  return {
    dataMatrixVisible: Boolean(existing.dataMatrixVisible || next.dataMatrixVisible),
    linearBarcodeVisible: Boolean(existing.linearBarcodeVisible || next.linearBarcodeVisible),
    dataMatrixEvidence: [existing.dataMatrixEvidence, next.dataMatrixEvidence].filter(Boolean).join('\n'),
    linearEvidence: [existing.linearEvidence, next.linearEvidence].filter(Boolean).join('\n'),
    regions: [...(existing.regions || []), ...(next.regions || [])]
  };
}

function canvasToDataUrl(sourceCanvas, maxWidth = 700, mime = 'image/jpeg', quality = 0.86) {
  if (!sourceCanvas?.width || !sourceCanvas?.height) return '';
  const scale = Math.min(1, maxWidth / sourceCanvas.width);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(sourceCanvas.width * scale));
  out.height = Math.max(1, Math.round(sourceCanvas.height * scale));
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(sourceCanvas, 0, 0, out.width, out.height);
  try {
    return out.toDataURL(mime, quality);
  } catch (_error) {
    return '';
  }
}

function canvasToDataUrlWithBarcodeBoxes(sourceCanvas, barcodes = [], maxWidth = 820) {
  if (!sourceCanvas?.width || !sourceCanvas?.height) return '';
  const scale = Math.min(1, maxWidth / sourceCanvas.width);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(sourceCanvas.width * scale));
  out.height = Math.max(1, Math.round(sourceCanvas.height * scale));
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(sourceCanvas, 0, 0, out.width, out.height);

  const located = barcodes.filter(b => b.pageBoundingBox);
  ctx.lineWidth = Math.max(3, Math.round(4 * scale));
  ctx.font = `${Math.max(12, Math.round(18 * scale))}px Segoe UI, Arial, sans-serif`;
  for (const b of located) {
    const box = expandBox(b.pageBoundingBox, sourceCanvas.width, sourceCanvas.height, BARCODE_BOX_MARGIN_PX);
    if (!box) continue;
    const x = box.x * scale;
    const y = box.y * scale;
    const width = box.width * scale;
    const height = box.height * scale;
    const isDm = isDataMatrixBarcode(b);
    const isQr = isQrBarcode(b);
    ctx.strokeStyle = isDm || isQr ? '#0b5cad' : '#c40018';
    ctx.fillStyle = isDm || isQr ? 'rgba(11,92,173,.12)' : 'rgba(196,0,24,.10)';
    ctx.fillRect(x, y, width, height);
    ctx.strokeRect(x, y, width, height);
    const label = barcodeKindLabel(b);
    const textWidth = ctx.measureText(label).width + 12;
    const labelY = Math.max(0, y - Math.max(20, 22 * scale));
    ctx.fillStyle = isDm || isQr ? '#0b5cad' : '#c40018';
    ctx.fillRect(x, labelY, textWidth, Math.max(18, 22 * scale));
    ctx.fillStyle = '#fff';
    ctx.fillText(label, x + 6, labelY + Math.max(13, 16 * scale));
  }
  return out.toDataURL('image/jpeg', 0.88);
}

function cropForDecodedBarcode(canvas, barcodes, kind) {
  const list = barcodes.filter(b => b.pageBoundingBox && (kind === FORMAT_KIND.datamatrix ? isDataMatrixBarcode(b) : kind === FORMAT_KIND.qr ? isQrBarcode(b) : isLinearBarcode(b) && !isDataMatrixBarcode(b) && !isQrBarcode(b)));
  if (!list.length) return null;
  // Use the read with page coordinates because this crop is shown as evidence, not
  // just as a convenience image.
  const chosen = list.find(b => b.locationQuality === 'decoded-symbol-bounding-box') || list[0];
  const box = expandBox(chosen.pageBoundingBox, canvas.width, canvas.height, BARCODE_BOX_MARGIN_PX);
  if (!box) return null;
  return {
    canvas: cropCanvas(canvas, box.x, box.y, box.width, box.height),
    box,
    barcode: chosen
  };
}

function normalizeBarcodeValueForRole(value) {
  return String(value || '').replace(/[()\s]/g, '').trim().toUpperCase();
}

function isStarTrackFreightItemValue(value) {
  const v = normalizeBarcodeValueForRole(value);
  return /^[A-Z0-9]{4}\d{8}[A-Z0-9]{3}\d{5}$/.test(v) || /^00\d{18}$/.test(v);
}

function isStarTrackAtlValue(value) {
  const v = normalizeBarcodeValueForRole(value);
  return /^C\d{9}$/.test(v);
}

function isStarTrackRoutingValue(value) {
  const v = normalizeBarcodeValueForRole(value);
  const route = v.match(/^([A-Z0-9]{3})\d{4}[A-Z0-9]{2,3}$/);
  const gs1Route = v.match(/^421036\d{4}403([A-Z0-9]{3})$/);
  return Boolean((route && STARTRACK_LABEL_CODE_MAP[route[1]]) || (gs1Route && STARTRACK_LABEL_CODE_MAP[gs1Route[1]]));
}

function cropForDecodedBarcodeMatch(canvas, barcodes, predicate, marginPx = BARCODE_BOX_MARGIN_PX) {
  const list = (barcodes || []).filter(b => b.pageBoundingBox && predicate(b));
  if (!list.length) return null;
  const chosen = list.find(b => b.locationQuality === 'decoded-symbol-bounding-box') || list[0];
  const box = expandBox(chosen.pageBoundingBox, canvas.width, canvas.height, marginPx);
  if (!box) return null;
  return {
    canvas: cropCanvas(canvas, box.x, box.y, box.width, box.height),
    box,
    barcode: chosen
  };
}

function createLabelImages(canvas, detectedBarcodes = []) {
  const w = canvas.width;
  const h = canvas.height;
  const dmLocated = cropForDecodedBarcode(canvas, detectedBarcodes, FORMAT_KIND.datamatrix);
  const qrLocated = cropForDecodedBarcode(canvas, detectedBarcodes, FORMAT_KIND.qr);
  const linearLocated = cropForDecodedBarcode(canvas, detectedBarcodes, FORMAT_KIND.linear);
  const starTrackRoutingLocated = cropForDecodedBarcodeMatch(
    canvas,
    detectedBarcodes,
    b => isLinearBarcode(b) && !isQrBarcode(b) && !isDataMatrixBarcode(b) && isStarTrackRoutingValue(b.rawValue)
  );
  const starTrackAtlLocated = cropForDecodedBarcodeMatch(
    canvas,
    detectedBarcodes,
    b => isLinearBarcode(b) && !isQrBarcode(b) && !isDataMatrixBarcode(b) && isStarTrackAtlValue(b.rawValue)
  );
  const starTrackFreightLocated = cropForDecodedBarcodeMatch(
    canvas,
    detectedBarcodes,
    b => isLinearBarcode(b) && !isQrBarcode(b) && !isDataMatrixBarcode(b) && isStarTrackFreightItemValue(b.rawValue)
  );

  // Fixed template crops are fallback evidence only. If a barcode decoded with a real
  // page box, prefer that because label layouts can shift between products/customers.
  const dmCrop = cropCanvas(canvas, w * 0.55, h * 0.02, w * 0.43, h * 0.31);
  const dmFocusedCrop = cropCanvas(canvas, w * 0.72, h * 0.07, w * 0.26, h * 0.22);
  const qrCrop = cropCanvas(canvas, w * 0.35, h * 0.10, w * 0.60, h * 0.55);
  const linearCrop = cropCanvas(canvas, w * 0.04, h * 0.42, w * 0.92, h * 0.30);
  const rightLinearCrop = cropCanvas(canvas, w * 0.68, h * 0.18, w * 0.31, h * 0.68);
  const starTrackRoutingCrop = cropCanvas(canvas, w * 0.04, h * 0.23, w * 0.62, h * 0.22);
  const starTrackAtlCrop = cropCanvas(canvas, w * 0.54, h * 0.02, w * 0.44, h * 0.18);
  const starTrackFreightCrop = cropCanvas(canvas, w * 0.04, h * 0.50, w * 0.92, h * 0.20);

  return {
    labelPreviewPlain: canvasToDataUrl(canvas, 760),
    labelPreview: canvasToDataUrlWithBarcodeBoxes(canvas, detectedBarcodes, 820),
    dataMatrixCrop: canvasToDataUrl(dmLocated?.canvas || dmCrop, 420),
    dataMatrixFocusedCrop: canvasToDataUrl(dmLocated?.canvas || dmFocusedCrop, 320),
    dataMatrixBox: dmLocated?.box || null,
    dataMatrixBoxSource: dmLocated?.barcode ? `${dmLocated.barcode.source || 'scanner'} · ${dmLocated.barcode.regionLabel || ''} · ${dmLocated.barcode.variantLabel || ''}` : 'fallback heuristic crop only',
    qrBarcodeCrop: canvasToDataUrl(qrLocated?.canvas || qrCrop, 420),
    qrBarcodeBox: qrLocated?.box || null,
    qrBarcodeBoxSource: qrLocated?.barcode ? `${qrLocated.barcode.source || 'scanner'} · ${qrLocated.barcode.regionLabel || ''} · ${qrLocated.barcode.variantLabel || ''}` : 'fallback heuristic crop only',
    linearBarcodeCrop: canvasToDataUrl(linearLocated?.canvas || linearCrop, 780),
    rightLinearBarcodeCrop: canvasToDataUrl(linearLocated?.canvas || rightLinearCrop, 420),
    linearBarcodeBox: linearLocated?.box || null,
    linearBarcodeBoxSource: linearLocated?.barcode ? `${linearLocated.barcode.source || 'scanner'} · ${linearLocated.barcode.regionLabel || ''} · ${linearLocated.barcode.variantLabel || ''}` : 'fallback heuristic crop only',
    routingBarcodeCrop: canvasToDataUrl(starTrackRoutingLocated?.canvas || starTrackRoutingCrop, 620),
    routingBarcodeBox: starTrackRoutingLocated?.box || null,
    routingBarcodeBoxSource: starTrackRoutingLocated?.barcode ? `${starTrackRoutingLocated.barcode.source || 'scanner'} · ${starTrackRoutingLocated.barcode.regionLabel || ''} · ${starTrackRoutingLocated.barcode.variantLabel || ''}` : 'fallback heuristic crop only',
    atlBarcodeCrop: canvasToDataUrl(starTrackAtlLocated?.canvas || starTrackAtlCrop, 620),
    atlBarcodeBox: starTrackAtlLocated?.box || null,
    atlBarcodeBoxSource: starTrackAtlLocated?.barcode ? `${starTrackAtlLocated.barcode.source || 'scanner'} Â· ${starTrackAtlLocated.barcode.regionLabel || ''} Â· ${starTrackAtlLocated.barcode.variantLabel || ''}` : 'fallback heuristic crop only',
    freightBarcodeCrop: canvasToDataUrl(starTrackFreightLocated?.canvas || starTrackFreightCrop, 780),
    freightBarcodeBox: starTrackFreightLocated?.box || null,
    freightBarcodeBoxSource: starTrackFreightLocated?.barcode ? `${starTrackFreightLocated.barcode.source || 'scanner'} · ${starTrackFreightLocated.barcode.regionLabel || ''} · ${starTrackFreightLocated.barcode.variantLabel || ''}` : 'fallback heuristic crop only'
  };
}

const STANDARD_EXAMPLES = {
  A6_SIZE: 'eParcel labels should be supplied as an A6-style PDF page. The audit accepts either true A6 sizing (105mm x 148mm) or common thermal-label sizing (100mm x 150mm), in portrait or landscape, with tolerance for PDF rounding.',
  TEXT_EXTRACTED: 'Digital PDF/image should expose or render label content such as DELIVER TO, SENDER/FROM, AP Article ID and barcode zones.',
  LABEL_TYPE: 'Parcel Post / Express Post branding may be image-only. Product family is verified primarily from decoded product code when text extraction cannot expose the header.',
  VISIBLE_ARTICLE_ID: 'AP Article ID: 2JD569514501000910903',
  VISIBLE_CONS_NO: 'Con No 2JD5695145',
  ADDR_TO_PRESENT: 'DELIVER TO block with address ending in suburb/state/postcode, e.g. CHULLORA NSW 2190.',
  ADDR_FROM_PRESENT: 'SENDER/FROM block with address ending in suburb/state/postcode, e.g. RICHMOND VIC 3121.',
  ADDR_SUBURB_STATE_POSTCODE: 'Suburb, state and postcode on one line, capitalised, no comma: CHULLORA NSW 2190.',
  DG_DECLARATION: 'Aviation Security and Dangerous Goods Declaration present as a separate declaration area.',
  WEIGHT_PRESENT: 'Weight displayed as a kg value, e.g. 1.00kg.',
  GS1_128_PRESENT: 'Required GS1-128 Linear Barcode must decode and contain AI 01 + Australia Post GTIN and AI 91 + article component.',
  DATAMATRIX_PRESENT: 'Required GS1 DataMatrix Barcode must decode and contain AI 01, AI 91 and additional delivery data.',
  ARTICLE_PARSE: 'Standard article ID: MLID + 7-digit consignment suffix + article count + product + service + postage paid + check digit.',
  GS1_PREFIX: 'Decoded GS1 barcode begins with AI 01 and Australia Post GTIN: 0199312650999998.',
  AI91: 'Decoded GS1 barcode includes AI 91 followed by the eParcel article component.',
  MLID: 'MLID is 3 or 5 uppercase alphanumeric characters, e.g. 2JD or 1JDQ1.',
  CONSIGNMENT: 'Consignment suffix is 7 digits; consignment ID example: 2JD5695145.',
  CONSIGNMENT_MATCH: 'Visible Con No should match MLID + 7 digit consignment suffix parsed from AP Article Id.',
  ARTICLE_COUNT: 'Article count is 01 to 20.',
  POSTAGE_PAID: 'Postage paid indicator is 0.',
  CHECK_DIGIT: 'Check digit is calculated from the article ID excluding the final digit.',
  SERVICE_KNOWN: 'Known service code example: 09 — Non-Signature + ATL.',
  PRODUCT_KNOWN: 'Known product code example: 00091 — Parcel Post (Non-Signature).',
  SERVICE_PRODUCT_MATCH: 'Service 09 supports products 00091 and 00087.',
  DM_POSTCODE: 'GS1 DataMatrix includes AI 420 + 4 digit delivery postcode, e.g. 4202190.',
  DM_8008: 'GS1 DataMatrix includes AI 8008 + label generation date/time in YYMMDDHHMMSS format.',
  DM_DPID: 'AI 92 DPID is optional; if present it must be 8 digits and not 00000000. If unavailable, omit AI 92 and its separator.',
  DM_SEPARATORS: 'GS1 FNC1/group separators must be encoded as control characters, not literal text such as FNC1, _1 or $.',
  SSCC: 'SSCC uses AI 00 and is treated differently from standard eParcel article IDs.',
  ST_LABEL_SIZE: 'StarTrack despatch labels are normally 100mm x 150mm. Optional extended despatch labels may be 100mm x 200mm. Controlled Returns/Transfer labels may be 150mm x 100mm. The audit allows tolerance for PDF rounding.',
  ST_TEXT_EXTRACTED: 'Digital PDF/image should expose or render StarTrack label content such as CONNOTE, receiver, sender, routing and barcode zones.',
  ST_LOGO_HEADER: 'The P-StarTrack logo must appear in the label header.',
  ST_LABEL_CODE_VISIBLE: 'A 3-character StarTrack label code such as EXP, PRM, ARL, RET, RE2, APT or TSE should appear in the header.',
  ST_CONNOTE_VISIBLE: 'CONNOTE should be visible in the header and support up to 20 characters.',
  ST_RECEIVER_BLOCK: 'Receiver details must include full name/business/address/suburb/state/postcode and phone where present.',
  ST_SENDER_BLOCK: 'Sender details must include sender name, phone, address, suburb and postcode beneath the routing barcode.',
  ST_WEIGHT_PRESENT: 'Weight should be displayed in kg in the item details area.',
  ST_QR_PRESENT: 'StarTrack 2D QR barcode must appear on all labels. It uses fixed-width fields and error correction level L.',
  ST_FREIGHT_BARCODE_PRESENT: 'Freight item barcode is mandatory: either StarTrack 20-character Code128 XXXZ99999999AAA99999 or GS1 AI 00 SSCC.',
  ST_ROUTING_BARCODE_PRESENT: 'Routing barcode is mandatory: StarTrack SSS9999DD/DDD or GS1 421/403 routing barcode for AU domestic SSCC labels.',
  ST_PRODUCT_KNOWN: 'Known StarTrack product codes include EXP, PRM, FPP, ARL, FPA, RET, RE2, APT and TSE.',
  ST_CONNOTE_STRUCTURE: 'StarTrack connote number format is four-character Despatch ID plus eight-digit incrementing number.',
  ST_ITEM_SEQUENCE: 'StarTrack freight item barcode ends with a five-digit item number.',
  ST_CONNOTE_MATCH: 'Visible CONNOTE should match the connote component from the freight item barcode.',
  ST_SSCC: 'StarTrack SSCC uses GS1 AI 00 + 18 digit SSCC and must have a valid GS1 check digit.',
  ST_ROUTE_LABEL_CODE: 'Routing label code should be a valid StarTrack label code such as EXP, PRM or ARL.',
  ST_ROUTE_POSTCODE: 'Routing barcode includes a four-digit receiver postcode, or 9901 for NZ Premium consignments.',
  ST_ROUTE_PRODUCT_MATCH: 'Routing label code should match the product label code: EXP→EXP, PRM/FPP→PRM, ARL/FPA→ARL.',
  ST_QR_MANDATORY: 'StarTrack QR fixed-width payload contains mandatory receiver, connote, freight item, product, quantity, weight, despatch date, unit, depot, DG and movement fields.',
  ST_QR_POSTCODE: 'QR receiver postcode must be four digits.',
  ST_QR_PRODUCT: 'QR product code must be a valid 3-character StarTrack product code.',
  ST_QR_DG: 'QR Dangerous Goods Indicator permitted values are Y or N.',
  ST_QR_MOVEMENT: 'QR Movement Type permitted values are N (Despatch), C (Controlled Return), or T (Transfer).',
  ST_QR_UNIT: 'Unit type must be permitted for the StarTrack product; examples include CTN, BAG, ITM, PAL, SAT and SKI.',
  ST_QR_ATL: 'ATL number format is C999999999 when Authority To Leave is selected.',
  ST_ATL_BARCODE: 'Optional StarTrack ATL barcode format is C999999999.',
  ST_ATL_COUNTER: 'ATL sequential counter starts at 000000001 and increments per consignment requiring Authority To Leave.',
  ST_SSCC_PRODUCT_RULE: 'For StarTrack SSCC, product is not encoded in the SSCC article identifier; use QR/routing/manifest context for product where available.',
};

function standardForValidation(v) {
  const id = String(v?.id || '');
  const direct = STANDARD_EXAMPLES[id];
  if (direct) return direct;
  const key = Object.keys(STANDARD_EXAMPLES).find(k => id.startsWith(k));
  if (key) return STANDARD_EXAMPLES[key];
  return v?.expected || 'Follow the Australia Post eParcel label/barcode rule for this field.';
}

function sectionId(category) {
  return `section-${String(category || 'general').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

function cropForCategory(category, audit) {
  const images = audit?.labelImages || {};
  if (category === 'datamatrix' || category === 'DataMatrix barcode analysis') {
    return { title: 'DataMatrix crop', src: images.dataMatrixFocusedCrop || images.dataMatrixCrop };
  }
  if (category === 'gs1-128' || category === 'barcode-structure' || category === 'check-digit' || category === 'linear barcode analysis') {
    return { title: 'Linear barcode crop', src: images.linearBarcodeCrop || images.rightLinearBarcodeCrop };
  }
  return null;
}

function validationTone(v) {
  if (v.status === 'fail') return 'row-fail';
  if (v.status === 'manual_review' || v.status === 'warning') return 'row-review';
  if (v.status === 'pass') return 'row-pass';
  return '';
}

function humanFlag(value) {
  return value ? 'Yes' : 'No';
}

function selectedServiceCodes(audit) {
  return [...new Set((audit?.articles || []).map(a => a.serviceCode).filter(Boolean))];
}

function selectedProductCodes(audit) {
  return [...new Set((audit?.articles || []).map(a => a.productCode).filter(Boolean))];
}

function auditHasSsccOnly(audit) {
  const articles = audit?.articles || [];
  return Boolean(audit?.expectedSscc?.provided) || (articles.some(a => a?.type === 'sscc') && !articles.some(a => a?.type === 'eparcel-standard'));
}

function isSsccArticle(article) {
  return article?.type === 'sscc';
}

function productOrLabelTypeForAudit(audit) {
  if (auditHasSsccOnly(audit)) return 'SSCC label';
  return productFamilyForArticle(getPrimaryArticle(audit));
}

function serviceCodeForAudit(audit) {
  if (auditHasSsccOnly(audit)) return 'Not applicable';
  return getPrimaryArticle(audit)?.serviceCode || '';
}


const SERVICE_REFERENCE_ROWS = [
  {
    serviceCode: '03',
    flags: { safeDrop: false, signature: true, atl: false, partial: false, noSignature: false },
    apiPayload: { authority_to_leave: false, allow_partial_delivery: false, safe_drop_enabled: false },
    products: [
      ['00093', 'Parcel Post + Signature'],
      ['00096', 'Express Post + Signature'],
      ['00065', 'Parcel Post Return'],
      ['00068', 'Express Post Return']
    ]
  },
  {
    serviceCode: '08',
    flags: { safeDrop: false, signature: false, atl: true, partial: false, noSignature: false },
    apiPayload: { authority_to_leave: true, allow_partial_delivery: false, safe_drop_enabled: false },
    products: [
      ['00093', 'Parcel Post + Signature'],
      ['00096', 'Express Post + Signature'],
      ['00065', 'Parcel Post Return'],
      ['00068', 'Express Post Return']
    ]
  },
  {
    serviceCode: '45',
    flags: { safeDrop: false, signature: true, atl: false, partial: true, noSignature: false },
    apiPayload: { authority_to_leave: false, allow_partial_delivery: true, safe_drop_enabled: false },
    products: [
      ['00093', 'Parcel Post + Signature'],
      ['00096', 'Express Post + Signature']
    ]
  },
  {
    serviceCode: '15',
    flags: { safeDrop: false, signature: false, atl: true, partial: true, noSignature: false },
    apiPayload: { authority_to_leave: true, allow_partial_delivery: true, safe_drop_enabled: false },
    products: [
      ['00093', 'Parcel Post + Signature'],
      ['00096', 'Express Post + Signature']
    ]
  },
  {
    serviceCode: '50',
    flags: { safeDrop: true, signature: false, atl: false, partial: false, noSignature: false },
    apiPayload: { authority_to_leave: false, allow_partial_delivery: false, safe_drop_enabled: true },
    products: [
      ['00093', 'Parcel Post + Signature'],
      ['00096', 'Express Post + Signature']
    ]
  },
  {
    serviceCode: '51',
    flags: { safeDrop: true, signature: false, atl: false, partial: true, noSignature: false },
    apiPayload: { authority_to_leave: false, allow_partial_delivery: true, safe_drop_enabled: true },
    products: [
      ['00093', 'Parcel Post + Signature'],
      ['00096', 'Express Post + Signature']
    ]
  },
  {
    serviceCode: '09',
    flags: { safeDrop: false, signature: false, atl: false, partial: true, noSignature: true },
    apiPayload: { authority_to_leave: true, allow_partial_delivery: true, safe_drop_enabled: false },
    products: [
      ['00091', 'Parcel Post (Non-Signature)'],
      ['00087', 'Express Post (Non-Signature)']
    ]
  },
  {
    serviceCode: '49*',
    matchCode: '49',
    flags: { safeDrop: false, signature: true, atl: false, partial: false, noSignature: false },
    apiPayload: { authority_to_leave: false, allow_partial_delivery: false, safe_drop_enabled: false },
    apiNote: 'IDENTITY_ON_DELIVERY feature must be used with an id_capture_type value of “addressee”.',
    products: [['00093', 'Parcel Post Signature (Wine)']]
  },
  {
    serviceCode: '81',
    flags: { safeDrop: false, signature: true, atl: false, partial: false, noSignature: false },
    apiPayload: { authority_to_leave: false, allow_partial_delivery: false, safe_drop_enabled: false },
    products: [['00093', 'Parcel Post Signature (Wine)']]
  },
  {
    serviceCode: '82',
    flags: { safeDrop: false, signature: false, atl: true, partial: false, noSignature: false },
    apiPayload: { authority_to_leave: true, allow_partial_delivery: true, safe_drop_enabled: false },
    products: [['00093', 'Parcel Post Signature (Wine)']]
  },
  {
    serviceCode: '83',
    flags: { safeDrop: true, signature: false, atl: false, partial: false, noSignature: false },
    apiPayload: { authority_to_leave: false, allow_partial_delivery: false, safe_drop_enabled: true },
    products: [['00093', 'Parcel Post Signature (Wine)']]
  }
];

function serviceRowMatchCode(row) {
  return row.matchCode || row.serviceCode.replace(/\D/g, '');
}

function xMark(value) {
  return value ? 'X' : '';
}

function servicePayloadText(row) {
  const payload = `"authority_to_leave": ${row.apiPayload.authority_to_leave},\n"allow_partial_delivery": ${row.apiPayload.allow_partial_delivery},\n"safe_drop_enabled": ${row.apiPayload.safe_drop_enabled}`;
  return row.apiNote ? `${payload}\n\n${row.apiNote}` : payload;
}

function isDataMatrixBarcode(b) {
  const fmt = String(b?.format || b?.symbology || '').toLowerCase();
  const raw = String(b?.rawValue || '');
  return fmt.includes('data') || raw.includes('(420)') || raw.includes('(8008)') || raw.includes('8008') || raw.includes('|420');
}

function isQrBarcode(b) {
  const fmt = String(b?.format || b?.symbology || '').toLowerCase();
  return fmt.includes('qr') || b?.kind === FORMAT_KIND.qr;
}

function isLinearBarcode(b) {
  const fmt = String(b?.format || b?.symbology || '').toLowerCase();
  return fmt.includes('128') || fmt.includes('code') || b?.kind === FORMAT_KIND.linear;
}

function decodedBarcodeList(audit, type) {
  const all = audit?.detectedBarcodes || [];
  if (type === 'datamatrix') return all.filter(isDataMatrixBarcode);
  if (type === 'qr') return all.filter(isQrBarcode);
  if (type === 'linear') return all.filter(b => isLinearBarcode(b) && !isDataMatrixBarcode(b) && !isQrBarcode(b));
  return all;
}

function starTrackRoutingBarcodeList(audit) {
  return decodedBarcodeList(audit, 'linear').filter(b => isStarTrackRoutingValue(b.rawValue));
}

function starTrackAtlBarcodeList(audit) {
  return decodedBarcodeList(audit, 'linear').filter(b => isStarTrackAtlValue(b.rawValue));
}

function starTrackFreightBarcodeList(audit) {
  return decodedBarcodeList(audit, 'linear').filter(b => isStarTrackFreightItemValue(b.rawValue));
}

function dmParseList(audit) {
  return (audit?.parsed || []).filter(p => p && Object.prototype.hasOwnProperty.call(p, 'hasAi420'));
}

function barcodeDisplayName(b) {
  const value = String(b?.format || b?.symbology || '').toLowerCase();
  if (value.includes('data')) return 'GS1 DataMatrix';
  if (value.includes('qr') || b?.kind === FORMAT_KIND.qr) return 'QR Barcode';
  if (value.includes('128') || b?.kind === FORMAT_KIND.linear) return 'Linear / Code128';
  return b?.format || b?.symbology || 'barcode';
}

function rawBarcodeListHtml(items, esc) {
  return (items || []).map(b => `<li><strong>${esc(barcodeDisplayName(b))}</strong> page ${esc(b.pageNumber || '')}: <code class="raw-code">${esc(b.rawValue || '')}</code></li>`).join('');
}

function formatDurationMs(ms) {
  if (!Number.isFinite(ms)) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function yieldToBrowser() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

const VALIDATION_TABLE_REPORT_CSS = `
.validation-table th:nth-child(1),.validation-table td:nth-child(1){width:38%}.validation-table th:nth-child(2),.validation-table td:nth-child(2){width:44%}.validation-table th:last-child,.validation-table td:last-child{width:120px;text-align:center;vertical-align:top}.validation-table.has-payload-column th:nth-child(1),.validation-table.has-payload-column td:nth-child(1){width:34%}.validation-table.has-payload-column th:nth-child(2),.validation-table.has-payload-column td:nth-child(2){width:30%}.validation-table.has-payload-column th:nth-child(3),.validation-table.has-payload-column td:nth-child(3){width:22%}.validation-table.has-payload-column th:last-child,.validation-table.has-payload-column td:last-child{width:140px}.criteria-cell,.measurement-cell,.status-stack{display:grid;gap:6px;align-content:start}.criteria-cell strong{font-size:12px}.criteria-standard,.criteria-expected{display:block;color:#53606d;font-size:12px;font-weight:400;text-transform:none;letter-spacing:0}.criteria-expected{color:#344054}.measurement-label{display:block;color:#53606d;font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.02em}.measurement-cell code{display:inline-block;margin-top:2px}.badge{display:inline-block;border-radius:999px;padding:4px 9px;font-size:10.5px;font-weight:900;text-transform:uppercase;white-space:nowrap;background:#eee}.badge-fail,.badge-error,.badge-critical{background:#ffe1e5;color:#a00018}.badge-warning,.badge-review{background:#fff0c2;color:#7a4b00}.badge-info,.badge-not_applicable,.badge-manual_review{background:#e7f0ff;color:#0d4f9b}.badge-pass{background:#dff5e7;color:#087a2e}.payload-status{display:grid;gap:4px;justify-items:center;margin-top:4px}.payload-status>span{color:#53606d;font-size:10px;font-weight:800;text-transform:uppercase}.payload-status .payload-evidence{display:none}
`;


const REPORT_CSS = `
body{font-family:Inter,Segoe UI,Arial,sans-serif;margin:18px;color:#17202a;background:#f6f7f9;font-size:13px;line-height:1.45}.wrap{max-width:1220px;margin:0 auto}.hero,.card,.section,.toc{background:white;border:1px solid #e3e8ef;border-radius:16px;margin:12px 0;padding:16px;box-shadow:0 6px 20px rgba(0,0,0,.035)}h1{margin:0;color:#c40018}.hero-startrack h1{color:#007dbb}h2{margin:0 0 12px}.status{font-size:24px;font-weight:900}.status-inline{font-weight:900}.FAIL{color:#b00020}.PASS{color:#147a2e}.REVIEW{color:#9a5a00}.nav{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.nav a{background:#f0f4f8;border:1px solid #dce4ee;border-radius:999px;padding:7px 10px}table{border-collapse:collapse;width:100%;font-size:11.5px;table-layout:fixed}td,th{border:1px solid #dce2e8;padding:7px;vertical-align:top;text-align:left;overflow-wrap:anywhere}th{background:#f2f5f8}.row-fail{background:#fff0f2}.row-review{background:#fff8e6}.row-pass{background:#f1fbf4}.selected{background:#e8f3ff!important}.startrack-report .selected{background:#dff3ff!important}.pill{display:inline-block;border-radius:99px;background:#e8f3ff;color:#124a7a;padding:2px 7px;font-size:10px;font-weight:800;text-transform:uppercase}.preview{max-width:460px;border:1px solid #ccd3dc;border-radius:10px}.crop img{max-width:420px;border:1px solid #ccd3dc;border-radius:10px;background:white}.facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.facts>div{background:#f8fafc;border:1px solid #e3e8ef;border-radius:12px;padding:9px}.two-col{display:grid;grid-template-columns:minmax(320px,.9fr) 1.1fr;gap:16px}.metric{display:inline-block;background:#f5f7fa;border:1px solid #e5e9ef;border-radius:12px;padding:8px 10px;margin:4px 5px 4px 0}.raw-code,code{font-family:ui-monospace,SFMono-Regular,Consolas,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere;word-break:normal;font-size:12px}pre{background:#f7f9fb;border:1px solid #e3e8ef;border-radius:10px;padding:10px;overflow:auto;max-height:280px;white-space:pre-wrap}.muted{color:#666}a{color:#0b5cad;text-decoration:none}a:hover{text-decoration:underline}.service-matrix-wrap{overflow-x:auto;border-radius:12px;border:1px solid #111}.service-matrix-table{min-width:980px;border-collapse:collapse;table-layout:fixed;font-size:11px;background:#d9d9d9}.service-matrix-table th{background:#c40000;color:white;border:1px solid #111;text-align:center;vertical-align:middle;padding:7px 5px;font-weight:800}.service-matrix-table td{background:#d9d9d9;border:1px solid #111;color:#000;vertical-align:middle;padding:6px;overflow-wrap:anywhere}.startrack-matrix th{background:#dff3ff;color:#063c5a}.flag-cell{font-weight:900;font-size:14px;text-align:center}.payload-cell pre{margin:0;padding:0;border:0;background:transparent;font-size:10.5px;max-height:none;white-space:pre-wrap;overflow:visible}.service-selected-row td,.service-selected-row .payload-cell pre{background:#fff7c2!important}.selected-combination-row td,.product-selected-cell{background:#dff5e7!important}@media(max-width:800px){.two-col,.facts{grid-template-columns:1fr}.preview{max-width:100%}}
.service-matrix-table{min-width:1280px;font-size:11px;line-height:1.25}.service-matrix-table th,.service-matrix-table td{padding:7px 6px;vertical-align:middle}.service-matrix-table th{line-height:1.15;overflow-wrap:normal;word-break:normal}.service-matrix-table th:nth-child(1),.service-matrix-table td:nth-child(1){width:64px;text-align:center}.service-matrix-table th:nth-child(2),.service-matrix-table td:nth-child(2){width:58px;text-align:center}.service-matrix-table th:nth-child(3),.service-matrix-table td:nth-child(3){width:82px;text-align:center}.service-matrix-table th:nth-child(4),.service-matrix-table td:nth-child(4){width:76px;text-align:center}.service-matrix-table th:nth-child(5),.service-matrix-table td:nth-child(5){width:76px;text-align:center}.service-matrix-table th:nth-child(6),.service-matrix-table td:nth-child(6){width:88px;text-align:center}.service-matrix-table th:nth-child(7),.service-matrix-table td:nth-child(7){width:220px}.service-matrix-table th:nth-child(8),.service-matrix-table td:nth-child(8){width:82px;text-align:center}.service-matrix-table th:nth-child(9),.service-matrix-table td:nth-child(9){width:145px}.service-matrix-table th:nth-child(10),.service-matrix-table td:nth-child(10){width:145px;text-align:center}.flag-cell{font-size:14px;text-align:center;vertical-align:middle}.service-code-cell{vertical-align:middle;text-align:center}.payload-cell pre{font-size:10.5px;line-height:1.3}.payload-match{font-size:10px;letter-spacing:.02em;padding:3px 7px}.payload-match-na{background:#eef1f5;color:#53606d;border:1px solid #d7dde5}
.payload-match-cell{display:grid;gap:6px;justify-items:center;align-content:start}.payload-evidence{width:100%;text-align:left;font-size:11px}.payload-evidence summary{cursor:pointer;color:#475467;font-weight:700;text-align:center}.payload-evidence pre{margin:6px 0 0;max-height:180px;font-size:11px;line-height:1.35;white-space:pre-wrap;overflow-wrap:anywhere}@media print{body{background:white}.card,.section,.toc{break-inside:avoid}}
${VALIDATION_TABLE_REPORT_CSS}
`;


function starTrackProductMatrixRowsHtml(audit, esc) {
  const selectedProducts = new Set([...(audit?.startrack?.freightParses || []).map(f => f.productCode), ...(audit?.startrack?.qrParses || []).map(q => q.productCode)].filter(Boolean));
  const selectedLabelCodes = new Set([...(audit?.startrack?.routingParses || []).map(r => r.labelCode), audit?.labelFacts?.labelCode].filter(Boolean));
  const showPayloadColumn = auditHasApiPayload(audit);
  return Object.entries(STARTRACK_PRODUCT_CODE_MAP).map(([code, meta]) => {
    const selected = selectedProducts.has(code) || selectedLabelCodes.has(meta.labelCode);
    const payloadStatus = selectedStarTrackProductPayloadStatus(audit, code, meta.labelCode);
    return `<tr class="${selected ? 'row-pass selected' : ''}"><td><strong>${esc(code)}</strong>${selectedProducts.has(code) ? ' <span class="pill">selected</span>' : ''}</td><td>${esc(meta.name)}</td><td>${esc(meta.group)}</td><td><strong>${esc(meta.labelCode)}</strong>${selectedLabelCodes.has(meta.labelCode) ? ' <span class="pill">selected</span>' : ''}</td>${showPayloadColumn ? `<td>${esc(payloadStatus || '')}</td>` : ''}</tr>`;
  }).join('');
}

function starTrackProductMatrixHtml(audit, esc) {
  const payloadHeader = auditHasApiPayload(audit) ? '<th>Get Shipments match</th>' : '';
  return `<h3>StarTrack product and label-code reference</h3><div class="table-wrap"><table class="startrack-matrix"><thead><tr><th>Product Code</th><th>Product Name</th><th>Group</th><th>Label Code</th>${payloadHeader}</tr></thead><tbody>${starTrackProductMatrixRowsHtml(audit, esc)}</tbody></table></div>`;
}

function buildStarTrackReportHtml(audit) {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const grouped = groupValidations(audit.validations || []);
  const qrItems = grouped['StarTrack QR barcode'] || [];
  const routingItems = grouped['StarTrack routing barcode'] || [];
  const atlItems = grouped['StarTrack ATL barcode'] || [];
  const freightItems = grouped['StarTrack freight item barcode'] || [];
  const serviceItems = grouped['StarTrack product/article data'] || [];
  const labelItems = grouped['label-layout'] || [];
  const textItems = grouped['address-format'] || [];
  const used = new Set(['StarTrack QR barcode', 'StarTrack routing barcode', 'StarTrack ATL barcode', 'StarTrack freight item barcode', 'StarTrack product/article data', 'label-layout', 'address-format']);
  const otherItems = Object.entries(grouped).filter(([key]) => !used.has(key)).flatMap(([, items]) => items);
  const reviewItems = (audit.validations || []).filter(v => v.status === 'manual_review' || v.status === 'warning' || v.status === 'fail');
  const h = auditDisplayHeader(audit, 0);
  const qrBarcodes = decodedBarcodeList(audit, 'qr');
  const routingBarcodes = starTrackRoutingBarcodeList(audit);
  const atlBarcodes = starTrackAtlBarcodeList(audit);
  const freightBarcodes = starTrackFreightBarcodeList(audit);
  const qrParses = audit?.startrack?.qrParses || [];
  const freightParses = audit?.startrack?.freightParses || [];
  const routingParses = audit?.startrack?.routingParses || [];
  const atlParses = audit?.startrack?.atlParses || [];
  const ssccs = audit?.startrack?.ssccParses || [];
  const navLinks = [
    ['full-label-image', 'Full label image'],
    ['datamatrix-section', 'StarTrack QR barcode'],
    ['routing-section', 'Routing barcode'],
    ['atl-section', 'ATL barcode'],
    ['freight-section', 'Freight item barcode'],
    ['service-article-section', 'Product and article data'],
    ['text-content-section', 'Visible label text']
  ].map(([id, label]) => `<a href="#${id}">${label}</a>`).join('');
  const reviewNav = reviewItems.length ? `<section class="toc"><h2 id="review-items">Review bookmarks</h2><ol>${reviewItems.map(v => `<li><a href="#rule-${esc(v.id)}">${esc(v.title)}</a> <span class="pill">${esc(v.status)}</span></li>`).join('')}</ol></section>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Australia Post - eCommerce Integration Label Auditor — StarTrack Report</title><style>${REPORT_CSS}</style></head><body><div class="wrap startrack-report">
<section class="hero hero-startrack"><h1>Australia Post - eCommerce Integration Label Auditor — StarTrack Label Report</h1><p><strong>Generated:</strong> ${esc(audit.generatedAt)} | <strong>File:</strong> ${esc(audit.fileInfo?.filename)}${audit.fileInfo?.sourcePdfPage ? ` — page ${esc(audit.fileInfo.sourcePdfPage)} of ${esc(audit.fileInfo.sourcePdfPageCount || '?')}` : ''}</p><p class="status ${esc(audit.summary.overallStatus)}">Overall: ${esc(audit.summary.overallStatus)}</p><div><span class="metric">Passed ${audit.summary.passed}</span><span class="metric">Failed ${audit.summary.failed}</span><span class="metric">Review ${audit.summary.manualReview}</span><span class="metric">Total ${audit.summary.total}</span></div><nav class="nav">${navLinks}</nav></section>
${reviewNav}
<section id="full-label-image" class="section"><h2><a href="#full-label-image">Full label image</a></h2><div class="two-col"><div>${audit.labelImages?.labelPreview ? `<img class="preview" src="${audit.labelImages.labelPreview}" alt="label preview">` : '<p>No label preview captured.</p>'}</div><div><h3>Visible label facts</h3><div class="facts"><div><strong>Freight Item / Article ID</strong><br>${esc((audit.labelFacts?.articleIds || []).join(', ') || h.articleNumber || 'not extracted')}</div><div><strong>Connote</strong><br>${esc((audit.labelFacts?.consignmentIds || []).join(', ') || 'not extracted')}</div><div><strong>Weight</strong><br>${esc(audit.labelFacts?.weightKg ? `${audit.labelFacts.weightKg}kg` : 'not extracted')}</div><div><strong>Carrier / label code</strong><br>${esc(audit.labelFacts?.labelCode || 'StarTrack')}</div></div>${renderReportValidationTable(labelItems, esc)}</div></div></section>
<section id="datamatrix-section" class="section"><h2><a href="#datamatrix-section">StarTrack 2D QR Barcode</a></h2>${audit.labelImages?.qrBarcodeCrop ? `<figure class="crop"><img src="${audit.labelImages.qrBarcodeCrop}" alt="StarTrack QR crop"><figcaption>${esc(imageBoxCaption(audit.labelImages, FORMAT_KIND.qr))}</figcaption></figure>` : '<p class="muted">No QR barcode crop captured.</p>'}<h3>Raw decoded QR string</h3><ul>${rawBarcodeListHtml(qrBarcodes, esc) || '<li>No StarTrack QR string decoded from this file.</li>'}</ul>${qrParses.length ? `<h3>QR fixed-width field breakdown</h3>${qrParses.map(q => `<div class="facts"><div><strong>Receiver suburb/postcode</strong><br>${esc(q.fields.receiverSuburb)} ${esc(q.fields.receiverPostcode)}</div><div><strong>Connote</strong><br><code>${esc(q.fields.connoteNumber)}</code></div><div><strong>Freight item</strong><br><code>${esc(q.fields.freightItemNumber)}</code></div><div><strong>Product</strong><br>${esc(q.productCode)} — ${esc(q.productName)}</div><div><strong>Quantity / weight</strong><br>${esc(q.fields.consignmentQuantity)} / ${esc(q.fields.consignmentWeight)}</div><div><strong>DG / movement</strong><br>${esc(q.fields.dangerousGoodsIndicator)} / ${esc(q.fields.movementTypeIndicator)}</div></div>`).join('')}` : ''}${renderReportValidationTable(qrItems, esc)}</section>
<section id="routing-section" class="section"><h2><a href="#routing-section">StarTrack Routing Barcode</a></h2>${audit.labelImages?.routingBarcodeCrop ? `<figure class="crop"><img src="${audit.labelImages.routingBarcodeCrop}" alt="StarTrack routing crop"><figcaption>${esc(imageBoxCaption(audit.labelImages, 'startrack-routing'))}</figcaption></figure>` : '<p class="muted">No routing barcode crop captured.</p>'}<h3>Raw decoded routing barcode string</h3><ul>${rawBarcodeListHtml(routingBarcodes, esc) || '<li>No StarTrack routing barcode string decoded from this file.</li>'}</ul>${routingParses.length ? `<h3>Routing barcode breakdown</h3>${routingParses.map(r => `<div class="facts"><div><strong>Routing format</strong><br>${esc(r.formatDescription)}</div><div><strong>Label code</strong><br>${esc(r.labelCode)}</div><div><strong>Postcode</strong><br>${esc(r.postcode)}</div><div><strong>Depot / port</strong><br>${esc(r.depotOrPort || 'not applicable')}</div></div>`).join('')}` : ''}${renderReportValidationTable(routingItems, esc)}</section>
<section id="freight-section" class="section"><h2><a href="#freight-section">StarTrack Freight Item Barcode</a></h2>${audit.labelImages?.freightBarcodeCrop ? `<figure class="crop"><img src="${audit.labelImages.freightBarcodeCrop}" alt="StarTrack freight item crop"><figcaption>${esc(imageBoxCaption(audit.labelImages, 'startrack-freight'))}</figcaption></figure>` : '<p class="muted">No freight item barcode crop captured.</p>'}<h3>Raw decoded freight item barcode string</h3><ul>${rawBarcodeListHtml(freightBarcodes, esc) || '<li>No StarTrack freight item / SSCC barcode string decoded from this file.</li>'}</ul>${freightParses.length ? `<h3>Freight item breakdown</h3>${freightParses.map(f => `<div class="facts"><div><strong>Freight item ID</strong><br><code>${esc(f.freightItemId)}</code></div><div><strong>Despatch ID</strong><br>${esc(f.despatchId)}</div><div><strong>Connote</strong><br>${esc(f.connoteNumber)}</div><div><strong>Product</strong><br>${esc(f.productCode)} — ${esc(f.productName)}</div><div><strong>Expected label code</strong><br>${esc(f.expectedLabelCode || '')}</div><div><strong>Item sequence</strong><br>${esc(f.itemNumber)}</div></div>`).join('')}` : ''}${ssccs.length ? `<h3>SSCC breakdown</h3>${ssccs.map(s => `<div class="facts"><div><strong>SSCC</strong><br><code>00${esc(s.sscc)}</code></div><div><strong>Extension digit</strong><br>${esc(s.extensionDigit)}</div><div><strong>Check digit</strong><br>${esc(s.checkDigit)}</div><div><strong>Expected check digit</strong><br>${esc(s.expectedCheckDigit)}</div></div>`).join('')}` : ''}${renderReportValidationTable(freightItems, esc)}</section>
<section id="service-article-section" class="section"><h2><a href="#service-article-section">StarTrack Product, Routing and Article Data</a></h2>${audit?.startrack?.ssccOnly ? '<p class="muted"><strong>StarTrack SSCC label detected.</strong> Product is not embedded in the SSCC article identifier; product context is assessed from QR/routing/manifest data when available.</p>' : ''}${renderReportValidationTable(serviceItems, esc)}${starTrackProductMatrixHtml(audit, esc)}</section>
<section id="text-content-section" class="section"><h2><a href="#text-content-section">Visible label text</a></h2><div class="facts"><div><strong>Receiver / To</strong><pre>${esc((audit.labelFacts?.toBlock || []).join('\n') || 'not extracted')}</pre></div><div><strong>Sender / From</strong><pre>${esc((audit.labelFacts?.fromBlock || []).join('\n') || 'not extracted')}</pre></div><div><strong>Dangerous Goods text</strong><pre>${esc((audit.labelFacts?.dgBlock || []).join('\n') || (audit.labelFacts?.dangerousGoodsDeclarationPresent ? 'Present' : 'not extracted'))}</pre></div><div><strong>Raw extracted text</strong><pre>${esc(audit.extractedText || '')}</pre></div></div>${renderReportValidationTable(textItems, esc)}${otherItems.length ? `<h3>Other checks</h3>${renderReportValidationTable(otherItems, esc)}` : ''}</section>
</div></body></html>`;
}


function serviceMatrixRowsHtml(audit, esc) {
  const selectedServices = selectedServiceCodes(audit);
  const selectedProducts = selectedProductCodes(audit);
  const showPayloadColumn = auditHasApiPayload(audit);
  return SERVICE_REFERENCE_ROWS.map(row => {
    const matchedService = selectedServices.includes(serviceRowMatchCode(row));
    return row.products.map(([productCode, productName], productIndex) => {
      const matchedProduct = selectedProducts.includes(productCode);
      const rowClass = `${matchedService ? 'selected service-selected-row' : ''} ${matchedService && matchedProduct ? 'selected-combination-row' : ''}`.trim();
      const payloadStatus = selectedEparcelServiceRowPayloadStatus(audit, row, productCode);
      const serviceCells = productIndex === 0 ? [
        `<td rowspan="${row.products.length}" class="service-code-cell"><strong>${esc(row.serviceCode)}</strong>${matchedService ? ' <span class="pill">selected</span>' : ''}</td>`,
        `<td rowspan="${row.products.length}" class="flag-cell">${esc(xMark(row.flags.safeDrop))}</td>`,
        `<td rowspan="${row.products.length}" class="flag-cell">${esc(xMark(row.flags.signature))}</td>`,
        `<td rowspan="${row.products.length}" class="flag-cell">${esc(xMark(row.flags.atl))}</td>`,
        `<td rowspan="${row.products.length}" class="flag-cell">${esc(xMark(row.flags.partial))}</td>`,
        `<td rowspan="${row.products.length}" class="flag-cell">${esc(xMark(row.flags.noSignature))}</td>`,
        `<td rowspan="${row.products.length}" class="payload-cell"><pre>${esc(servicePayloadText(row))}</pre></td>`
      ].join('') : '';
      return `<tr class="${rowClass}">${serviceCells}<td class="${matchedProduct ? 'product-selected-cell' : ''}"><strong>${esc(productCode)}</strong>${matchedProduct ? ' <span class="pill">selected</span>' : ''}</td><td class="${matchedProduct ? 'product-selected-cell' : ''}">${esc(productName)}</td>${showPayloadColumn ? `<td>${esc(payloadStatus || '')}</td>` : ''}</tr>`;
    }).join('');
  }).join('');
}

function textContentItemsToLines(items) {
  const entries = [];
  for (const item of items || []) {
    const str = String(item.str || '').trim();
    if (!str) continue;
    const tx = item.transform || [1, 0, 0, 1, 0, 0];
    entries.push({ text: str, x: tx[4] || 0, y: tx[5] || 0, height: Math.abs(tx[3] || item.height || 8) });
  }
  entries.sort((a, b) => b.y - a.y || a.x - b.x);

  const groups = [];
  const yTolerance = 3.5;
  for (const entry of entries) {
    let group = groups.find(g => Math.abs(g.y - entry.y) <= yTolerance);
    if (!group) {
      group = { y: entry.y, items: [] };
      groups.push(group);
    }
    group.items.push(entry);
  }

  groups.sort((a, b) => b.y - a.y);
  return groups.map(group => {
    group.items.sort((a, b) => a.x - b.x);
    const parts = [];
    let lastRight = null;
    for (const item of group.items) {
      if (lastRight !== null && item.x - lastRight > 18) parts.push('   ');
      parts.push(item.text);
      lastRight = item.x + item.text.length * 5;
    }
    return parts.join(' ').replace(/\s{4,}/g, '   ').trim();
  }).filter(Boolean);
}

async function scanTargetWithAllEngines(target, detector, pageNumber = 1) {
  const found = [];
  const categoryFormats = target.formats || ['Code128', 'DataMatrix'];
  const variants = selectScanVariants(target.canvas, target.kind);

  // Try the native detector first because it is cheap, then run the more expensive
  // ZXing passes that provide stronger coverage for production label files.
  if (detector) {
    const browserHits = await detectWithBrowserBarcodeDetector(target.canvas, detector, pageNumber, target.label);
    found.push(...browserHits.map(hit => mapBarcodeToPage(hit, target, 'original')));
    if (shouldStopTargetScan(target, found)) return found;
  }

  for (const variant of variants) {
    // ZXing-C++ WASM is the primary scanner for accuracy-sensitive barcode reads.
    const wasmHits = await wasmDecodeCanvas(
      variant.canvas,
      pageNumber,
      target.label,
      categoryFormats,
      target.kind,
      variant.label,
      variant.options || {}
    );
    found.push(...wasmHits.map(hit => mapBarcodeToPage(hit, target, variant.label)));
    if (shouldStopTargetScan(target, found)) return found;

    // The pure-JS reader is slower, so keep it as a fallback for variants where
    // the WASM reader did not return anything.
    if (!wasmHits.length) {
      const jsHits = zxingDecodeCanvas(
        variant.canvas,
        pageNumber,
        target.label,
        categoryFormats,
        target.kind,
        variant.label
      );
      found.push(...jsHits.map(hit => mapBarcodeToPage(hit, target, variant.label)));
      if (shouldStopTargetScan(target, found)) return found;
    }
  }

  // Linear barcode orientation is not consistent across every label template.
  // Rotated reads are expensive, so only try a small WASM pass when the normal
  // variants failed to decode the target.
  if (target.kind === FORMAT_KIND.linear && !found.length) {
    for (const variant of variants.slice(0, 2)) {
      for (const degrees of [90, 270]) {
        const rotated = rotateCanvas(variant.canvas, degrees);
        const rotWasmHits = await wasmDecodeCanvas(rotated, pageNumber, target.label, categoryFormats, target.kind, `${variant.label} rotated ${degrees}`, variant.options || {});
        found.push(...rotWasmHits.map(hit => mapBarcodeToPage(hit, target, `${variant.label} rotated ${degrees}`)));
        if (shouldStopTargetScan(target, found)) return found;
      }
    }
  }

  return found;
}

async function detectOnCanvas(canvas, detector, pageNumber = 1, onDebug = null, labelFamily = 'eparcel') {
  const found = [];
  const scanDiagnostics = [];
  const targets = buildCategorizedScanTargets(canvas, labelFamily);

  for (const target of targets) {
    if (target.kind === FORMAT_KIND.mixed && shouldSkipFullPageSafetyScan(found, labelFamily)) {
      const decodedCount = dedupeBarcodes(found).length;
      const skipped = {
        pageNumber,
        kind: target.kind,
        label: target.label,
        formats: target.formats,
        decodedCount: 0,
        width: target.canvas.width,
        height: target.canvas.height,
        decodedValues: [],
        durationMs: 0,
        skipped: true
      };
      scanDiagnostics.push(skipped);
      onDebug?.(`Skipped ${target.label}; targeted scans already found ${decodedCount} barcode candidate(s)`, 0);
      continue;
    }

    const scanStart = performance.now();
    const decoded = await scanTargetWithAllEngines(target, detector, pageNumber);
    const durationMs = performance.now() - scanStart;
    found.push(...decoded);
    scanDiagnostics.push({
      pageNumber,
      kind: target.kind,
      label: target.label,
      formats: target.formats,
      decodedCount: decoded.length,
      width: target.canvas.width,
      height: target.canvas.height,
      decodedValues: decoded.map(d => d.rawValue),
      decodedSources: decoded.map(d => ({
        source: d.source || 'Unknown detector',
        format: d.format || d.symbology || 'unknown format',
        variantLabel: d.variantLabel || '',
        rawValue: d.rawValue || ''
      })),
      durationMs
    });
    if (decoded.length || durationMs >= 1000) {
      onDebug?.(`Scan target "${target.label}" found ${decoded.length} candidate${decoded.length === 1 ? '' : 's'}: ${detectorResultSummary(decoded)}`, durationMs);
    }
    if (decoded.length && target.kind !== FORMAT_KIND.mixed) {
      console.info(`Decoded ${decoded.length} barcode(s) from ${target.label}`);
    }
  }

  const barcodes = dedupeBarcodes(found).map((b, index) => ({ ...b, index }));
  barcodes.scanDiagnostics = scanDiagnostics;
  return { barcodes, scanDiagnostics };
}

async function processImage(file, detector, onDebug = null, labelFamily = 'eparcel') {
  const fileStart = performance.now();
  const mark = (message, startedAt = fileStart) => onDebug?.(message, performance.now() - startedAt);
  const imgUrl = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = 'async';
  img.src = imgUrl;
  const decodeStart = performance.now();
  await img.decode();
  mark(`Decoded image ${file.name} (${img.naturalWidth}x${img.naturalHeight}px)`, decodeStart);

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const drawStart = performance.now();
  ctx.drawImage(img, 0, 0);
  mark('Rendered image to canvas', drawStart);
  await yieldToBrowser();
  const visualStart = performance.now();
  const visualEvidence = detectVisualBarcodeEvidence(canvas);
  mark('Checked visual barcode evidence', visualStart);
  await yieldToBrowser();
  const scanStart = performance.now();
  const scanResult = await detectOnCanvas(canvas, detector, 1, mark, labelFamily);
  const detected = scanResult.barcodes;
  mark(`Decoded barcode candidates (${detected.length})`, scanStart);
  await yieldToBrowser();
  const imageStart = performance.now();
  const labelImages = createLabelImages(canvas, detected);
  mark('Generated label preview and barcode crops', imageStart);
  URL.revokeObjectURL(imgUrl);
  mark(`Completed image ${file.name}`, fileStart);

  return {
    fileInfo: {
      filename: file.name,
      fileType: file.type || 'image',
      pageCount: 1,
      pixelWidth: img.naturalWidth,
      pixelHeight: img.naturalHeight,
      widthMm: null,
      heightMm: null,
      note: 'Raster images do not reliably expose physical DPI. A6 dimensions are assumed for layout heuristics.'
    },
    detectedBarcodes: detected,
    visualEvidence,
    labelImages,
    extractedText: ''
  };
}

async function processPdfLabels(file, detector, onDebug = null, labelFamily = 'eparcel') {
  const fileStart = performance.now();
  const mark = (message, startedAt = fileStart) => onDebug?.(message, performance.now() - startedAt);
  const bufferStart = performance.now();
  const data = new Uint8Array(await file.arrayBuffer());
  mark(`Loaded PDF bytes for ${file.name} (${Math.round(file.size / 1024)} KB)`, bufferStart);
  const documentStart = performance.now();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  mark(`Opened PDF document (${pdf.numPages} page${pdf.numPages === 1 ? '' : 's'})`, documentStart);
  const labels = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const pageStart = performance.now();
    mark(`Started page ${pageNumber} of ${pdf.numPages}`, pageStart);
    const getPageStart = performance.now();
    const page = await pdf.getPage(pageNumber);
    mark(`Loaded PDF page ${pageNumber}`, getPageStart);
    const viewport72 = page.getViewport({ scale: 1 });
    const pageMm = {
      widthMm: viewport72.width * 25.4 / 72,
      heightMm: viewport72.height * 25.4 / 72
    };

    const textStart = performance.now();
    const textContent = await page.getTextContent().catch(() => ({ items: [] }));
    const pageLines = textContentItemsToLines(textContent.items || []);
    mark(`Extracted text from page ${pageNumber} (${pageLines.length} line${pageLines.length === 1 ? '' : 's'})`, textStart);

    // PDF pages are rendered at high scale so small barcode modules survive rasterization.
    // Raising this improves decode odds but increases memory and CPU cost.
    const viewport = page.getViewport({ scale: 4.0 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const renderStart = performance.now();
    await page.render({ canvasContext: ctx, viewport }).promise;
    mark(`Rendered page ${pageNumber} to canvas (${canvas.width}x${canvas.height}px)`, renderStart);

    await yieldToBrowser();
    const visualStart = performance.now();
    const visualEvidence = detectVisualBarcodeEvidence(canvas);
    mark(`Checked visual barcode evidence on page ${pageNumber}`, visualStart);
    await yieldToBrowser();
    const scanStart = performance.now();
    const pageScan = await detectOnCanvas(canvas, detector, pageNumber, mark, labelFamily);
    const detected = dedupeBarcodes(pageScan.barcodes || []);
    mark(`Decoded page ${pageNumber} barcode candidates (${detected.length})`, scanStart);
    await yieldToBrowser();
    const imageStart = performance.now();
    const labelImages = createLabelImages(canvas, detected);
    mark(`Generated page ${pageNumber} label preview and barcode crops`, imageStart);

    labels.push({
      fileInfo: {
        filename: file.name,
        fileType: file.type || 'application/pdf',
        pageCount: 1,
        sourcePdfPage: pageNumber,
        sourcePdfPageCount: pdf.numPages,
        pageLabel: pdf.numPages > 1 ? `page ${pageNumber} of ${pdf.numPages}` : 'page 1',
        widthMm: pageMm.widthMm,
        heightMm: pageMm.heightMm,
        pixelWidth: canvas.width,
        pixelHeight: canvas.height,
        note: 'PDF page rendered locally in the browser and audited as an individual label.'
      },
      detectedBarcodes: detected,
      visualEvidence,
      labelImages,
      scanDiagnostics: pageScan.scanDiagnostics || [],
      extractedText: pageLines.join('\n')
    });
    mark(`Completed page ${pageNumber} of ${pdf.numPages}`, pageStart);
    await yieldToBrowser();
  }

  mark(`Completed PDF ${file.name}`, fileStart);
  return labels;
}

async function processPdf(file, detector, onDebug = null) {
  const labels = await processPdfLabels(file, detector, onDebug);
  return labels[0];
}

function renderReportValidationTable(items, esc) {
  if (!items || !items.length) return '<p class="muted">No checks in this section.</p>';
  const showPayloadColumn = hasApiPayloadComparison(items);
  const rows = items.map(v => `<tr class="${esc(validationTone(v))}" id="rule-${esc(v.id)}">
    <td>${validationCriteriaHtml(v, esc)}</td>
    <td>${labelMeasurementHtml(v, esc)}</td>
    ${showPayloadColumn ? `<td>${apiPayloadEvidenceHtml(v.apiPayloadMatch, esc)}</td>` : ''}
    <td>${validationStatusHtml(v, showPayloadColumn, esc)}</td>
  </tr>`).join('');
  return `<table class="validation-table ${showPayloadColumn ? 'has-payload-column' : ''}"><thead><tr><th>Assessment criteria</th><th>Label measurement</th>${showPayloadColumn ? '<th>Get Shipments measurement</th>' : ''}<th>Status</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function buildReportHtml(audit) {
  if (audit?.carrier === 'startrack') return buildStarTrackReportHtml(audit);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const grouped = groupValidations(audit.validations || []);
  const selectedServices = selectedServiceCodes(audit);
  const selectedProducts = selectedProductCodes(audit);
  const reviewItems = (audit.validations || []).filter(v => v.status === 'manual_review' || v.status === 'warning' || v.status === 'fail');

  const dataMatrixItems = grouped['DataMatrix barcode analysis'] || [];
  const linearItems = grouped['linear barcode analysis'] || [];
  const serviceItems = [...(grouped['service-code'] || []), ...(grouped['sscc'] || [])];
  const labelItems = grouped['label-layout'] || [];
  const textItems = grouped['address-format'] || [];
  const otherItems = Object.entries(grouped)
    .filter(([key]) => !['DataMatrix barcode analysis','linear barcode analysis','service-code','sscc','label-layout','address-format'].includes(key))
    .flatMap(([, items]) => items);

  const navLinks = [
    ['full-label-image', 'Full label image'],
    ['datamatrix-section', 'GS1 DataMatrix barcode'],
    ['linear-section', 'GS1-128 linear barcode'],
    ['service-article-section', 'Article and barcode data'],
    ['text-content-section', 'Visible label text']
  ].map(([id, label]) => `<a href="#${id}">${label}</a>`).join('');

  const serviceRows = serviceMatrixRowsHtml(audit, esc);
  const ssccOnly = auditHasSsccOnly(audit);
  const serviceMatrixHtml = ssccOnly
    ? '<div class="info-panel"><strong>SSCC label detected.</strong><p>Service/product matrix is not shown because SSCC barcodes encode AI 00 SSCC data, not eParcel product/service fields.</p></div>'
    : `<h3>Service code and product matrix</h3><div class="table-wrap service-matrix-wrap"><table class="service-matrix-table"><thead><tr><th>Service Code</th><th>Safe Drop</th><th>Signature on Delivery required</th><th>Authority To Leave (ATL)</th><th>Partial delivery allowed</th><th>No signature allowed</th><th>API payload / manifest flags</th><th>Product Code</th><th>Product Name</th>${auditHasApiPayload(audit) ? '<th>Get Shipments match</th>' : ''}</tr></thead><tbody>${serviceRows}</tbody></table></div>`;

  const dmBarcodes = decodedBarcodeList(audit, audit.carrier === 'startrack' ? 'qr' : 'datamatrix');
  const linearBarcodes = decodedBarcodeList(audit, 'linear');
  const dmParses = dmParseList(audit);
  const dmBarcodeHtml = rawBarcodeListHtml(dmBarcodes, esc);
  const linearBarcodeHtml = rawBarcodeListHtml(linearBarcodes, esc);
  const reviewNav = reviewItems.length ? `<section class="toc"><h2 id="review-items">Review bookmarks</h2><ol>${reviewItems.map(v => `<li><a href="#rule-${esc(v.id)}">${esc(v.title)}</a> <span class="pill">${esc(v.status)}</span></li>`).join('')}</ol></section>` : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Australia Post - eCommerce Integration Label Auditor Report</title>
<style>
body{font-family:Inter,Segoe UI,Arial,sans-serif;margin:18px;color:#17202a;background:#f6f7f9;font-size:13px;line-height:1.45}.wrap{max-width:1180px;margin:0 auto}.hero,.card,.section,.toc{background:white;border:1px solid #e3e8ef;border-radius:16px;margin:12px 0;padding:16px;box-shadow:0 6px 20px rgba(0,0,0,.035)}h1{margin:0;color:#c40018}h2{margin:0 0 12px}.status{font-size:24px;font-weight:900}.FAIL{color:#b00020}.PASS{color:#147a2e}.REVIEW{color:#9a5a00}.nav{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.nav a{background:#f0f4f8;border:1px solid #dce4ee;border-radius:999px;padding:7px 10px}table{border-collapse:collapse;width:100%;font-size:11.5px;table-layout:fixed}td,th{border:1px solid #dce2e8;padding:7px;vertical-align:top;text-align:left;overflow-wrap:anywhere}th{background:#f2f5f8}.row-fail{background:#fff0f2}.row-review{background:#fff8e6}.row-pass{background:#f1fbf4}.selected{background:#e8f3ff!important}.pill{display:inline-block;border-radius:99px;background:#e8f3ff;color:#124a7a;padding:2px 7px;font-size:10px;font-weight:800;text-transform:uppercase}.preview{max-width:460px;border:1px solid #ccd3dc;border-radius:10px}.crop img{max-width:420px;border:1px solid #ccd3dc;border-radius:10px;background:white}.facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.facts>div{background:#f8fafc;border:1px solid #e3e8ef;border-radius:12px;padding:9px}.two-col{display:grid;grid-template-columns:minmax(320px,.9fr) 1.1fr;gap:16px}.metric{display:inline-block;background:#f5f7fa;border:1px solid #e5e9ef;border-radius:12px;padding:8px 10px;margin:4px 5px 4px 0}.raw-code,code{font-family:ui-monospace,SFMono-Regular,Consolas,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere;word-break:normal;font-size:12px}pre{background:#f7f9fb;border:1px solid #e3e8ef;border-radius:10px;padding:10px;overflow:auto;max-height:280px;white-space:pre-wrap}.muted{color:#666}a{color:#0b5cad;text-decoration:none}a:hover{text-decoration:underline}@media(max-width:800px){.two-col,.facts{grid-template-columns:1fr}.preview{max-width:100%}}.service-matrix-wrap{overflow-x:auto;border-radius:12px;border:1px solid #111}.service-matrix-table{min-width:980px;border-collapse:collapse;table-layout:fixed;font-size:11px;background:#d9d9d9}.service-matrix-table th{background:#c40000;color:white;border:1px solid #111;text-align:center;vertical-align:middle;padding:7px 5px;font-weight:800}.service-matrix-table td{background:#d9d9d9;border:1px solid #111;color:#000;vertical-align:middle;padding:6px;overflow-wrap:anywhere}.service-matrix-table th:nth-child(1),.service-matrix-table td:nth-child(1){width:58px;text-align:center}.service-matrix-table th:nth-child(2),.service-matrix-table td:nth-child(2){width:55px;text-align:center}.service-matrix-table th:nth-child(3),.service-matrix-table td:nth-child(3){width:70px;text-align:center}.service-matrix-table th:nth-child(4),.service-matrix-table td:nth-child(4){width:70px;text-align:center}.service-matrix-table th:nth-child(5),.service-matrix-table td:nth-child(5){width:64px;text-align:center}.service-matrix-table th:nth-child(6),.service-matrix-table td:nth-child(6){width:92px;text-align:center}.service-matrix-table th:nth-child(7),.service-matrix-table td:nth-child(7){width:170px}.service-matrix-table th:nth-child(8),.service-matrix-table td:nth-child(8){width:74px;text-align:center}.service-matrix-table th:nth-child(9),.service-matrix-table td:nth-child(9){width:116px}.flag-cell{font-weight:900;font-size:14px;text-align:center}.payload-cell pre{margin:0;padding:0;border:0;background:transparent;font-size:10.5px;max-height:none;white-space:pre-wrap;overflow:visible}.service-selected-row td,.service-selected-row .payload-cell pre{background:#fff7c2!important}.selected-combination-row td,.product-selected-cell{background:#dff5e7!important}@media print{body{background:white}.card,.section,.toc{break-inside:avoid}}
${VALIDATION_TABLE_REPORT_CSS}
</style>
</head><body><div class="wrap">
<section class="hero"><h1>Australia Post - eCommerce Integration Label Auditor Report</h1><p><strong>Generated:</strong> ${esc(audit.generatedAt)} | <strong>File:</strong> ${esc(audit.fileInfo?.filename)}${audit.fileInfo?.sourcePdfPage ? ` — page ${esc(audit.fileInfo.sourcePdfPage)} of ${esc(audit.fileInfo.sourcePdfPageCount || '?')}` : ''}</p><p class="status ${esc(audit.summary.overallStatus)}">Overall: ${esc(audit.summary.overallStatus)}</p><div><span class="metric">Passed ${audit.summary.passed}</span><span class="metric">Failed ${audit.summary.failed}</span><span class="metric">Review ${audit.summary.manualReview}</span><span class="metric">Total ${audit.summary.total}</span></div><nav class="nav">${navLinks}</nav></section>
${reviewNav}
<section id="full-label-image" class="section"><h2><a href="#full-label-image">Full label image</a></h2><div class="two-col"><div>${audit.labelImages?.labelPreview ? `<img class="preview" src="${audit.labelImages.labelPreview}" alt="label preview">` : '<p>No label preview captured.</p>'}</div><div><h3>Visible label facts</h3><div class="facts"><div><strong>AP Article ID:</strong><br>${esc((audit.labelFacts?.articleIds || []).join(', ') || 'not extracted')}</div><div><strong>Con No:</strong><br>${esc((audit.labelFacts?.consignmentIds || []).join(', ') || 'not extracted')}</div><div><strong>Weight:</strong><br>${esc(audit.labelFacts?.weightKg ? `${audit.labelFacts.weightKg}kg` : 'not extracted')}</div><div><strong>Label type:</strong><br>${esc(audit.labelFacts?.labelType || 'not extracted')}</div></div>${renderReportValidationTable(labelItems, esc)}</div></div></section>
<section id="datamatrix-section" class="section"><h2><a href="#datamatrix-section">GS1 DataMatrix Barcode</a></h2>${audit.labelImages?.dataMatrixFocusedCrop || audit.labelImages?.dataMatrixCrop ? `<figure class="crop"><img src="${audit.labelImages.dataMatrixFocusedCrop || audit.labelImages.dataMatrixCrop}" alt="GS1 DataMatrix crop"><figcaption>${esc(imageBoxCaption(audit.labelImages, FORMAT_KIND.datamatrix))}</figcaption></figure>` : ''}<h3>Raw decoded DataMatrix string</h3><ul>${dmBarcodeHtml || '<li>No GS1 DataMatrix string decoded from the uploaded file.</li>'}</ul>${dmParses.length ? `<h3>DataMatrix AI breakdown</h3>${dmParses.map(dm => `<div class="facts"><div><strong>AI 01 GTIN</strong><br>${esc(dm.compact?.slice(2,16) || 'not parsed')}</div><div><strong>AI 91 article</strong><br><code>${esc(dm.article?.articleId || dm.base?.article?.articleId || 'not parsed')}</code></div><div><strong>AI 420 postcode</strong><br>${esc(dm.postcode || 'not present')}</div><div><strong>AI 92 DPID</strong><br>${esc(dm.dpid || 'not present / omitted')}</div><div><strong>AI 8008 date/time</strong><br>${esc(dm.dateTime || 'not present')}</div></div>`).join('')}` : ''}${renderReportValidationTable(dataMatrixItems, esc)}</section>
<section id="linear-section" class="section"><h2><a href="#linear-section">GS1-128 Linear Barcode</a></h2>${audit.labelImages?.linearBarcodeCrop || audit.labelImages?.rightLinearBarcodeCrop ? `<figure class="crop"><img src="${audit.labelImages.linearBarcodeCrop || audit.labelImages.rightLinearBarcodeCrop}" alt="GS1-128 crop"><figcaption>${esc(imageBoxCaption(audit.labelImages, FORMAT_KIND.linear))}</figcaption></figure>` : ''}<h3>Raw decoded linear barcode string</h3><ul>${linearBarcodeHtml || '<li>No Code128 / GS1-128 string decoded from the uploaded file.</li>'}</ul>${renderReportValidationTable(linearItems, esc)}</section>
<section id="service-article-section" class="section"><h2><a href="#service-article-section">Article and barcode data</a></h2>${(audit.articles || []).map(a => a.type === 'sscc' ? `<div class="facts"><div><strong>Barcode type</strong><br>SSCC / AI 00</div><div><strong>SSCC value</strong><br><code>${esc(a.sscc)}</code></div><div><strong>Product code</strong><br>Not encoded in SSCC</div><div><strong>Service code</strong><br>Not encoded in SSCC</div></div>` : `<div class="facts"><div><strong>Article ID</strong><br><code>${esc(a.articleId)}</code></div><div><strong>MLID</strong><br>${esc(a.mlid)}</div><div><strong>Consignment ID</strong><br>${esc(a.consignmentId)}</div><div><strong>Article count</strong><br>${esc(a.articleCount)}</div><div><strong>Product</strong><br>${esc(a.productCode)} — ${esc(a.productDescription)}</div><div><strong>Service</strong><br>${esc(a.serviceCode)} — ${esc(a.serviceDescription)}</div><div><strong>Postage paid</strong><br>${esc(a.postagePaidIndicator)}</div><div><strong>Check digit</strong><br>${esc(a.checkDigit)}</div></div>`).join('') || '<p>No article details parsed.</p>'}${renderReportValidationTable(serviceItems, esc)}${serviceMatrixHtml}</section>
<section id="text-content-section" class="section"><h2><a href="#text-content-section">Visible label text</a></h2><div class="facts"><div><strong>TO block</strong><pre>${esc((audit.labelFacts?.toBlock || []).join('\n') || 'not extracted')}</pre></div><div><strong>FROM/SENDER block</strong><pre>${esc((audit.labelFacts?.fromBlock || []).join('\n') || 'not extracted')}</pre></div><div><strong>DG declaration</strong><pre>${esc((audit.labelFacts?.dgBlock || []).join('\n') || (audit.labelFacts?.dangerousGoodsDeclarationPresent ? 'Present' : 'not extracted'))}</pre></div><div><strong>Extracted raw text</strong><pre>${esc(audit.extractedText || '')}</pre></div></div>${renderReportValidationTable(textItems, esc)}${otherItems.length ? `<h3>Other checks</h3>${renderReportValidationTable(otherItems, esc)}` : ''}</section>
</div></body></html>`;
}

function getPrimaryArticle(audit) {
  return (audit?.articles || []).find(a => a?.type === 'eparcel-standard') || (audit?.articles || [])[0] || null;
}

function productFamilyForArticle(article) {
  if (isSsccArticle(article)) return 'SSCC label';
  const desc = String(article?.productDescription || '').toLowerCase();
  if (desc.includes('express')) return 'Express Post';
  if (desc.includes('parcel')) return 'Parcel Post';
  return article?.productDescription || 'Product not parsed';
}

function serviceLabelForArticle(article) {
  if (!article?.serviceCode) return 'Service code not parsed';
  const name = SERVICE_CODE_MAP[article.serviceCode]?.name || article.serviceDescription || 'Unknown service code';
  return `${article.serviceCode} — ${name}`;
}

function auditDisplayHeader(audit, index = 0) {
  if (audit?.carrier === 'startrack') {
    const article = getPrimaryArticle(audit);
    const qr = (audit?.startrack?.qrParses || [])[0];
    const freight = (audit?.startrack?.freightParses || [])[0];
    const route = (audit?.startrack?.routingParses || [])[0];
    const sscc = (audit?.startrack?.ssccParses || [])[0];
    const productCode = freight?.productCode || qr?.productCode || '';
    const productMeta = productCode ? STARTRACK_PRODUCT_CODE_MAP[productCode] : null;
    const labelCode = route?.labelCode || productMeta?.labelCode || audit?.labelFacts?.labelCode || '';
    const articleNumber = freight?.freightItemId || article?.articleId || (sscc ? `00${sscc.sscc}` : '') || qr?.fields?.freightItemNumber || (audit?.labelFacts?.articleIds || [])[0] || `Label ${index + 1}`;
    const product = sscc && !productCode ? 'StarTrack SSCC label' : (productMeta?.name || freight?.productName || qr?.productName || 'StarTrack product not parsed');
    return {
      article,
      articleNumber,
      product,
      productCode,
      productName: productMeta?.name || freight?.productName || qr?.productName || '',
      serviceCode: labelCode || 'not parsed',
      serviceName: route?.formatDescription || (productMeta?.labelCode ? `Label code ${productMeta.labelCode}` : ''),
      isSsccOnly: Boolean(audit?.startrack?.ssccOnly),
      filename: audit?.fileInfo?.filename || `Label ${index + 1}`,
      pageLabel: audit?.fileInfo?.sourcePdfPage ? `Page ${audit.fileInfo.sourcePdfPage} of ${audit.fileInfo.sourcePdfPageCount || '?'}` : '',
      displayFile: `${audit?.fileInfo?.filename || `Label ${index + 1}`}${audit?.fileInfo?.sourcePdfPage ? ` — page ${audit.fileInfo.sourcePdfPage} of ${audit.fileInfo.sourcePdfPageCount || '?'}` : ''}`,
      tabText: `${articleNumber} · ${product} · ${labelCode || 'no routing'}`
    };
  }
  const article = getPrimaryArticle(audit);
  const ssccOnly = auditHasSsccOnly(audit);
  const articleNumber = article?.articleId || article?.sscc || (audit?.labelFacts?.articleIds || [])[0] || `Label ${index + 1}`;
  const product = ssccOnly ? 'SSCC label' : productFamilyForArticle(article);
  const serviceCode = ssccOnly ? 'Not applicable' : (article?.serviceCode || '');
  return {
    article,
    articleNumber,
    product,
    productCode: ssccOnly ? '' : (article?.productCode || ''),
    productName: ssccOnly ? 'SSCC label — product code not encoded' : (article?.productDescription || ''),
    serviceCode,
    serviceName: ssccOnly ? 'SSCC barcode does not encode eParcel service code' : (SERVICE_CODE_MAP[article?.serviceCode]?.name || article?.serviceDescription || ''),
    isSsccOnly: ssccOnly,
    filename: audit?.fileInfo?.filename || `Label ${index + 1}`,
    pageLabel: audit?.fileInfo?.sourcePdfPage ? `Page ${audit.fileInfo.sourcePdfPage} of ${audit.fileInfo.sourcePdfPageCount || '?'}` : '',
    displayFile: `${audit?.fileInfo?.filename || `Label ${index + 1}`}${audit?.fileInfo?.sourcePdfPage ? ` — page ${audit.fileInfo.sourcePdfPage} of ${audit.fileInfo.sourcePdfPageCount || '?'}` : ''}`,
    tabText: `${articleNumber} · ${product} · ${serviceCode || 'no service'}`
  };
}
function combinedAuditSummary(audits = []) {
  const totals = audits.reduce((acc, audit) => {
    acc.total += audit?.summary?.total || 0;
    acc.passed += audit?.summary?.passed || 0;
    acc.failed += audit?.summary?.failed || 0;
    acc.manualReview += audit?.summary?.manualReview || 0;
    acc.decoded += audit?.detectedBarcodes?.length || 0;
    if (audit?.summary?.overallStatus === 'FAIL') acc.hasFail = true;
    if (audit?.summary?.overallStatus === 'REVIEW') acc.hasReview = true;
    return acc;
  }, { total: 0, passed: 0, failed: 0, manualReview: 0, decoded: 0, hasFail: false, hasReview: false });
  totals.overallStatus = totals.hasFail ? 'FAIL' : totals.hasReview ? 'REVIEW' : 'PASS';
  totals.labelCount = audits.length;
  return totals;
}

function buildConsolidatedReportHtml(audits = []) {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const summary = combinedAuditSummary(audits);
  const navLinks = audits.map((audit, idx) => {
    const h = auditDisplayHeader(audit, idx);
    return `<a href="#label-${idx + 1}">${esc(h.articleNumber)} · ${esc(h.product)} · ${esc(h.serviceCode || 'no service')}</a>`;
  }).join('');

  const summaryRows = audits.map((audit, idx) => {
    const h = auditDisplayHeader(audit, idx);
    return `<tr class="row-${esc(String(audit.summary?.overallStatus || '').toLowerCase())}">
      <td>${idx + 1}</td>
      <td><a href="#label-${idx + 1}"><code>${esc(h.articleNumber)}</code></a></td>
      <td>${esc(h.product)}${h.productCode ? `<br><small>${esc(h.productCode)} — ${esc(h.productName)}</small>` : ''}</td>
      <td>${esc(h.serviceCode || 'not parsed')}${h.serviceName ? `<br><small>${esc(h.serviceName)}</small>` : ''}</td>
      <td>${esc(audit.detectedBarcodes?.length || 0)}</td>
      <td>${esc(h.displayFile || h.filename)}</td>
      <td><strong>${esc(audit.summary?.overallStatus || 'UNKNOWN')}</strong></td>
    </tr>`;
  }).join('');

  const labelSections = audits.map((audit, idx) => {
    const h = auditDisplayHeader(audit, idx);
    const grouped = groupValidations(audit.validations || []);
    const dataMatrixItems = audit.carrier === 'startrack' ? (grouped['StarTrack QR barcode'] || []) : (grouped['DataMatrix barcode analysis'] || []);
    const routingItems = grouped['StarTrack routing barcode'] || [];
    const atlItems = grouped['StarTrack ATL barcode'] || [];
    const freightItems = grouped['StarTrack freight item barcode'] || [];
    const linearItems = grouped['linear barcode analysis'] || [];
    const serviceItems = audit.carrier === 'startrack' ? (grouped['StarTrack product/article data'] || []) : ([...(grouped['service-code'] || []), ...(grouped['sscc'] || [])]);
    const labelItems = grouped['label-layout'] || [];
    const textItems = grouped['address-format'] || [];
    const usedSectionKeys = audit.carrier === 'startrack'
      ? ['StarTrack QR barcode','StarTrack routing barcode','StarTrack ATL barcode','StarTrack freight item barcode','StarTrack product/article data','label-layout','address-format']
      : ['DataMatrix barcode analysis','linear barcode analysis','service-code','sscc','label-layout','address-format'];
    const otherItems = Object.entries(grouped)
      .filter(([key]) => !usedSectionKeys.includes(key))
      .flatMap(([, items]) => items);
    const dmBarcodes = decodedBarcodeList(audit, audit.carrier === 'startrack' ? 'qr' : 'datamatrix');
    const linearBarcodes = decodedBarcodeList(audit, 'linear');
    const routingBarcodes = starTrackRoutingBarcodeList(audit);
    const atlBarcodes = starTrackAtlBarcodeList(audit);
    const freightBarcodes = starTrackFreightBarcodeList(audit);
    const serviceRows = serviceMatrixRowsHtml(audit, esc);
    const ssccOnly = auditHasSsccOnly(audit);
    const serviceMatrixHtml = ssccOnly
      ? '<p class="muted"><strong>SSCC label detected.</strong> eParcel product/service matrix is not applicable and has been intentionally omitted.</p>'
      : `<details><summary>Service code and product matrix</summary><div class="table-wrap service-matrix-wrap"><table class="service-matrix-table"><thead><tr><th>Service Code</th><th>Safe Drop</th><th>Signature on Delivery required</th><th>Authority To Leave (ATL)</th><th>Partial delivery allowed</th><th>No signature allowed</th><th>API payload / manifest flags</th><th>Product Code</th><th>Product Name</th>${auditHasApiPayload(audit) ? '<th>Get Shipments match</th>' : ''}</tr></thead><tbody>${serviceRows}</tbody></table></div></details>`;
    const barcodeSections = audit.carrier === 'startrack'
      ? `<h3>StarTrack 2D QR barcode</h3>${audit.labelImages?.qrBarcodeCrop ? `<figure class="crop"><img src="${audit.labelImages.qrBarcodeCrop}" alt="StarTrack QR crop"><figcaption>${esc(imageBoxCaption(audit.labelImages, FORMAT_KIND.qr))}</figcaption></figure>` : ''}<ul>${rawBarcodeListHtml(dmBarcodes, esc) || '<li>No StarTrack QR string decoded from this file.</li>'}</ul>${renderReportValidationTable(dataMatrixItems, esc)}
      <h3>StarTrack routing barcode</h3>${audit.labelImages?.routingBarcodeCrop ? `<figure class="crop"><img src="${audit.labelImages.routingBarcodeCrop}" alt="StarTrack routing crop"><figcaption>${esc(imageBoxCaption(audit.labelImages, 'startrack-routing'))}</figcaption></figure>` : ''}<ul>${rawBarcodeListHtml(routingBarcodes, esc) || '<li>No StarTrack routing barcode string decoded from this file.</li>'}</ul>${renderReportValidationTable(routingItems, esc)}
      <h3>StarTrack ATL barcode</h3>${audit.labelImages?.atlBarcodeCrop ? `<figure class="crop"><img src="${audit.labelImages.atlBarcodeCrop}" alt="StarTrack ATL crop"><figcaption>${esc(imageBoxCaption(audit.labelImages, 'startrack-atl'))}</figcaption></figure>` : ''}<ul>${rawBarcodeListHtml(atlBarcodes, esc) || '<li>No StarTrack ATL barcode string decoded from this file.</li>'}</ul>${renderReportValidationTable(atlItems, esc)}
      <h3>StarTrack freight item barcode</h3>${audit.labelImages?.freightBarcodeCrop ? `<figure class="crop"><img src="${audit.labelImages.freightBarcodeCrop}" alt="StarTrack freight item crop"><figcaption>${esc(imageBoxCaption(audit.labelImages, 'startrack-freight'))}</figcaption></figure>` : ''}<ul>${rawBarcodeListHtml(freightBarcodes, esc) || '<li>No StarTrack freight item / SSCC barcode string decoded from this file.</li>'}</ul>${renderReportValidationTable(freightItems, esc)}`
      : `<h3>GS1 DataMatrix barcode</h3>${audit.labelImages?.dataMatrixFocusedCrop || audit.labelImages?.dataMatrixCrop ? `<figure class="crop"><img src="${audit.labelImages.dataMatrixFocusedCrop || audit.labelImages.dataMatrixCrop}" alt="GS1 DataMatrix crop"><figcaption>${esc(imageBoxCaption(audit.labelImages, FORMAT_KIND.datamatrix))}</figcaption></figure>` : ''}<ul>${rawBarcodeListHtml(dmBarcodes, esc) || '<li>No GS1 DataMatrix string decoded from this file.</li>'}</ul>${renderReportValidationTable(dataMatrixItems, esc)}
      <h3>GS1-128 linear barcode</h3>${audit.labelImages?.linearBarcodeCrop || audit.labelImages?.rightLinearBarcodeCrop ? `<figure class="crop"><img src="${audit.labelImages.linearBarcodeCrop || audit.labelImages.rightLinearBarcodeCrop}" alt="GS1-128 crop"><figcaption>${esc(imageBoxCaption(audit.labelImages, FORMAT_KIND.linear))}</figcaption></figure>` : ''}<ul>${rawBarcodeListHtml(linearBarcodes, esc) || '<li>No GS1-128 linear barcode string decoded from this file.</li>'}</ul>${renderReportValidationTable(linearItems, esc)}`;
    return `<section id="label-${idx + 1}" class="section label-report-section">
      <h2>Article Number: <code>${esc(h.articleNumber)}</code> · Product: ${esc(h.product)} · Service Code: ${esc(h.serviceCode || 'not parsed')}</h2>
      <p><strong>File:</strong> ${esc(h.displayFile || h.filename)} | <strong>Status:</strong> <span class="status-inline ${esc(audit.summary?.overallStatus || '')}">${esc(audit.summary?.overallStatus || 'UNKNOWN')}</span></p>
      <div class="two-col"><div>${audit.labelImages?.labelPreview ? `<img class="preview" src="${audit.labelImages.labelPreview}" alt="label preview">` : '<p>No label preview captured.</p>'}</div><div><h3>Key label facts</h3><div class="facts"><div><strong>Article number</strong><br><code>${esc(h.articleNumber)}</code></div><div><strong>Product</strong><br>${esc(h.productCode ? `${h.productCode} — ${h.productName}` : h.product)}</div><div><strong>Service code</strong><br>${esc(h.serviceCode || 'not parsed')} ${h.serviceName ? `— ${esc(h.serviceName)}` : ''}</div><div><strong>Decoded barcodes</strong><br>${esc(audit.detectedBarcodes?.length || 0)}</div></div>${renderReportValidationTable(labelItems, esc)}</div></div>
      ${barcodeSections}
      <h3>Article and barcode data</h3>${(audit.articles || []).map(a => a.type === 'sscc' ? `<div class="facts"><div><strong>Barcode type</strong><br>SSCC / AI 00</div><div><strong>SSCC value</strong><br><code>${esc(a.sscc)}</code></div><div><strong>Product code</strong><br>Not encoded in SSCC</div><div><strong>Service code</strong><br>Not encoded in SSCC</div></div>` : `<div class="facts"><div><strong>Article ID</strong><br><code>${esc(a.articleId)}</code></div><div><strong>Product</strong><br>${esc(a.productCode)} — ${esc(a.productDescription)}</div><div><strong>Service code</strong><br>${esc(a.serviceCode)} — ${esc(SERVICE_CODE_MAP[a.serviceCode]?.name || a.serviceDescription)}</div><div><strong>Check digit</strong><br>${esc(a.checkDigit)}</div></div>`).join('') || '<p>No article details parsed from decoded barcode.</p>'}${renderReportValidationTable(serviceItems, esc)}
      ${serviceMatrixHtml}
      <h3>Visible label text</h3><div class="facts"><div><strong>Deliver to</strong><pre>${esc((audit.labelFacts?.toBlock || []).join('\n') || 'not extracted')}</pre></div><div><strong>Sender / From</strong><pre>${esc((audit.labelFacts?.fromBlock || []).join('\n') || 'not extracted')}</pre></div><div><strong>Dangerous Goods declaration</strong><pre>${esc((audit.labelFacts?.dgBlock || []).join('\n') || (audit.labelFacts?.dangerousGoodsDeclarationPresent ? 'Present' : 'not extracted'))}</pre></div><div><strong>Raw extracted text</strong><pre>${esc(audit.extractedText || '')}</pre></div></div>${renderReportValidationTable(textItems, esc)}${otherItems.length ? `<h3>Other checks</h3>${renderReportValidationTable(otherItems, esc)}` : ''}
    </section>`;
  }).join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>Consolidated Australia Post - eCommerce Integration Label Auditor Report</title><style>
body{font-family:Inter,Segoe UI,Arial,sans-serif;margin:18px;color:#17202a;background:#f6f7f9;font-size:13px;line-height:1.45}.wrap{max-width:1220px;margin:0 auto}.hero,.section,.toc{background:white;border:1px solid #e3e8ef;border-radius:16px;margin:12px 0;padding:16px;box-shadow:0 6px 20px rgba(0,0,0,.035)}h1{margin:0;color:#c40018}h2{margin:0 0 12px}.status{font-size:24px;font-weight:900}.status-inline{font-weight:900}.FAIL{color:#b00020}.PASS{color:#147a2e}.REVIEW{color:#9a5a00}.nav{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.nav a{background:#f0f4f8;border:1px solid #dce4ee;border-radius:999px;padding:7px 10px}table{border-collapse:collapse;width:100%;font-size:11.5px;table-layout:fixed}td,th{border:1px solid #dce2e8;padding:7px;vertical-align:top;text-align:left;overflow-wrap:anywhere}th{background:#f2f5f8}.row-fail{background:#fff0f2}.row-review{background:#fff8e6}.row-pass{background:#f1fbf4}.preview{max-width:460px;border:1px solid #ccd3dc;border-radius:10px}.crop img{max-width:420px;border:1px solid #ccd3dc;border-radius:10px;background:white}.facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.facts>div{background:#f8fafc;border:1px solid #e3e8ef;border-radius:12px;padding:9px}.two-col{display:grid;grid-template-columns:minmax(320px,.8fr) 1.2fr;gap:16px}.metric{display:inline-block;background:#f5f7fa;border:1px solid #e5e9ef;border-radius:12px;padding:8px 10px;margin:4px 5px 4px 0}.raw-code,code{font-family:ui-monospace,SFMono-Regular,Consolas,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere;word-break:normal;font-size:12px}pre{background:#f7f9fb;border:1px solid #e3e8ef;border-radius:10px;padding:10px;overflow:auto;max-height:280px;white-space:pre-wrap}.pill{display:inline-block;border-radius:99px;background:#e8f3ff;color:#124a7a;padding:2px 7px;font-size:10px;font-weight:800;text-transform:uppercase}.service-matrix-wrap{overflow-x:auto;border-radius:12px;border:1px solid #111}.service-matrix-table{min-width:980px;border-collapse:collapse;table-layout:fixed;font-size:11px;background:#d9d9d9}.service-matrix-table th{background:#c40000;color:white;border:1px solid #111;text-align:center;vertical-align:middle;padding:7px 5px;font-weight:800}.service-matrix-table td{background:#d9d9d9;border:1px solid #111;color:#000;vertical-align:middle;padding:6px;overflow-wrap:anywhere}.flag-cell{font-weight:900;font-size:14px;text-align:center}.payload-cell pre{margin:0;padding:0;border:0;background:transparent;font-size:10.5px;max-height:none;white-space:pre-wrap;overflow:visible}.service-selected-row td,.service-selected-row .payload-cell pre{background:#fff7c2!important}.selected-combination-row td,.product-selected-cell{background:#dff5e7!important}@media(max-width:800px){.two-col,.facts{grid-template-columns:1fr}.preview{max-width:100%}}
.service-matrix-table{min-width:1280px;font-size:11px;line-height:1.25}.service-matrix-table th,.service-matrix-table td{padding:7px 6px;vertical-align:middle}.service-matrix-table th{line-height:1.15;overflow-wrap:normal;word-break:normal}.service-matrix-table th:nth-child(1),.service-matrix-table td:nth-child(1){width:64px;text-align:center}.service-matrix-table th:nth-child(2),.service-matrix-table td:nth-child(2){width:58px;text-align:center}.service-matrix-table th:nth-child(3),.service-matrix-table td:nth-child(3){width:82px;text-align:center}.service-matrix-table th:nth-child(4),.service-matrix-table td:nth-child(4){width:76px;text-align:center}.service-matrix-table th:nth-child(5),.service-matrix-table td:nth-child(5){width:76px;text-align:center}.service-matrix-table th:nth-child(6),.service-matrix-table td:nth-child(6){width:88px;text-align:center}.service-matrix-table th:nth-child(7),.service-matrix-table td:nth-child(7){width:220px}.service-matrix-table th:nth-child(8),.service-matrix-table td:nth-child(8){width:82px;text-align:center}.service-matrix-table th:nth-child(9),.service-matrix-table td:nth-child(9){width:145px}.service-matrix-table th:nth-child(10),.service-matrix-table td:nth-child(10){width:145px;text-align:center}.flag-cell{font-size:14px;text-align:center;vertical-align:middle}.service-code-cell{vertical-align:middle;text-align:center}.payload-cell pre{font-size:10.5px;line-height:1.3}.payload-match{font-size:10px;letter-spacing:.02em;padding:3px 7px}.payload-match-na{background:#eef1f5;color:#53606d;border:1px solid #d7dde5}
@media print{body{background:white}.section,.hero,.toc{break-inside:avoid}}
${VALIDATION_TABLE_REPORT_CSS}
</style></head><body><div class="wrap"><section class="hero"><h1>Australia Post - eCommerce Integration Label Auditor — Consolidated Report</h1><p><strong>Generated:</strong> ${esc(new Date().toISOString())} | <strong>Labels audited:</strong> ${summary.labelCount}</p><p class="status ${esc(summary.overallStatus)}">Overall: ${esc(summary.overallStatus)}</p><div><span class="metric">Labels ${summary.labelCount}</span><span class="metric">Passed checks ${summary.passed}</span><span class="metric">Failed checks ${summary.failed}</span><span class="metric">Review checks ${summary.manualReview}</span><span class="metric">Decoded barcodes ${summary.decoded}</span></div><nav class="nav">${navLinks}</nav></section><section class="toc"><h2>Consolidated label summary</h2><table><thead><tr><th>#</th><th>Article Number</th><th>Product</th><th>Service Code</th><th>Decoded Barcodes</th><th>File</th><th>Status</th></tr></thead><tbody>${summaryRows}</tbody></table></section>${labelSections}</div></body></html>`;
}

function downloadHtmlReport(audit) {
  const html = buildReportHtml(audit);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeName = (audit.fileInfo?.filename || 'audit').replace(/[^a-z0-9_.-]/gi, '_');
  a.href = url;
  a.download = `${safeName}-ecommerce-integration-label-auditor-report.html`;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadConsolidatedHtmlReport(audits) {
  const html = buildConsolidatedReportHtml(audits);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `consolidated-ecommerce-integration-label-auditor-report.html`;
  a.click();
  URL.revokeObjectURL(url);
}

function StatusBadge({ status }) {
  return <span className={`badge badge-${String(status).toLowerCase()}`}>{status}</span>;
}

function SectionTitle({ id, children }) {
  return <h2 id={id}><a className="section-link" href={`#${id}`}>{children}</a></h2>;
}

function StandardLine({ children }) {
  return <p className="standard-line"><strong>Specification standard / example:</strong> {children}</p>;
}

function ReviewBookmarks({ audit }) {
  const reviewItems = (audit?.validations || []).filter(v => v.status === 'manual_review' || v.status === 'warning' || v.status === 'fail');
  if (!reviewItems.length) return null;
  return (
    <section className="card review-nav">
      <SectionTitle id="review-bookmarks">Review bookmarks</SectionTitle>
      <p className="muted small">Jump directly to the items that need review or failed assessment.</p>
      <ul>
        {reviewItems.map(v => (
          <li key={v.id}><a href={`#rule-${v.id}`}>{v.title}</a> <StatusBadge status={v.status} /></li>
        ))}
      </ul>
    </section>
  );
}

function ServiceCodeMatrix({ audit }) {
  const selectedServices = selectedServiceCodes(audit);
  const selectedProducts = selectedProductCodes(audit);
  const showPayloadColumn = auditHasApiPayload(audit);
  return (
    <section className="card compact-card service-matrix-card">
      <SectionTitle id="service-code-reference">Service code reference</SectionTitle>
      <p className="muted small">Australia Post service-code/product-code matrix. The service and product decoded from the label are highlighted.</p>
      <div className="table-wrap service-matrix-wrap">
        <table className="service-matrix-table">
          <thead>
            <tr>
              <th>Service Code</th>
              <th>Safe Drop</th>
              <th>Signature on Delivery required</th>
              <th>Authority To Leave (ATL)</th>
              <th>Partial delivery allowed</th>
              <th>No signature allowed</th>
              <th>API payload / manifest flags</th>
              <th>Product Code</th>
              <th>Product Name</th>
              {showPayloadColumn && <th>Get Shipments match</th>}
            </tr>
          </thead>
          <tbody>
            {SERVICE_REFERENCE_ROWS.map(row => {
              const matchedService = selectedServices.includes(serviceRowMatchCode(row));
              return row.products.map(([productCode, productName], productIndex) => {
                const matchedProduct = selectedProducts.includes(productCode);
                return (
                  <tr key={`${row.serviceCode}-${productCode}`} className={`${matchedService ? 'selected-row service-selected-row' : ''} ${matchedService && matchedProduct ? 'selected-combination-row' : ''}`}>
                    {productIndex === 0 && <td rowSpan={row.products.length} className="service-code-cell"><strong>{row.serviceCode}</strong>{matchedService && <span className="selected-pill">selected</span>}</td>}
                    {productIndex === 0 && <td rowSpan={row.products.length} className="flag-cell">{xMark(row.flags.safeDrop)}</td>}
                    {productIndex === 0 && <td rowSpan={row.products.length} className="flag-cell">{xMark(row.flags.signature)}</td>}
                    {productIndex === 0 && <td rowSpan={row.products.length} className="flag-cell">{xMark(row.flags.atl)}</td>}
                    {productIndex === 0 && <td rowSpan={row.products.length} className="flag-cell">{xMark(row.flags.partial)}</td>}
                    {productIndex === 0 && <td rowSpan={row.products.length} className="flag-cell">{xMark(row.flags.noSignature)}</td>}
                    {productIndex === 0 && <td rowSpan={row.products.length} className="payload-cell"><pre>{servicePayloadText(row)}</pre></td>}
                    <td className={matchedProduct ? 'product-selected-cell' : ''}><strong>{productCode}</strong>{matchedProduct && <span className="selected-pill">selected</span>}</td>
                    <td className={matchedProduct ? 'product-selected-cell' : ''}>{productName}</td>
                    {showPayloadColumn && <td><span className={`payload-match ${selectedEparcelServiceRowPayloadStatus(audit, row, productCode) === 'Match' ? 'payload-match-match' : selectedEparcelServiceRowPayloadStatus(audit, row, productCode) === 'Does not match' ? 'payload-match-mismatch' : 'payload-match-not_checked'}`}>{selectedEparcelServiceRowPayloadStatus(audit, row, productCode)}</span></td>}
                  </tr>
                );
              });
            })}
          </tbody>
        </table>
      </div>
      <StandardLine>Service code and product code must be a valid supported combination from the Australia Post eParcel service matrix. Example: service 09 supports product 00091 Parcel Post (Non-Signature) and 00087 Express Post (Non-Signature).</StandardLine>
    </section>
  );
}

function ProductCodeMatrix({ audit }) {
  const selected = selectedProductCodes(audit);
  return (
    <section className="card compact-card">
      <SectionTitle id="product-code-reference">Product code reference</SectionTitle>
      <div className="product-chip-row">
        {Object.entries(PRODUCT_CODE_MAP).map(([code, name]) => (
          <div key={code} className={`product-chip ${selected.includes(code) ? 'selected-chip' : ''}`}>
            <strong>{code}</strong><span>{name}</span>{selected.includes(code) && <em>selected</em>}
          </div>
        ))}
      </div>
      <StandardLine>Example: product 00091 means Parcel Post (Non-Signature).</StandardLine>
    </section>
  );
}

function LabelPreview({ audit }) {
  const images = audit?.labelImages || {};
  if (!images.labelPreview) return null;
  return (
    <section className="card compact-card">
      <SectionTitle id="label-image">Label image</SectionTitle>
      <div className="image-grid">
        <figure><img className="label-preview" src={images.labelPreview} alt="Full label preview"/><figcaption>Full label preview</figcaption></figure>
        {images.dataMatrixFocusedCrop && <figure><img className="crop-preview" src={images.dataMatrixFocusedCrop} alt="DataMatrix crop"/><figcaption>DataMatrix crop</figcaption></figure>}
        {images.linearBarcodeCrop && <figure><img className="crop-preview wide" src={images.linearBarcodeCrop} alt="Linear barcode crop"/><figcaption>Linear barcode crop</figcaption></figure>}
      </div>
    </section>
  );
}

function sectionItems(audit, displayCategory) {
  return (audit ? groupValidations(audit.validations || [])[displayCategory] : []) || [];
}

function getAuditSections(audit) {
  const grouped = audit ? groupValidations(audit.validations || []) : {};
  if (audit?.carrier === 'startrack') {
    const used = new Set(['StarTrack QR barcode', 'StarTrack routing barcode', 'StarTrack ATL barcode', 'StarTrack freight item barcode', 'StarTrack product/article data', 'label-layout', 'address-format']);
    return {
      label: grouped['label-layout'] || [],
      datamatrix: grouped['StarTrack QR barcode'] || [],
      routing: grouped['StarTrack routing barcode'] || [],
      atl: grouped['StarTrack ATL barcode'] || [],
      freight: grouped['StarTrack freight item barcode'] || [],
      linear: [...(grouped['StarTrack routing barcode'] || []), ...(grouped['StarTrack ATL barcode'] || []), ...(grouped['StarTrack freight item barcode'] || [])],
      service: grouped['StarTrack product/article data'] || [],
      text: grouped['address-format'] || [],
      other: Object.entries(grouped).filter(([key]) => !used.has(key)).flatMap(([, items]) => items)
    };
  }
  const used = new Set(['DataMatrix barcode analysis', 'linear barcode analysis', 'service-code', 'sscc', 'label-layout', 'address-format']);
  return {
    label: grouped['label-layout'] || [],
    datamatrix: grouped['DataMatrix barcode analysis'] || [],
    linear: grouped['linear barcode analysis'] || [],
    service: [...(grouped['service-code'] || []), ...(grouped['sscc'] || [])],
    text: grouped['address-format'] || [],
    other: Object.entries(grouped).filter(([key]) => !used.has(key)).flatMap(([, items]) => items)
  };
}

function sectionTone(items = []) {
  if (items.some(v => v.status === 'fail')) return 'fail';
  if (items.some(v => v.status === 'manual_review' || v.status === 'warning')) return 'review';
  if (items.some(v => v.status === 'pass')) return 'pass';
  return 'neutral';
}

function SectionStatus({ items }) {
  const tone = sectionTone(items);
  return <span className={`section-status section-status-${tone}`}>{tone === 'neutral' ? 'no checks' : tone}</span>;
}


function hasApiPayloadComparison(items = []) {
  return (items || []).some(v => v?.apiPayloadMatch);
}

function formatApiPayloadEvidence(match) {
  if (!match) return '';
  const lines = [];
  if (match.field) lines.push(`comparison_field: ${match.field}`);
  if (match.detail) lines.push(`comparison: ${match.detail}`);
  if (match.evidence) {
    lines.push('', 'json_payload_evidence:');
    lines.push(match.evidence);
  }
  return lines.join('\n').trim();
}

function ApiPayloadMatchBadge({ match }) {
  if (!match) return null;
  const status = match.status || 'na';
  const evidence = formatApiPayloadEvidence(match);
  return (
    <div className="payload-match-cell">
      <span className={`payload-match payload-match-${status}`}>{match.label || 'N/A'}</span>
      {evidence && (
        <details className="payload-evidence">
          <summary>JSON evidence</summary>
          <pre>{evidence}</pre>
        </details>
      )}
    </div>
  );
}

function apiPayloadMatchHtml(match, esc) {
  if (!match) return '';
  const status = match.status || 'na';
  const evidence = formatApiPayloadEvidence(match);
  return `<div class="payload-match-cell"><span class="payload-match payload-match-${esc(status)}">${esc(match.label || 'N/A')}</span>${evidence ? `<details class="payload-evidence"><summary>JSON evidence</summary><pre>${esc(evidence)}</pre></details>` : ''}</div>`;
}

function auditHasApiPayload(audit) {
  return Boolean(audit?.apiPayload?.provided);
}

function auditPayloadIdentityMismatch(audit) {
  return Boolean(audit?.apiPayload?.identityGateApplied && audit?.apiPayload?.identityMatchesLabel === false);
}

function selectedEparcelServiceRowPayloadStatus(audit, row, productCode) {
  if (!auditHasApiPayload(audit)) return null;
  if (auditPayloadIdentityMismatch(audit)) return 'N/A';
  const articles = audit?.articles || [];
  const selected = articles.some(a => a?.serviceCode === serviceRowMatchCode(row) && a?.productCode === productCode);
  if (!selected) return 'N/A';
  const checks = [];
  const payloadText = String(audit.apiPayload?.rawText || '').toUpperCase();
  if (payloadText) {
    checks.push(payloadText.includes(String(serviceRowMatchCode(row)).toUpperCase()));
    checks.push(payloadText.includes(String(productCode).toUpperCase()));
    for (const [key, value] of Object.entries(row.apiPayload || {})) {
      if (payloadText.includes(String(key).toUpperCase())) checks.push(payloadText.includes(String(value).toUpperCase()));
    }
  }
  return checks.length ? (checks.every(Boolean) ? 'Match' : 'Does not match') : 'N/A';
}

function selectedStarTrackProductPayloadStatus(audit, productCode, labelCode) {
  if (!auditHasApiPayload(audit)) return null;
  if (auditPayloadIdentityMismatch(audit)) return 'N/A';
  const text = String(audit.apiPayload?.rawText || '').toUpperCase();
  const selected = (audit?.startrack?.freightParses || []).some(f => f.productCode === productCode)
    || (audit?.startrack?.qrParses || []).some(q => q.productCode === productCode)
    || (audit?.startrack?.routingParses || []).some(r => r.labelCode === labelCode)
    || audit?.labelFacts?.labelCode === labelCode;
  if (!selected) return 'N/A';
  return text.includes(String(productCode).toUpperCase()) || text.includes(String(labelCode).toUpperCase()) ? 'Match' : 'Does not match';
}


function canonicalFieldLabel(v) {
  const field = v?.apiPayloadMatch?.field || '';
  if (!field) return null;
  return field;
}

function CriteriaCell({ validation }) {
  const canonical = canonicalFieldLabel(validation);
  const standard = standardForValidation(validation);
  const showSpecificExpected = validation.expected && validation.expected !== standard;
  return (
    <div className="criteria-cell">
      {canonical && <code className="canonical-field">{canonical}</code>}
      <strong>{validation.title}</strong>
      <span className="criteria-standard">{standard}</span>
      {showSpecificExpected && <span className="criteria-expected">Expected: {validation.expected}</span>}
    </div>
  );
}

function LabelMeasurementCell({ validation }) {
  return (
    <div className="measurement-cell">
      {validation.actual && <div><span className="measurement-label">Label value</span><code>{validation.actual}</code></div>}
      <div><span className="measurement-label">Finding</span>{validation.message}</div>
      {validation.evidence && (
        <details>
          <summary>Label evidence</summary>
          <pre>{validation.evidence}</pre>
        </details>
      )}
    </div>
  );
}

function ApiPayloadEvidenceCell({ match }) {
  if (!match) return <span className="muted small">No payload comparison.</span>;
  const evidence = formatApiPayloadEvidence(match);
  return (
    <div className="measurement-cell payload-measurement-cell">
      {match.field && <div><span className="measurement-label">Payload field</span><code>{match.field}</code></div>}
      {match.detail && <div><span className="measurement-label">Payload comparison</span>{match.detail}</div>}
      {evidence && (
        <details className="payload-evidence">
          <summary>JSON evidence</summary>
          <pre>{evidence}</pre>
        </details>
      )}
    </div>
  );
}

function ValidationStatusCell({ validation, showPayloadColumn }) {
  return (
    <div className="status-stack">
      <StatusBadge status={validation.status} />
      {showPayloadColumn && validation.apiPayloadMatch && (
        <div className="payload-status">
          <span>Payload</span>
          <ApiPayloadMatchBadge match={validation.apiPayloadMatch} />
        </div>
      )}
    </div>
  );
}

function validationCriteriaHtml(v, esc) {
  const canonical = canonicalFieldLabel(v);
  const standard = standardForValidation(v);
  const showSpecificExpected = v?.expected && v.expected !== standard;
  return `<div class="criteria-cell">${canonical ? `<code class="canonical-field">${esc(canonical)}</code>` : ''}<strong>${esc(v.title)}</strong><span class="criteria-standard">${esc(standard)}</span>${showSpecificExpected ? `<span class="criteria-expected">Expected: ${esc(v.expected)}</span>` : ''}</div>`;
}

function labelMeasurementHtml(v, esc) {
  return `<div class="measurement-cell">${v.actual ? `<div><span class="measurement-label">Label value</span><code>${esc(v.actual)}</code></div>` : ''}<div><span class="measurement-label">Finding</span>${esc(v.message)}</div>${v.evidence ? `<details><summary>Label evidence</summary><pre>${esc(v.evidence)}</pre></details>` : ''}</div>`;
}

function apiPayloadEvidenceHtml(match, esc) {
  if (!match) return '<span class="muted small">No payload comparison.</span>';
  const evidence = formatApiPayloadEvidence(match);
  return `<div class="measurement-cell payload-measurement-cell">${match.field ? `<div><span class="measurement-label">Payload field</span><code>${esc(match.field)}</code></div>` : ''}${match.detail ? `<div><span class="measurement-label">Payload comparison</span>${esc(match.detail)}</div>` : ''}${evidence ? `<details class="payload-evidence"><summary>JSON evidence</summary><pre>${esc(evidence)}</pre></details>` : ''}</div>`;
}

function validationStatusHtml(v, showPayloadColumn, esc) {
  return `<div class="status-stack"><span class="badge badge-${esc(String(v.status).toLowerCase())}">${esc(v.status)}</span>${showPayloadColumn && v.apiPayloadMatch ? `<div class="payload-status"><span>Payload</span>${apiPayloadMatchHtml(v.apiPayloadMatch, esc)}</div>` : ''}</div>`;
}

function ValidationTable({ items }) {
  if (!items || !items.length) return <p className="muted small">No validation checks in this section.</p>;
  const showPayloadColumn = hasApiPayloadComparison(items);
  return (
    <div className="table-wrap">
      <table className={`compact-table validation-table ${showPayloadColumn ? 'has-payload-column' : ''}`}>
        <thead><tr><th>Assessment criteria</th><th>Label measurement</th>{showPayloadColumn && <th>Get Shipments measurement</th>}<th>Status</th></tr></thead>
        <tbody>
          {items.map((v, idx) => (
            <tr key={idx} id={`rule-${v.id}`} className={validationTone(v)}>
              <td><CriteriaCell validation={v} /></td>
              <td><LabelMeasurementCell validation={v} /></td>
              {showPayloadColumn && <td><ApiPayloadEvidenceCell match={v.apiPayloadMatch} /></td>}
              <td><ValidationStatusCell validation={v} showPayloadColumn={showPayloadColumn} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditBookmarks({ audit, sections }) {
  const reviewItems = (audit?.validations || []).filter(v => v.status === 'manual_review' || v.status === 'warning' || v.status === 'fail');
  const nav = audit?.carrier === 'startrack' ? [
    ['full-label-image', 'Full label image', sections.label],
    ['datamatrix-section', 'StarTrack QR', sections.datamatrix],
    ['routing-section', 'Routing barcode', sections.routing],
    ['atl-section', 'ATL barcode', sections.atl],
    ['freight-section', 'Freight item barcode', sections.freight],
    ['service-article-section', 'Product and article data', sections.service],
    ['text-content-section', 'Visible label text', [...sections.text, ...sections.other]]
  ] : [
    ['full-label-image', 'Full label image', sections.label],
    ['datamatrix-section', 'GS1 DataMatrix', sections.datamatrix],
    ['linear-section', 'GS1-128 Linear', sections.linear],
    ['service-article-section', 'Article and barcode data', sections.service],
    ['text-content-section', 'Visible label text', [...sections.text, ...sections.other]]
  ];
  return (
    <section className="card nav-card">
      <div className="quick-nav">
        {nav.map(([id, label, items]) => <a key={id} href={`#${id}`}>{label} <SectionStatus items={items} /></a>)}
      </div>
      {reviewItems.length > 0 && (
        <div className="review-list">
          <h3 id="review-bookmarks">Review bookmarks</h3>
          <ul>
            {reviewItems.map(v => <li key={v.id}><a href={`#rule-${v.id}`}>{v.title}</a> <StatusBadge status={v.status} /></li>)}
          </ul>
        </div>
      )}
    </section>
  );
}

function ImageZoomModal({ image, onClose }) {
  useEffect(() => {
    if (!image) return undefined;
    const handleKeyDown = event => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [image, onClose]);

  if (!image) return null;
  return (
    <div className="image-zoom-overlay" role="dialog" aria-modal="true" aria-label={image.alt || 'Full label image'} onClick={onClose}>
      <button className="image-zoom-close" type="button" onClick={onClose} aria-label="Close full screen label image">Close</button>
      <div className="image-zoom-stage" onClick={event => event.stopPropagation()}>
        <img src={image.src} alt={image.alt || 'Full label image'} />
      </div>
    </div>
  );
}

function FullLabelImageSection({ audit, items, onZoomLabel }) {
  const facts = audit?.labelFacts || {};
  const images = audit?.labelImages || {};
  return (
    <section className="card audit-section" id="full-label-image">
      <div className="section-heading"><SectionTitle id="full-label-image-title">Full label image</SectionTitle><SectionStatus items={items} /></div>
      <div className="two-col label-layout-grid">
        <div>
          {images.labelPreview ? (
            <button
              className="label-preview-button"
              type="button"
              onClick={() => onZoomLabel?.({ src: images.labelPreview, alt: 'Full label preview' })}
              aria-label="Open full screen label image"
            >
              <img className="label-preview-large" src={images.labelPreview} alt="Full label preview" />
            </button>
          ) : <p className="muted">No label preview captured.</p>}
        </div>
        <div>
          <h3>Visible label facts</h3>
          <div className="fact-cards">
            <div><span>article_id</span><strong>{(facts.articleIds || []).join(', ') || 'Not extracted'}</strong></div>
            <div><span>consignment_id</span><strong>{(facts.consignmentIds || []).join(', ') || 'Not extracted'}</strong></div>
            <div><span>weight</span><strong>{facts.weightKg ? `${facts.weightKg}kg` : 'Not extracted'}</strong></div>
            <div><span>{audit?.carrier === 'startrack' ? 'label_code' : 'label_type'}</span><strong>{audit?.carrier === 'startrack' ? (facts.labelCode || 'StarTrack') : (facts.labelType || 'Not extracted')}</strong></div>
          </div>
          <ValidationTable items={items} />
        </div>
      </div>
    </section>
  );
}


function StarTrackQrSection({ audit, items, scanData }) {
  const images = audit?.labelImages || {};
  const qrDiagnostics = (scanData?.scanDiagnostics || []).filter(d => d.kind === 'qr' || d.kind === 'mixed');
  const qrBarcodes = decodedBarcodeList(audit, 'qr');
  const qrs = audit?.startrack?.qrParses || [];
  return (
    <section className="card audit-section startrack-section" id="datamatrix-section">
      <div className="section-heading"><SectionTitle id="datamatrix-section-title">StarTrack 2D QR Barcode</SectionTitle><SectionStatus items={items} /></div>
      <div className="two-col">
        <div>
          {images.qrBarcodeCrop ? <figure className="category-crop"><img src={images.qrBarcodeCrop} alt="StarTrack QR barcode crop" /><figcaption>{imageBoxCaption(images, FORMAT_KIND.qr)}</figcaption></figure> : <p className="muted">No QR barcode crop captured.</p>}
        </div>
        <div>
          <p className="muted">Checks the required StarTrack QR payload.</p>
          <StandardLine>StarTrack QR fields are fixed width and include receiver suburb/postcode, connote, freight item number, product code, quantity, weight, despatch date, unit type, destination depot, DG indicator and movement type.</StandardLine>
          <div className="decoded-panel"><h3>Raw decoded QR string</h3>{qrBarcodes.length ? <ul className="barcode-list decoded-list">{qrBarcodes.map((b, idx) => <li key={idx}><div className="barcode-meta"><strong>QR</strong> page {b.pageNumber || ''}</div><code className="raw-code raw-code-block">{b.rawValue}</code><div className="muted small">{b.pageBoundingBox ? 'Barcode location verified on this label.' : 'Barcode decoded; exact location not mapped.'}</div></li>)}</ul> : <p className="muted">No StarTrack QR value decoded from the uploaded file.</p>}</div>
          {qrs.length > 0 && qrs.map((qr, idx) => <div key={idx} className="fact-cards fact-cards-wide"><div><span>product_code</span><strong>{qr.productCode} — {qr.productName}</strong></div><div><span>consignment_id</span><strong>{qr.fields.connoteNumber}</strong></div><div><span>article_id</span><strong>{qr.fields.freightItemNumber}</strong></div><div><span>weight / cubic_volume</span><strong>{qr.fields.consignmentWeight || '-'}kg / {qr.fields.consignmentCube || '-'}</strong></div><div><span>dangerous_goods / movement_type</span><strong>{qr.fields.dangerousGoodsIndicator || '-'} / {qr.fields.movementTypeIndicator || '-'}</strong></div></div>)}
          <ValidationTable items={items} />
        </div>
      </div>
    </section>
  );
}


function StarTrackRoutingSection({ audit, items, scanData }) {
  const images = audit?.labelImages || {};
  const diagnostics = (scanData?.scanDiagnostics || []).filter(d => d.kind === 'linear' || d.kind === 'mixed');
  const routingBarcodes = starTrackRoutingBarcodeList(audit);
  const routes = audit?.startrack?.routingParses || [];
  return (
    <section className="card audit-section startrack-section" id="routing-section">
      <div className="section-heading"><SectionTitle id="routing-section-title">StarTrack Routing Barcode</SectionTitle><SectionStatus items={items} /></div>
      <div className="two-col">
        <div>
          {images.routingBarcodeCrop ? <figure className="category-crop wide"><img src={images.routingBarcodeCrop} alt="StarTrack routing barcode crop" /><figcaption>{imageBoxCaption(images, 'startrack-routing')}</figcaption></figure> : <p className="muted">No routing barcode crop captured.</p>}
        </div>
        <div>
          <h3>Decoded routing barcode values</h3>
          {routingBarcodes.length ? <ul className="barcode-list">{routingBarcodes.map((b, idx) => <li key={idx}><strong>Routing barcode</strong>: <code>{b.rawValue}</code><br/><span className="muted small">{b.pageBoundingBox ? 'Barcode location verified on this label.' : 'Barcode decoded; exact location not mapped.'}</span></li>)}</ul> : <p className="muted">No StarTrack routing barcode value decoded.</p>}
          {routes.length > 0 && <div className="fact-cards fact-cards-wide">{routes.map((route, idx) => <React.Fragment key={idx}><div><span>Label code</span><strong>{route.labelCode}</strong></div><div><span>Postcode</span><strong>{route.postcode}</strong></div><div><span>Depot / port</span><strong>{route.depotOrPort || 'Not applicable'}</strong></div><div><span>Format</span><strong>{route.formatDescription}</strong></div></React.Fragment>)}</div>}
          <StandardLine>StarTrack routing barcode is required separately from the freight item and ATL barcodes. Standard format is SSS9999DD/DDD: Premium and Fixed Price Premium labels commonly use a three-character depot/port suffix, while Express labels may use a two-character suffix. AU domestic SSCC labels may use GS1 421/403 routing.</StandardLine>
          <ValidationTable items={items} />
        </div>
      </div>
    </section>
  );
}

function StarTrackAtlSection({ audit, items, scanData }) {
  const images = audit?.labelImages || {};
  const atlBarcodes = starTrackAtlBarcodeList(audit);
  const atlParses = audit?.startrack?.atlParses || [];
  return (
    <section className="card audit-section startrack-section" id="atl-section">
      <div className="section-heading"><SectionTitle id="atl-section-title">StarTrack ATL Barcode</SectionTitle><SectionStatus items={items} /></div>
      <div className="two-col">
        <div>
          {images.atlBarcodeCrop ? <figure className="category-crop wide"><img src={images.atlBarcodeCrop} alt="StarTrack ATL barcode crop" /><figcaption>{imageBoxCaption(images, 'startrack-atl')}</figcaption></figure> : <p className="muted">No ATL barcode crop captured.</p>}
        </div>
        <div>
          <h3>Decoded ATL barcode values</h3>
          {atlBarcodes.length ? <ul className="barcode-list">{atlBarcodes.map((b, idx) => <li key={idx}><strong>ATL barcode</strong>: <code>{b.rawValue}</code><br/><span className="muted small">{b.pageBoundingBox ? 'Barcode location verified on this label.' : 'Barcode decoded; exact location not mapped.'}</span></li>)}</ul> : <p className="muted">No StarTrack ATL barcode value decoded.</p>}
          {atlParses.length > 0 && <div className="fact-cards fact-cards-wide">{atlParses.map((atl, idx) => <React.Fragment key={idx}><div><span>ATL number</span><strong>{atl.atlNumber}</strong></div><div><span>Counter</span><strong>{atl.counter}</strong></div><div><span>Format</span><strong>C999999999</strong></div><div><span>Orientation</span><strong>Picket Fence</strong></div></React.Fragment>)}</div>}
          <StandardLine>StarTrack ATL barcode content is C999999999. C is always the character C and the nine-digit sequential counter starts at 000000001. Preferred orientation is Picket Fence, minimum bar height 10mm, minimum barcode length 28mm, left/right quiet zone 5mm, and resolution 6 dots per mm.</StandardLine>
          <ValidationTable items={items} />
        </div>
      </div>
    </section>
  );
}

function StarTrackFreightItemSection({ audit, items, scanData }) {
  const images = audit?.labelImages || {};
  const diagnostics = (scanData?.scanDiagnostics || []).filter(d => d.kind === 'linear' || d.kind === 'mixed');
  const freightBarcodes = starTrackFreightBarcodeList(audit);
  const freightParses = audit?.startrack?.freightParses || [];
  const ssccs = audit?.startrack?.ssccParses || [];
  return (
    <section className="card audit-section startrack-section" id="freight-section">
      <div className="section-heading"><SectionTitle id="freight-section-title">StarTrack Freight Item Barcode</SectionTitle><SectionStatus items={items} /></div>
      <div className="two-col">
        <div>
          {images.freightBarcodeCrop ? <figure className="category-crop wide"><img src={images.freightBarcodeCrop} alt="StarTrack freight item barcode crop" /><figcaption>{imageBoxCaption(images, 'startrack-freight')}</figcaption></figure> : <p className="muted">No freight item barcode crop captured.</p>}
        </div>
        <div>
          <h3>Decoded freight item barcode values</h3>
          {freightBarcodes.length ? <ul className="barcode-list">{freightBarcodes.map((b, idx) => <li key={idx}><strong>Freight item barcode</strong>: <code>{b.rawValue}</code><br/><span className="muted small">{b.pageBoundingBox ? 'Barcode location verified on this label.' : 'Barcode decoded; exact location not mapped.'}</span></li>)}</ul> : <p className="muted">No StarTrack freight item / SSCC barcode value decoded.</p>}
          {freightParses.length > 0 && <div className="fact-cards fact-cards-wide">{freightParses.map((f, idx) => <React.Fragment key={idx}><div><span>article_id</span><strong>{f.freightItemId}</strong></div><div><span>consignment_id</span><strong>{f.connoteNumber}</strong></div><div><span>product_code</span><strong>{f.productCode} — {f.productName}</strong></div><div><span>item_sequence</span><strong>{f.itemNumber}</strong></div></React.Fragment>)}</div>}
          {ssccs.length > 0 && <div className="fact-cards fact-cards-wide">{ssccs.map((s, idx) => <React.Fragment key={idx}><div><span>SSCC</span><strong>00{s.sscc}</strong></div><div><span>Extension digit</span><strong>{s.extensionDigit}</strong></div><div><span>Check digit</span><strong>{s.checkDigit}</strong></div><div><span>Expected check digit</span><strong>{s.expectedCheckDigit}</strong></div></React.Fragment>)}</div>}
          <StandardLine>StarTrack freight item barcode is mandatory and is separate from the routing barcode. It is either 20-character Code128 XXXZ99999999AAA99999 or GS1 AI 00 SSCC.</StandardLine>
          <ValidationTable items={items} />
        </div>
      </div>
    </section>
  );
}

function DataMatrixSection({ audit, items, scanData }) {
  const images = audit?.labelImages || {};
  const dmDiagnostics = (scanData?.scanDiagnostics || []).filter(d => d.kind === 'datamatrix');
  const dataMatrixBarcodes = decodedBarcodeList(audit, 'datamatrix');
  const dmParses = dmParseList(audit);
  return (
    <section className="card audit-section" id="datamatrix-section">
      <div className="section-heading"><SectionTitle id="datamatrix-section-title">GS1 DataMatrix Barcode</SectionTitle><SectionStatus items={items} /></div>
      <div className="two-col">
        <div>
          {(images.dataMatrixFocusedCrop || images.dataMatrixCrop) ? <figure className="category-crop"><img src={images.dataMatrixFocusedCrop || images.dataMatrixCrop} alt="GS1 DataMatrix crop" /><figcaption>{imageBoxCaption(images, FORMAT_KIND.datamatrix)}</figcaption></figure> : <p className="muted">No GS1 DataMatrix crop captured.</p>}
        </div>
        <div>
          {auditHasSsccOnly(audit) ? (
            <StandardLine>SSCC labels use AI 00. eParcel AI 91/product/service evaluation is not applicable to an SSCC barcode.</StandardLine>
          ) : (
            <StandardLine>GS1 DataMatrix should include AI 01, AI 91, AI 420 postcode and AI 8008 date/time. AI 92 DPID is optional.</StandardLine>
          )}

          <div className="decoded-panel">
            <h3>Raw decoded GS1 DataMatrix string</h3>
            {dataMatrixBarcodes.length ? (
              <ul className="barcode-list decoded-list">
                {dataMatrixBarcodes.map((b, idx) => (
                  <li key={idx}>
                    <div className="barcode-meta"><strong>{b.format || b.symbology || 'DataMatrix'}</strong> page {b.pageNumber || ''}</div>
                    <code className="raw-code raw-code-block">{b.rawValue}</code>
                    <div className="muted small">{b.pageBoundingBox ? 'Barcode location verified on this label.' : 'Barcode decoded; exact location not mapped.'}</div>
                  </li>
                ))}
              </ul>
            ) : <p className="muted">No GS1 DataMatrix value decoded from the uploaded file.</p>}
          </div>

          {dmParses.length > 0 && (
            <div className="decoded-panel ai-panel">
              <h3>GS1 DataMatrix AI breakdown</h3>
              {dmParses.map((dm, idx) => (
                <div key={idx} className="fact-cards dm-ai-cards">
                  <div><span>AI 01 GTIN</span><strong>{dm.compact?.slice(2,16) || 'Not parsed'}</strong></div>
                  <div><span>AI 91 article</span><strong>{dm.article?.articleId || dm.base?.article?.articleId || 'Not parsed'}</strong></div>
                  <div><span>AI 420 postcode</span><strong>{dm.postcode || 'Not present'}</strong></div>
                  <div><span>AI 92 DPID</span><strong>{dm.dpid || 'Not present / omitted'}</strong></div>
                  <div><span>AI 8008 date/time</span><strong>{dm.dateTime || 'Not present'}</strong></div>
                </div>
              ))}
            </div>
          )}

          <ValidationTable items={items} />
        </div>
      </div>
    </section>
  );
}

function LinearBarcodeSection({ audit, items, scanData }) {
  const images = audit?.labelImages || {};
  const linearDiagnostics = (scanData?.scanDiagnostics || []).filter(d => d.kind === 'linear' || d.kind === 'mixed');
  const linearBarcodes = (audit?.detectedBarcodes || []).filter(b => String(b.format || '').toLowerCase().includes('128') || b.kind === 'linear');
  return (
    <section className="card audit-section" id="linear-section">
      <div className="section-heading"><SectionTitle id="linear-section-title">GS1-128 Linear Barcode</SectionTitle><SectionStatus items={items} /></div>
      <div className="two-col">
        <div>
          {(images.linearBarcodeCrop || images.rightLinearBarcodeCrop) ? <figure className="category-crop wide"><img src={images.linearBarcodeCrop || images.rightLinearBarcodeCrop} alt="Linear barcode crop" /><figcaption>{imageBoxCaption(images, FORMAT_KIND.linear)}</figcaption></figure> : <p className="muted">No linear barcode crop captured.</p>}
        </div>
        <div>
          <h3>Decoded linear barcode values</h3>
          {linearBarcodes.length ? <ul className="barcode-list">{linearBarcodes.map((b, idx) => <li key={idx}><strong>{barcodeDisplayName(b)}</strong>: <code>{b.rawValue}</code><br/><span className="muted small">{b.pageBoundingBox ? 'Barcode location verified on this label.' : 'Barcode decoded; exact location not mapped.'}</span></li>)}</ul> : <p className="muted">No Code128/GS1-128 value decoded.</p>}
          {auditHasSsccOnly(audit) ? (
            <StandardLine>SSCC linear barcodes use AI 00 and should decode to a valid SSCC value. eParcel product/service/check-digit fields are not encoded in the SSCC value.</StandardLine>
          ) : (
            <StandardLine>Linear GS1-128 should encode AI 01 + AusPost GTIN, AI 91 + article component, with a valid eParcel check digit.</StandardLine>
          )}
          <ValidationTable items={items} />
        </div>
      </div>
    </section>
  );
}


function StarTrackProductArticleSection({ audit, items }) {
  const st = audit?.startrack || {};
  const products = [...new Set([...(st.freightParses || []).map(f => f.productCode), ...(st.qrParses || []).map(q => q.productCode)].filter(Boolean))];
  const routes = st.routingParses || [];
  const ssccOnly = Boolean(st.ssccOnly);
  return (
    <section className="card audit-section startrack-section" id="service-article-section">
      <div className="section-heading"><SectionTitle id="service-article-section-title">StarTrack Product, Routing and Article Data</SectionTitle><SectionStatus items={items} /></div>
      {ssccOnly && <div className="info-panel sscc-panel"><strong>StarTrack SSCC label detected.</strong><p>Product code is not embedded in the SSCC article identifier. Product context is assessed from the QR payload, routing barcode or manifest data when available.</p></div>}
      <div className="fact-cards fact-cards-wide">
        <div><span>Freight item barcode(s)</span><strong>{(st.freightParses || []).map(f => f.freightItemId).join(', ') || 'Not decoded'}</strong></div>
        <div><span>SSCC value(s)</span><strong>{(st.ssccParses || []).map(s => `00${s.sscc}`).join(', ') || 'Not decoded'}</strong></div>
        <div><span>Product code(s)</span><strong>{products.length ? products.map(p => `${p} — ${STARTRACK_PRODUCT_CODE_MAP[p]?.name || 'Unknown'}`).join(', ') : (ssccOnly ? 'Not encoded in SSCC' : 'Not parsed')}</strong></div>
        <div><span>Routing code(s)</span><strong>{routes.length ? routes.map(r => `${r.labelCode}${r.postcode}${r.depotOrPort || ''}`).join(', ') : 'Not decoded'}</strong></div>
      </div>
      <StandardLine>Supported StarTrack products include EXP, PRM, FPP, ARL, FPA, RET, RE2, APT and TSE. Product-to-label-code relationships include EXP→EXP, PRM/FPP→PRM and ARL/FPA→ARL.</StandardLine>
      <ValidationTable items={items} />
      <details open className="reference-details"><summary>StarTrack product and label-code reference</summary><StarTrackProductMatrix audit={audit} /></details>
    </section>
  );
}

function StarTrackProductMatrix({ audit }) {
  const selectedProducts = new Set([...(audit?.startrack?.freightParses || []).map(f => f.productCode), ...(audit?.startrack?.qrParses || []).map(q => q.productCode)].filter(Boolean));
  const selectedLabelCodes = new Set([...(audit?.startrack?.routingParses || []).map(r => r.labelCode), audit?.labelFacts?.labelCode].filter(Boolean));
  const showPayloadColumn = auditHasApiPayload(audit);
  return <div className="table-wrap"><table className="compact-table startrack-matrix"><thead><tr><th>Product Code</th><th>Product Name</th><th>Group</th><th>Label Code</th>{showPayloadColumn && <th>Get Shipments match</th>}</tr></thead><tbody>{Object.entries(STARTRACK_PRODUCT_CODE_MAP).map(([code, meta]) => {
    const payloadStatus = selectedStarTrackProductPayloadStatus(audit, code, meta.labelCode);
    return <tr key={code} className={selectedProducts.has(code) || selectedLabelCodes.has(meta.labelCode) ? 'row-pass selected' : ''}><td><strong>{code}</strong>{selectedProducts.has(code) && <span className="pill">selected</span>}</td><td>{meta.name}</td><td>{meta.group}</td><td><strong>{meta.labelCode}</strong>{selectedLabelCodes.has(meta.labelCode) && <span className="pill">selected</span>}</td>{showPayloadColumn && <td><span className={`payload-match ${payloadStatus === 'Match' ? 'payload-match-match' : payloadStatus === 'Does not match' ? 'payload-match-mismatch' : 'payload-match-not_checked'}`}>{payloadStatus}</span></td>}</tr>;
  })}</tbody></table></div>;
}

function ServiceArticleBreakdownSection({ audit, items }) {
  if (audit?.carrier === 'startrack') return <StarTrackProductArticleSection audit={audit} items={items} />;
  const ssccOnly = auditHasSsccOnly(audit);
  return (
    <section className="card audit-section" id="service-article-section">
      <div className="section-heading"><SectionTitle id="service-article-section-title">Article and barcode data</SectionTitle><SectionStatus items={items} /></div>
      {ssccOnly && (
        <div className="info-panel sscc-panel">
          <strong>SSCC label detected.</strong>
          <p>Product code and service code are not evaluated for SSCC labels because SSCC barcodes encode AI 00 SSCC data, not the eParcel article product/service fields. The audit still reports barcode readability, sender/receiver blocks, weight, DG declaration and other visible label requirements where extractable.</p>
        </div>
      )}
      {audit.articles?.length > 0 ? audit.articles.map((a, idx) => (
        <div className="article-summary" key={idx}>
          {a.type === 'sscc' ? (
            <div className="fact-cards fact-cards-wide">
              <div><span>barcode_type</span><strong>SSCC / AI 00</strong></div>
              <div><span>article_id</span><strong><code>{a.sscc}</code></strong></div>
              <div><span>product_code</span><strong>Not encoded in SSCC</strong></div>
              <div><span>service_code</span><strong>Not encoded in SSCC</strong></div>
            </div>
          ) : (
            <div className="fact-cards fact-cards-wide">
              <div><span>article_id</span><strong><code>{a.articleId}</code></strong></div>
              <div><span>mlid</span><strong>{a.mlid}</strong></div>
              <div><span>consignment_id</span><strong>{a.consignmentId}</strong></div>
              <div><span>article_count</span><strong>{a.articleCount}</strong></div>
              <div><span>product_code</span><strong>{a.productCode} — {a.productDescription}</strong></div>
              <div><span>service_code</span><strong>{a.serviceCode} — {a.serviceDescription}</strong></div>
              <div><span>postage_paid_indicator</span><strong>{a.postagePaidIndicator}</strong></div>
              <div><span>check_digit</span><strong>{a.checkDigit}</strong></div>
            </div>
          )}
        </div>
      )) : <p className="muted">No article details parsed from a decoded barcode.</p>}
      {ssccOnly ? (
        <StandardLine>SSCC label = AI 00 + 18 digit serial shipping container code. eParcel product and service-code matrix checks are intentionally skipped.</StandardLine>
      ) : (
        <StandardLine>Standard article ID = MLID + 7 digit consignment suffix + article count + product code + service code + postage paid indicator + check digit.</StandardLine>
      )}
      <ValidationTable items={items} />
      {!ssccOnly && <details open className="reference-details"><summary>Service code and product matrix</summary><ServiceCodeMatrix audit={audit} /></details>}
    </section>
  );
}

function TextContentSection({ audit, items, otherItems }) {
  const facts = audit?.labelFacts || {};
  return (
    <section className="card audit-section" id="text-content-section">
      <div className="section-heading"><SectionTitle id="text-content-section-title">Visible label text</SectionTitle><SectionStatus items={[...items, ...otherItems]} /></div>
      <div className="facts facts-compact text-block-grid">
        <div><strong>TO block</strong><pre>{(facts.toBlock || []).join('\n') || 'Not extracted'}</pre><StandardLine>Address should end with uppercase suburb/state/postcode, e.g. CHULLORA NSW 2190.</StandardLine></div>
        <div><strong>FROM/SENDER block</strong><pre>{(facts.fromBlock || []).join('\n') || 'Not extracted'}</pre><StandardLine>Sender address should remain separate from the DG declaration, e.g. RICHMOND VIC 3121.</StandardLine></div>
        <div><strong>DG declaration</strong><pre>{(facts.dgBlock || []).join('\n') || (facts.dangerousGoodsDeclarationPresent ? 'Present' : 'Not extracted')}</pre><StandardLine>Aviation Security and Dangerous Goods Declaration should appear as its own declaration section.</StandardLine></div>
        <div><strong>Raw extracted text</strong><pre>{audit.extractedText || 'No raw text extracted.'}</pre></div>
      </div>
      <ValidationTable items={items} />
      {otherItems?.length > 0 && <><h3>Other checks</h3><ValidationTable items={otherItems} /></>}
    </section>
  );
}


function App() {
  // Optional Get Shipments payload pasted by the user. It is never sent anywhere; it is
  // parsed locally and compared only after the label identity appears to match.
  const [manifestJson, setManifestJson] = useState('');
  const [ssccCompanyPrefix, setSsccCompanyPrefix] = useState('');
  // Locks upload controls while the local render -> scan -> audit pipeline is active.
  const [processing, setProcessing] = useState(false);
  const [scanDebugLines, setScanDebugLines] = useState([]);
  // Short status/error text shown above the timing log and report.
  const [message, setMessage] = useState('');
  // Raw rendered label data is kept so payload comparison can be refreshed without
  // rescanning PDFs/images.
  const [scanDatas, setScanDatas] = useState([]);
  // Completed audit objects rendered by the report UI.
  const [audits, setAudits] = useState([]);
  // Index of the label currently selected in the tabbed report view.
  const [activeIndex, setActiveIndex] = useState(0);
  const [zoomImage, setZoomImage] = useState(null);

  const activeAudit = audits[activeIndex] || null;
  const activeScanData = scanDatas[activeIndex] || null;
  const batchSummary = useMemo(() => combinedAuditSummary(audits), [audits]);

  /** Filters browser-selected files to the PDF/image formats the scanner can render locally. */
  function normaliseSelectedFiles(selectedFiles) {
    return Array.from(selectedFiles || []).filter(file => {
      const name = String(file.name || '').toLowerCase();
      const type = String(file.type || '').toLowerCase();
      return type === 'application/pdf' || type.startsWith('image/') || /\.(pdf|png|jpe?g|webp|bmp)$/.test(name);
    });
  }

  /** Starts the full audit immediately after a user drops or chooses files. */
  async function acceptSelectedFiles(selectedFiles, labelFamily = 'eparcel') {
    const selected = normaliseSelectedFiles(selectedFiles);
    if (!selected.length) {
      setMessage('No supported PDF or image files were selected.');
      return;
    }
    await auditSelectedFiles(selected, labelFamily);
  }

  function appendScanDebug(message, durationMs = null) {
    const now = new Date();
    const time = now.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const duration = Number.isFinite(durationMs) ? ` +${formatDurationMs(durationMs)}` : '';
    setScanDebugLines(prev => [{
      text: `[${time}]${duration} ${message}`,
      durationMs: Number.isFinite(durationMs) ? durationMs : null
    }, ...prev].slice(0, 220));
  }

  const scanDebugText = scanDebugLines.map(line => line.text).join('\n');

  /** Main UI pipeline: render each file/page, decode barcodes, run carrier rules, then display results. */
  async function auditSelectedFiles(files, labelFamily = 'eparcel') {
    const batches = files.map(file => ({ file, labelFamily }));
    if (!batches.length) {
      setMessage('Choose or drop one or more PDF/image label files first.');
      return;
    }
    setProcessing(true);
    setScanDebugLines([]);
    setMessage('Preparing barcode scanner…');
    setAudits([]);
    setScanDatas([]);
    setActiveIndex(0);
    try {
      const auditStart = performance.now();
      appendScanDebug(`Started audit batch (${batches.length} file${batches.length === 1 ? '' : 's'})`);
      const scannerStart = performance.now();
      const detector = await createDetector();
      appendScanDebug(detector ? 'Native BarcodeDetector ready' : 'Native BarcodeDetector unavailable; using ZXing-WASM/JS scanning', performance.now() - scannerStart);
      if (!detector) {
        console.info('Native BarcodeDetector unavailable; using ZXing-C++ WASM crop scanning.');
      }

      const nextAudits = [];
      const nextScanDatas = [];
      for (let i = 0; i < batches.length; i += 1) {
        const { file: currentFile, labelFamily } = batches[i];
        const carrierLabel = labelFamilyName(labelFamily);
        const fileDebugPrefix = `${carrierLabel} file ${i + 1}/${batches.length}: ${currentFile.name}`;
        const fileTimer = performance.now();
        const fileDebug = (message, durationMs = null) => appendScanDebug(`${fileDebugPrefix} - ${message}`, durationMs);
        setMessage(`Scanning ${carrierLabel} file ${i + 1} of ${batches.length}: ${currentFile.name}`);
        const dataItems = currentFile.type === 'application/pdf' || currentFile.name.toLowerCase().endsWith('.pdf')
          ? await processPdfLabels(currentFile, detector, fileDebug, labelFamily)
          : [await processImage(currentFile, detector, fileDebug, labelFamily)];
        appendScanDebug(`${fileDebugPrefix} - finished render/scan phase`, performance.now() - fileTimer);

        for (let pageIndex = 0; pageIndex < dataItems.length; pageIndex += 1) {
          const data = { ...dataItems[pageIndex], labelFamily, fileInfo: { ...(dataItems[pageIndex].fileInfo || {}), labelFamily } };
          const itemLabel = data.fileInfo?.sourcePdfPage ? `page ${data.fileInfo.sourcePdfPage}` : 'image';
          setMessage(`Auditing ${currentFile.name} — ${itemLabel}`);
          const auditRuleStart = performance.now();
          const nextAudit = auditLabel({ ...data, manifestJson, ssccCompanyPrefix, labelFamily });
          appendScanDebug(`${fileDebugPrefix} - ran audit rules for ${itemLabel}`, performance.now() - auditRuleStart);
          nextAudit.labelImages = data.labelImages || {};
          nextAudit.extractedText = data.extractedText || '';
          nextAudit.scanDiagnostics = data.scanDiagnostics || [];
          nextAudit.batchIndex = nextAudits.length;
          nextAudit.sourceFileIndex = i;
          nextAudit.labelFamily = labelFamily;
          nextAudit.sourcePageIndex = pageIndex;
          nextAudits.push(nextAudit);
          nextScanDatas.push(data);
          setAudits([...nextAudits]);
          setScanDatas([...nextScanDatas]);
          setActiveIndex(nextAudits.length - 1);
          await yieldToBrowser();
        }
      }
      setActiveIndex(0);
      appendScanDebug('Completed audit batch', performance.now() - auditStart);
      setMessage('');
      setTimeout(() => document.getElementById('audit-result')?.scrollIntoView({ block: 'start' }), 0);
    } catch (error) {
      console.error(error);
      appendScanDebug(`Stopped with error: ${error.message || String(error)}`);
      setMessage(`Error: ${error.message || String(error)}`);
    } finally {
      setProcessing(false);
    }
  }

  /** Re-runs validation with current optional inputs without re-rendering or re-decoding labels. */
  function rerunAuditWithOptionalInputs() {
    if (!scanDatas.length) {
      setMessage('No scanned file data is available yet. Upload and audit one or more labels first.');
      return;
    }
    const refreshed = scanDatas.map((base, idx) => {
      const nextAudit = auditLabel({ ...base, manifestJson, ssccCompanyPrefix, labelFamily: base.labelFamily || base.fileInfo?.labelFamily || 'eparcel' });
      nextAudit.labelImages = base.labelImages || {};
      nextAudit.extractedText = base.extractedText || '';
      nextAudit.scanDiagnostics = base.scanDiagnostics || [];
      nextAudit.batchIndex = idx;
      return nextAudit;
    });
    setAudits(refreshed);
    setMessage('Optional payload and SSCC prefix checks refreshed for all uploaded labels.');
  }

  return (
    <main className="app">
      {/* The app is intentionally local-only: static assets and all label data stay in the browser session. */}
      <header className="hero hero-compact">
        <img className="ap-mark" src={australiaPostLogoUrl} alt="Australia Post" />
        <div>
          <h1>{APP_TITLE}</h1>
          <p>Upload a PDF or image in the correct carrier box. Review barcode, label text and payload checks after scanning.</p>
        </div>
        <a
          className="feedback-button"
          href="mailto:christian.rajaratnam@auspost.com.au?subject=Australia%20Post%20-%20eCommerce%20Integration%20Label%20Auditor%20Feedback"
        >
          Feedback
        </a>
      </header>

      <section className="card upload-card grid two upload-split">
        <div>
          <h2>eParcel upload</h2>
          <label
            className={`dropzone dropzone-eparcel ${processing ? 'dropzone-disabled' : ''}`}
            onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
            onDrop={e => { e.preventDefault(); if (!processing) acceptSelectedFiles(e.dataTransfer.files, 'eparcel'); }}
          >
            <input className="file-input-hidden" type="file" multiple accept={ACCEPTED_LABEL_FILE_TYPES} disabled={processing} onChange={e => { acceptSelectedFiles(e.target.files, 'eparcel'); e.target.value = ''; }} />
            <span className="dropzone-title">Drop eParcel Parcel Post / Express Post labels here</span>
            <span className="dropzone-subtitle">PDF, PNG, JPG, WebP or BMP</span>
          </label>
        </div>
        <div>
          <h2>StarTrack upload</h2>
          <label
            className={`dropzone dropzone-startrack ${processing ? 'dropzone-disabled' : ''}`}
            onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
            onDrop={e => { e.preventDefault(); if (!processing) acceptSelectedFiles(e.dataTransfer.files, 'startrack'); }}
          >
            <input className="file-input-hidden" type="file" multiple accept={ACCEPTED_LABEL_FILE_TYPES} disabled={processing} onChange={e => { acceptSelectedFiles(e.target.files, 'startrack'); e.target.value = ''; }} />
            <span className="dropzone-title">Drop StarTrack labels here</span>
            <span className="dropzone-subtitle">Light blue StarTrack audit path with QR, routing, freight item and SSCC checks</span>
          </label>
        </div>
        <div className="optional-input-grid">
          <section className="payload-input-panel" aria-labelledby="payload-input-title">
            <h2 id="payload-input-title">Get Shipments API payload comparison</h2>
            <p className="muted small">Optional: paste a Get Shipments response before upload, or apply it to the current report.</p>
            <textarea
              className="api-payload-textarea"
              rows="8"
              placeholder={`Paste Get Shipments payload here, for example:
{
  "shipments": [{
    "shipment_id": "...",
    "items": [{ "item_id": "..." }],
    "authority_to_leave": true,
    "allow_partial_delivery": true,
    "safe_drop_enabled": false
  }]
}`}
              value={manifestJson}
              onChange={e => setManifestJson(e.target.value)}
            />
          </section>
          <section className="sscc-prefix-panel" aria-labelledby="sscc-prefix-title">
            <h2 id="sscc-prefix-title">SSCC GS1 Company Prefix</h2>
            <p className="muted small">Optional. When supplied, eParcel and StarTrack labels are assessed as SSCC labels and the decoded AI 00 barcode must match this prefix.</p>
            <label className="field-label" htmlFor="sscc-company-prefix">Company prefix</label>
            <input
              id="sscc-company-prefix"
              className="sscc-prefix-input"
              type="text"
              inputMode="numeric"
              placeholder="(00) 3 93 15345"
              value={ssccCompanyPrefix}
              onChange={e => setSsccCompanyPrefix(e.target.value)}
            />
            <p className="muted small">Example: (00) 3 93 15345 000000070 0 uses company prefix 9315345. Enter the leading AI 00, extension digit and GS1 Company Prefix, for example (00) 3 93 15345, up to but not including the serial reference and check digit.</p>
          </section>
          {scanDatas.length > 0 && <button className="secondary optional-input-apply" onClick={rerunAuditWithOptionalInputs}>Apply optional checks to current results</button>}
        </div>
      </section>

      {processing && (
        <section className="scan-progress card" aria-live="polite">
          <div className="scan-progress-head">
            <div>
              <strong>Scanning labels</strong>
              <span>{message || 'Processing labels'}</span>
            </div>
          </div>
        </section>
      )}

      {!processing && message && <section className="message" aria-live="polite">{message}</section>}

      {audits.length > 0 && (
        <section className="results">
          <div className={`summary card compact-card consolidated-summary summary-${batchSummary.overallStatus.toLowerCase()}`}>
            <div>
              <SectionTitle id="audit-result">Audit result</SectionTitle>
              <p className={`overall overall-${batchSummary.overallStatus.toLowerCase()}`}>{batchSummary.overallStatus}</p>
            </div>
          </div>

          <section className="card compact-card label-tabs-card">
            <h2>Uploaded label results</h2>
            <div className="label-tabs" role="tablist" aria-label="Uploaded label audit results">
              {audits.map((item, idx) => {
                const h = auditDisplayHeader(item, idx);
                return (
                  <button
                    key={`${h.articleNumber}-${idx}`}
                    type="button"
                    role="tab"
                    aria-selected={idx === activeIndex}
                    className={`label-tab ${idx === activeIndex ? 'active' : ''}`}
                    onClick={() => setActiveIndex(idx)}
                  >
                    <span className="tab-index">{idx + 1}</span>
                    <span className="tab-main"><code>{h.articleNumber}</code></span>
                    <span className="tab-sub">{h.product} · Service {h.serviceCode || 'not parsed'}</span>
                    <StatusBadge status={item.summary?.overallStatus || 'UNKNOWN'} />
                  </button>
                );
              })}
            </div>
          </section>

          {activeAudit && (() => {
            const sections = getAuditSections(activeAudit);
            const h = auditDisplayHeader(activeAudit, activeIndex);
            return (
              <section className="single-audit-view" key={`${h.articleNumber}-${activeIndex}`}>
                <section className="card compact-card selected-label-header">
                  <h2>Article Number: <code>{h.articleNumber}</code></h2>
                  <div className="selected-label-meta">
                    <span><strong>Product:</strong> {h.productCode ? `${h.productCode} — ${h.productName}` : h.product}</span>
                    <span><strong>{activeAudit.carrier === 'startrack' ? 'Routing / service:' : 'Service Code:'}</strong> {h.serviceCode || 'not parsed'}{h.serviceName ? ` — ${h.serviceName}` : ''}</span>
                    <span><strong>File:</strong> {h.displayFile || h.filename}</span>
                  </div>
                </section>

                <AuditBookmarks audit={activeAudit} sections={sections} />
                <FullLabelImageSection audit={activeAudit} items={sections.label} onZoomLabel={setZoomImage} />
                {activeAudit.carrier === 'startrack' ? (
                  <>
                    <StarTrackQrSection audit={activeAudit} items={sections.datamatrix} scanData={activeScanData || activeAudit} />
                    <StarTrackRoutingSection audit={activeAudit} items={sections.routing} scanData={activeScanData || activeAudit} />
                    <StarTrackAtlSection audit={activeAudit} items={sections.atl} scanData={activeScanData || activeAudit} />
                    <StarTrackFreightItemSection audit={activeAudit} items={sections.freight} scanData={activeScanData || activeAudit} />
                  </>
                ) : (
                  <>
                    <DataMatrixSection audit={activeAudit} items={sections.datamatrix} scanData={activeScanData || activeAudit} />
                    <LinearBarcodeSection audit={activeAudit} items={sections.linear} scanData={activeScanData || activeAudit} />
                  </>
                )}
                <ServiceArticleBreakdownSection audit={activeAudit} items={sections.service} />
                {activeAudit.invalidArticleCandidates?.length > 0 && (
                  <section className="card audit-section" id="invalid-article-candidates">
                    <SectionTitle id="invalid-article-candidates-title">Invalid article candidate(s)</SectionTitle>
                    {activeAudit.invalidArticleCandidates.map((item, idx) => <p key={idx}><code>{item.candidate}</code> — {item.reason}</p>)}
                  </section>
                )}
                <TextContentSection audit={activeAudit} items={sections.text} otherItems={sections.other} />
              </section>
            );
          })()}
        </section>
      )}

      {scanDebugLines.length > 0 && (
        <section className="card scan-debug-card">
          <details open={processing}>
            <summary>
              Debug timing log
            </summary>
            <label className="scan-debug-label" htmlFor="scan-debug-log">Full timing log</label>
            <textarea
              id="scan-debug-log"
              className="scan-debug-log"
              rows="8"
              readOnly
              value={scanDebugText}
              placeholder="Timing events will appear here while files are processed."
            />
          </details>
        </section>
      )}
      <ImageZoomModal image={zoomImage} onClose={() => setZoomImage(null)} />
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);

