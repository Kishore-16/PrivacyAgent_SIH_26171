/**
 * Node.js OCR worker using tesseract.js (no system Tesseract binary needed).
 * 
 * Usage:  node ocr_worker.js <base64_image_file> [--psm <mode>]
 * 
 * Reads a base64-encoded PNG image from the specified file,
 * runs Tesseract OCR via tesseract.js (WASM), and outputs
 * JSON results to stdout with word-level bounding boxes.
 */

const { createWorker } = require('tesseract.js');
const fs = require('fs');
const path = require('path');

async function runOCR(imageInput, psm = '6') {
  const worker = await createWorker('eng', 1, {
    // Use local cache to avoid re-downloading traineddata
    cachePath: path.join(__dirname, '.tesseract-cache'),
  });

  await worker.setParameters({
    tessedit_pageseg_mode: psm,
  });

  // imageInput can be a file path to a temp file containing base64, or raw base64
  let imageData;
  if (fs.existsSync(imageInput)) {
    const content = fs.readFileSync(imageInput, 'utf-8').trim();
    // If it has a data URI prefix, use as-is; otherwise treat as raw base64
    if (content.startsWith('data:')) {
      imageData = content;
    } else {
      imageData = Buffer.from(content, 'base64');
    }
  } else {
    // Treat as raw base64 string
    imageData = Buffer.from(imageInput, 'base64');
  }

  const { data } = await worker.recognize(imageData);

  // Build word-level output compatible with pytesseract's image_to_data format
  const results = {
    text: [],
    conf: [],
    left: [],
    top: [],
    width: [],
    height: [],
  };

  for (const word of data.words || []) {
    results.text.push(word.text);
    results.conf.push(Math.round(word.confidence));
    results.left.push(word.bbox.x0);
    results.top.push(word.bbox.y0);
    results.width.push(word.bbox.x1 - word.bbox.x0);
    results.height.push(word.bbox.y1 - word.bbox.y0);
  }

  await worker.terminate();

  // Output JSON to stdout
  process.stdout.write(JSON.stringify(results));
}

// Parse arguments
const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('Usage: node ocr_worker.js <image_file> [--psm <mode>]');
  process.exit(1);
}

const imageFile = args[0];
let psm = '6';
const psmIdx = args.indexOf('--psm');
if (psmIdx !== -1 && args[psmIdx + 1]) {
  psm = args[psmIdx + 1];
}

runOCR(imageFile, psm).catch(err => {
  console.error('OCR Error:', err.message);
  process.exit(1);
});
