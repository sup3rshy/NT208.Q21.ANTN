/**
 * SocialShield Image Analyzer
 *
 * 4 chức năng:
 *   1. extractEXIF(blob)       — bóc EXIF GPS + camera info từ JPEG (no deps)
 *   2. detectBankQR(canvas)    — quét QR + decode VietQR EMV format (cần jsQR)
 *   3. detectVNIDCard(img)     — heuristic phát hiện ảnh CCCD/CMND VN dựa
 *                                aspect ratio + dominant color (no deps)
 *   4. runOCR(blob, langs)     — OCR text từ ảnh, lazy-load Tesseract.js
 *                                từ CDN (chỉ load khi user trigger)
 *
 * Tất cả chạy 100% client-side, không gửi ảnh đi đâu.
 */

const SocialShieldImageAnalyzer = {

  // ==================== 1. EXIF Parser (minimal, no deps) ====================

  /**
   * Bóc EXIF từ JPEG blob. Trả về { gps, camera, dateTime, ... } hoặc null.
   * Hỗ trợ: GPS lat/lng, Make/Model camera, DateTimeOriginal, Orientation.
   * Không phụ thuộc thư viện ngoài (~150 dòng).
   *
   * @param {Blob|ArrayBuffer} input
   * @returns {Promise<Object|null>}
   */
  async extractEXIF(input) {
    let buffer;
    if (input instanceof Blob) buffer = await input.arrayBuffer();
    else if (input instanceof ArrayBuffer) buffer = input;
    else return null;

    const view = new DataView(buffer);

    // Magic JPEG: 0xFFD8
    if (view.getUint16(0, false) !== 0xFFD8) return null;

    let offset = 2;
    const length = view.byteLength;

    // Tìm APP1 marker (0xFFE1) chứa "Exif\0\0"
    while (offset < length) {
      if (view.getUint8(offset) !== 0xFF) return null;
      const marker = view.getUint8(offset + 1);
      offset += 2;

      if (marker === 0xE1) {
        const segLength = view.getUint16(offset, false);
        // Kiểm tra "Exif\0\0"
        if (view.getUint32(offset + 2, false) !== 0x45786966) {
          offset += segLength;
          continue;
        }
        // TIFF header bắt đầu sau "Exif\0\0" (6 bytes)
        const tiffOffset = offset + 8;
        return this._parseTIFF(view, tiffOffset);
      } else {
        // Skip segment
        const segLength = view.getUint16(offset, false);
        offset += segLength;
      }
    }
    return null;
  },

  _parseTIFF(view, tiffStart) {
    // Byte order: 0x4949 = little-endian, 0x4D4D = big-endian
    const byteOrder = view.getUint16(tiffStart, false);
    const littleEndian = byteOrder === 0x4949;
    if (byteOrder !== 0x4949 && byteOrder !== 0x4D4D) return null;

    // Magic 0x002A
    if (view.getUint16(tiffStart + 2, !littleEndian) !== 0x002A) return null;

    const ifd0Offset = view.getUint32(tiffStart + 4, !littleEndian);
    const result = this._readIFD(view, tiffStart, tiffStart + ifd0Offset, !littleEndian);

    return result;
  },

  _readIFD(view, tiffStart, ifdOffset, bigEndian) {
    const out = {};
    const numEntries = view.getUint16(ifdOffset, !bigEndian);

    let exifIfdOffset = null;
    let gpsIfdOffset = null;

    for (let i = 0; i < numEntries; i++) {
      const entryOffset = ifdOffset + 2 + i * 12;
      const tag = view.getUint16(entryOffset, !bigEndian);
      const type = view.getUint16(entryOffset + 2, !bigEndian);
      const count = view.getUint32(entryOffset + 4, !bigEndian);
      const valueOffset = entryOffset + 8;

      // Standard tags
      if (tag === 0x010F) out.make = this._readASCII(view, tiffStart, valueOffset, count, bigEndian);
      else if (tag === 0x0110) out.model = this._readASCII(view, tiffStart, valueOffset, count, bigEndian);
      else if (tag === 0x0112) out.orientation = view.getUint16(valueOffset, !bigEndian);
      else if (tag === 0x0132) out.dateTime = this._readASCII(view, tiffStart, valueOffset, count, bigEndian);
      else if (tag === 0x9003) out.dateTimeOriginal = this._readASCII(view, tiffStart, valueOffset, count, bigEndian);
      else if (tag === 0x9004) out.dateTimeDigitized = this._readASCII(view, tiffStart, valueOffset, count, bigEndian);
      else if (tag === 0x8769) exifIfdOffset = view.getUint32(valueOffset, !bigEndian);
      else if (tag === 0x8825) gpsIfdOffset = view.getUint32(valueOffset, !bigEndian);
    }

    if (gpsIfdOffset) {
      out.gps = this._readGPSIFD(view, tiffStart, tiffStart + gpsIfdOffset, bigEndian);
    }

    if (exifIfdOffset) {
      // ExifIFD có thêm software, lens info... — bỏ qua để gọn
      // Có thể mở rộng sau.
    }

    return out;
  },

  _readGPSIFD(view, tiffStart, ifdOffset, bigEndian) {
    const gps = {};
    const numEntries = view.getUint16(ifdOffset, !bigEndian);

    for (let i = 0; i < numEntries; i++) {
      const e = ifdOffset + 2 + i * 12;
      const tag = view.getUint16(e, !bigEndian);
      const type = view.getUint16(e + 2, !bigEndian);
      const count = view.getUint32(e + 4, !bigEndian);
      const v = e + 8;

      if (tag === 0x0001) gps.latRef = String.fromCharCode(view.getUint8(v));
      else if (tag === 0x0002) gps.lat = this._readGPSCoord(view, tiffStart, v, count, bigEndian);
      else if (tag === 0x0003) gps.lngRef = String.fromCharCode(view.getUint8(v));
      else if (tag === 0x0004) gps.lng = this._readGPSCoord(view, tiffStart, v, count, bigEndian);
      else if (tag === 0x0005) gps.altRef = view.getUint8(v);
      else if (tag === 0x0006) gps.altitude = this._readRational(view, tiffStart, v, bigEndian);
      else if (tag === 0x001D) gps.dateStamp = this._readASCII(view, tiffStart, v, count, bigEndian);
    }

    if (gps.lat !== undefined && gps.lng !== undefined) {
      // Convert DMS → decimal
      gps.latitude = gps.lat * (gps.latRef === 'S' ? -1 : 1);
      gps.longitude = gps.lng * (gps.lngRef === 'W' ? -1 : 1);
    }
    return gps;
  },

  _readGPSCoord(view, tiffStart, valueOffset, count, bigEndian) {
    // 3 RATIONAL values: degrees, minutes, seconds
    const dataOffset = view.getUint32(valueOffset, !bigEndian);
    const start = tiffStart + dataOffset;
    const deg = this._readRationalAt(view, start, bigEndian);
    const min = this._readRationalAt(view, start + 8, bigEndian);
    const sec = this._readRationalAt(view, start + 16, bigEndian);
    return deg + min / 60 + sec / 3600;
  },

  _readRationalAt(view, offset, bigEndian) {
    const num = view.getUint32(offset, !bigEndian);
    const den = view.getUint32(offset + 4, !bigEndian);
    return den === 0 ? 0 : num / den;
  },

  _readRational(view, tiffStart, valueOffset, bigEndian) {
    const dataOffset = view.getUint32(valueOffset, !bigEndian);
    return this._readRationalAt(view, tiffStart + dataOffset, bigEndian);
  },

  _readASCII(view, tiffStart, valueOffset, count, bigEndian) {
    let strOffset;
    if (count <= 4) {
      strOffset = valueOffset;
    } else {
      strOffset = tiffStart + view.getUint32(valueOffset, !bigEndian);
    }
    let s = '';
    for (let i = 0; i < count - 1; i++) {
      const c = view.getUint8(strOffset + i);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  },

  // ==================== 2. Bank QR Detection (jsQR + VietQR) ====================

  /**
   * Decode QR từ canvas. Yêu cầu jsQR đã được load (window.jsQR).
   * Sau đó parse VietQR EMV format để rút STK + bank.
   *
   * @param {HTMLCanvasElement|HTMLImageElement} source
   * @returns {Object|null} { rawData, isVietQR, bankBin, accountNumber, ... }
   */
  detectBankQR(source) {
    if (typeof window === 'undefined' || !window.jsQR) {
      console.warn('[SocialShield] jsQR not loaded — call loadJsQR() first');
      return null;
    }

    let canvas;
    if (source instanceof HTMLCanvasElement) {
      canvas = source;
    } else if (source instanceof HTMLImageElement) {
      canvas = document.createElement('canvas');
      canvas.width = source.naturalWidth || source.width;
      canvas.height = source.naturalHeight || source.height;
      canvas.getContext('2d').drawImage(source, 0, 0);
    } else {
      return null;
    }

    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = window.jsQR(imageData.data, imageData.width, imageData.height);
    if (!code || !code.data) return null;

    const result = { rawData: code.data, isVietQR: false };

    // VietQR EMV format: bắt đầu bằng "00020101" (Payload Format Indicator)
    if (/^000201\d{2}/.test(code.data)) {
      result.isVietQR = true;
      const parsed = this._parseEMVQR(code.data);
      Object.assign(result, parsed);
    }

    return result;
  },

  _parseEMVQR(data) {
    // EMV QR: chuỗi TLV (Tag-Length-Value), mỗi field gồm tag 2 chữ số,
    // length 2 chữ số, value độ dài tương ứng.
    const fields = {};
    let i = 0;
    while (i < data.length - 4) {
      const tag = data.substr(i, 2);
      const len = parseInt(data.substr(i + 2, 2), 10);
      if (isNaN(len)) break;
      fields[tag] = data.substr(i + 4, len);
      i += 4 + len;
    }

    const out = { fields };

    // Tag 38 = Merchant Account Information cho VietQR
    if (fields['38']) {
      const sub = this._parseEMVQR(fields['38']);
      // Sub-tag 00 = GUID (A000000727 = NAPAS)
      // Sub-tag 01 = bank info (BIN + account)
      const bank = sub.fields?.['01'];
      if (bank) {
        const bankSub = this._parseEMVQR(bank);
        out.bankBin = bankSub.fields?.['00']; // 6-digit bank BIN
        out.accountNumber = bankSub.fields?.['01'];
      }
    }

    if (fields['54']) out.amount = fields['54'];
    if (fields['58']) out.country = fields['58'];
    if (fields['59']) out.merchantName = fields['59'];
    if (fields['60']) out.merchantCity = fields['60'];

    return out;
  },

  /**
   * Lazy-load jsQR từ local bundle (lib/jsQR.min.js).
   * MV3 CSP không cho phép remote script trong extension pages.
   * @returns {Promise<boolean>}
   */
  async loadJsQR() {
    if (typeof window === 'undefined') return false;
    if (window.jsQR) return true;
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      // Resolve URL tương đối với extension origin
      script.src = (typeof chrome !== 'undefined' && chrome.runtime?.getURL)
        ? chrome.runtime.getURL('lib/jsQR.min.js')
        : '../lib/jsQR.min.js';
      script.onload = () => resolve(true);
      script.onerror = () => reject(new Error('Failed to load jsQR (lib/jsQR.min.js missing?)'));
      document.head.appendChild(script);
    });
  },

  // ==================== 3. CCCD/CMND Heuristic ====================

  /**
   * Phát hiện ảnh CCCD/CMND VN bằng heuristic đơn giản:
   *  - Aspect ratio 1.5-1.7 (CCCD chuẩn 85.6×54mm = 1.585)
   *  - Dominant color (CCCD mới: xanh dương; CMND cũ: xanh lá nhạt)
   *  - Có vùng chữ dày đặc ở nửa dưới (hard heuristic, skip ML)
   *
   * Không dùng ML — false positive rate có thể cao. Chỉ là cảnh báo.
   *
   * @param {HTMLImageElement|HTMLCanvasElement} source
   * @returns {Object} { likelyIdCard: bool, confidence: 0-1, signals: [] }
   */
  detectVNIDCard(source) {
    let canvas;
    if (source instanceof HTMLCanvasElement) {
      canvas = source;
    } else if (source instanceof HTMLImageElement) {
      canvas = document.createElement('canvas');
      canvas.width = source.naturalWidth || source.width;
      canvas.height = source.naturalHeight || source.height;
      canvas.getContext('2d').drawImage(source, 0, 0);
    } else {
      return { likelyIdCard: false, confidence: 0, signals: ['invalid source'] };
    }

    const w = canvas.width, h = canvas.height;
    const signals = [];
    let score = 0;

    // 1. Aspect ratio
    const ratio = w / h;
    if (ratio >= 1.45 && ratio <= 1.75) {
      score += 0.35;
      signals.push(`aspect ratio ${ratio.toFixed(2)} matches ID card (1.585 expected)`);
    } else if (ratio >= 0.55 && ratio <= 0.69) {
      // Vertical ID
      score += 0.2;
      signals.push(`vertical aspect ratio ${ratio.toFixed(2)}`);
    }

    // 2. Dominant color analysis (down-sample để nhanh)
    const ctx = canvas.getContext('2d');
    const sample = ctx.getImageData(0, 0, Math.min(w, 200), Math.min(h, 200)).data;
    let rSum = 0, gSum = 0, bSum = 0, count = 0;
    for (let i = 0; i < sample.length; i += 16) { // step 4 pixels
      rSum += sample[i];
      gSum += sample[i + 1];
      bSum += sample[i + 2];
      count++;
    }
    const r = rSum / count, g = gSum / count, b = bSum / count;

    // CCCD mới: xanh dương nhạt (R ~ 150, G ~ 180, B ~ 210)
    // CMND cũ: xanh lá nhạt (R ~ 170, G ~ 200, B ~ 170)
    const isBlueish = b > r && b > 140 && Math.abs(b - g) < 50;
    const isGreenish = g > r && g > 160 && Math.abs(g - b) < 40;

    if (isBlueish) {
      score += 0.25;
      signals.push('blue-tinted dominant color (CCCD-like)');
    } else if (isGreenish) {
      score += 0.15;
      signals.push('green-tinted dominant color (CMND-like)');
    }

    // 3. Brightness (CCCD thường sáng đều)
    const brightness = (r + g + b) / 3;
    if (brightness > 140 && brightness < 220) {
      score += 0.1;
      signals.push('document-like brightness range');
    }

    return {
      likelyIdCard: score >= 0.5,
      confidence: Math.min(score, 1),
      signals,
      colorAvg: { r: Math.round(r), g: Math.round(g), b: Math.round(b) },
      ratio: parseFloat(ratio.toFixed(2)),
    };
  },

  // ==================== 4. OCR (Tesseract.js opt-in) ====================

  /**
   * OCR text từ ảnh dùng Tesseract.js (lazy-load từ CDN).
   * Heavy: ~10MB tải lần đầu. Chỉ dùng khi user trigger.
   *
   * @param {Blob|HTMLImageElement|HTMLCanvasElement} source
   * @param {string} langs - vd 'eng+vie'
   * @param {Function} onProgress - callback({status, progress})
   * @returns {Promise<{text: string, words: Array}>}
   */
  async runOCR(source, langs = 'eng', onProgress = null) {
    // MV3 CSP: 'script-src self' → không thể load Tesseract.js từ CDN
    // (jsdelivr / unpkg đều bị reject với "Insecure CSP value").
    // Bundle local cũng không khả thi: tesseract.js cần worker.js + core.wasm + traineddata
    // (~10MB) và internal logic load script động qua importScripts() từ blob URL,
    // chrome-extension:// scheme có hạn chế đặc biệt.
    //
    // Giải pháp thực tế:
    //  - Để OCR hoạt động, user cần manual workflow:
    //    1. Mở https://tesseract.projectnaptha.com/ hoặc Google Lens
    //    2. Paste ảnh, lấy text
    //    3. Dán text vào Tools → Text PII Scanner
    //  - Hoặc: dùng AI server (server/index.js) thêm endpoint OCR qua OpenAI Vision API
    throw new Error(
      'OCR không khả dụng trong MV3 vì CSP. Workaround: dùng Google Lens / ' +
      'tesseract.projectnaptha.com để extract text, sau đó paste vào Text PII Scanner.'
    );
  },

  // ==================== 5. Perceptual Hash (aHash 8x8) ====================

  /**
   * Tính aHash 64-bit từ ảnh. Đơn giản hơn pHash (DCT) nhưng đủ để
   * phát hiện "cùng ảnh" qua các CDN/platform khác nhau.
   * Workflow: resize 8x8 → grayscale → so với mean → bitstring 64.
   *
   * @param {HTMLImageElement|HTMLCanvasElement|Blob|string} input
   * @returns {Promise<string>} 64-character binary string
   */
  async computeAHash(input) {
    let img;
    if (typeof input === 'string') {
      img = await this._urlToImage(input);
    } else if (input instanceof Blob) {
      img = await this._blobToImage(input);
    } else if (input instanceof HTMLImageElement || input instanceof HTMLCanvasElement) {
      img = input;
    } else {
      throw new Error('Invalid input for computeAHash');
    }

    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const ctx = canvas.getContext('2d');
    // Vẽ ảnh rescale xuống 8x8 (smoothing imageSmoothingEnabled mặc định true)
    ctx.drawImage(img, 0, 0, 8, 8);
    const data = ctx.getImageData(0, 0, 8, 8).data;

    const grays = new Array(64);
    let sum = 0;
    for (let i = 0; i < 64; i++) {
      const o = i * 4;
      // Luminance ITU-R BT.709
      const g = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
      grays[i] = g;
      sum += g;
    }
    const avg = sum / 64;
    let hash = '';
    for (let i = 0; i < 64; i++) hash += grays[i] >= avg ? '1' : '0';
    return hash;
  },

  /**
   * Tính pHash 64-bit (DCT-based) từ ảnh.
   * Tolerant với rotate nhỏ, crop nhẹ, color/brightness shift hơn aHash.
   *
   * Workflow: resize 32x32 → grayscale → 2D DCT-II → lấy 8x8 top-left
   * (low-frequency) → median (bỏ DC ở [0,0]) → bit = (val > median).
   *
   * @param {HTMLImageElement|HTMLCanvasElement|Blob|string} input
   * @returns {Promise<string>} 64-character binary string
   */
  async computePHash(input) {
    let img;
    if (typeof input === 'string') img = await this._urlToImage(input);
    else if (input instanceof Blob) img = await this._blobToImage(input);
    else if (input instanceof HTMLImageElement || input instanceof HTMLCanvasElement) img = input;
    else throw new Error('Invalid input for computePHash');

    const SIZE = 32;
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, SIZE, SIZE);
    const data = ctx.getImageData(0, 0, SIZE, SIZE).data;

    const gray = new Float64Array(SIZE * SIZE);
    for (let i = 0; i < SIZE * SIZE; i++) {
      const o = i * 4;
      gray[i] = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
    }

    // Cache cosine table
    const cos = this._dctCosTable(SIZE);

    // 2D DCT-II: chỉ cần 8 hàng/cột đầu (low frequency), tiết kiệm 75% công việc.
    const N = SIZE;
    const KEEP = 8;
    // Bước 1: row-wise DCT, chỉ giữ 8 column outputs đầu
    const rowDct = new Float64Array(N * KEEP);
    for (let y = 0; y < N; y++) {
      for (let u = 0; u < KEEP; u++) {
        let sum = 0;
        for (let x = 0; x < N; x++) sum += gray[y * N + x] * cos[u * N + x];
        rowDct[y * KEEP + u] = sum;
      }
    }
    // Bước 2: column-wise DCT trên rowDct (chỉ KEEP cols), giữ KEEP outputs
    const block = new Float64Array(KEEP * KEEP);
    for (let v = 0; v < KEEP; v++) {
      for (let u = 0; u < KEEP; u++) {
        let sum = 0;
        for (let y = 0; y < N; y++) sum += rowDct[y * KEEP + u] * cos[v * N + y];
        block[v * KEEP + u] = sum;
      }
    }

    // Bỏ DC component [0,0], lấy median 63 giá trị
    const vals = [];
    for (let i = 1; i < KEEP * KEEP; i++) vals.push(block[i]);
    const sorted = [...vals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    let hash = '';
    for (let i = 0; i < KEEP * KEEP; i++) hash += block[i] > median ? '1' : '0';
    return hash;
  },

  _dctCosCache: null,
  _dctCosTable(N) {
    if (this._dctCosCache && this._dctCosCache.N === N) return this._dctCosCache.table;
    const table = new Float64Array(N * N);
    for (let k = 0; k < N; k++) {
      for (let n = 0; n < N; n++) {
        table[k * N + n] = Math.cos((Math.PI * (2 * n + 1) * k) / (2 * N));
      }
    }
    this._dctCosCache = { N, table };
    return table;
  },

  /**
   * Compute cả aHash và pHash trong 1 lần. Convenience cho content scripts.
   * @returns {Promise<{aHash: string, pHash: string}>}
   */
  async computeBothHashes(input) {
    const [aHash, pHash] = await Promise.all([
      this.computeAHash(input),
      this.computePHash(input),
    ]);
    return { aHash, pHash };
  },

  /**
   * So sánh 2 pHash. Ngưỡng nghiêm hơn aHash vì pHash robust hơn:
   * <=6 / 64 = nearly identical, <=10 = similar.
   */
  comparePHashes(h1, h2) {
    const d = this.hashDistance(h1, h2);
    if (d < 0) return { distance: -1, similar: false, identical: false, similarity: 0 };
    return {
      distance: d,
      identical: d <= 2,
      similar: d <= 10,
      similarity: 1 - d / 64,
    };
  },

  /**
   * Hamming distance giữa 2 hash bitstring.
   * @returns {number} 0-64. <=8 = likely cùng 1 ảnh.
   */
  hashDistance(h1, h2) {
    if (!h1 || !h2 || h1.length !== h2.length) return -1;
    let d = 0;
    for (let i = 0; i < h1.length; i++) if (h1[i] !== h2[i]) d++;
    return d;
  },

  /**
   * @returns {Object} { distance, similar, identical, similarity: 0-1 }
   */
  compareHashes(h1, h2) {
    const d = this.hashDistance(h1, h2);
    if (d < 0) return { distance: -1, similar: false, identical: false, similarity: 0 };
    return {
      distance: d,
      identical: d === 0,
      similar: d <= 8,    // ngưỡng kinh nghiệm cho aHash 64-bit
      similarity: 1 - d / 64,
    };
  },

  // ==================== 6.5. Text Region Detection (no ML) ====================

  /**
   * Phát hiện vùng có khả năng chứa text trong ảnh bằng heuristic edge density.
   * Workflow:
   *   1. Resize về max 320px (giữ ratio) để xử lý nhanh
   *   2. Grayscale + Sobel edge detection
   *   3. Chia thành grid cells (16x16 px), tính tỷ lệ pixel edge mỗi cell
   *   4. Cells có edge density cao + nằm cạnh nhau → merge thành text region
   *
   * Không cần ML/Tesseract; dùng tốt cho text in lớn (CCCD/screenshot/ID).
   * False positive với hoa văn dày, false negative với text rất nhỏ.
   *
   * @param {HTMLImageElement|HTMLCanvasElement} source
   * @param {Object} options - { minDensity: 0.18, cellSize: 16, mergeGap: 1 }
   * @returns {Array<{x,y,w,h,density}>} Bounding boxes (theo pixel coords ảnh gốc)
   */
  detectTextRegions(source, options = {}) {
    const { minDensity = 0.18, cellSize = 16, mergeGap = 1 } = options;

    const origW = source.naturalWidth || source.width;
    const origH = source.naturalHeight || source.height;
    if (!origW || !origH) return [];

    // Downscale
    const MAX = 320;
    const scale = Math.min(1, MAX / Math.max(origW, origH));
    const w = Math.max(1, Math.round(origW * scale));
    const h = Math.max(1, Math.round(origH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(source, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;

    // Grayscale
    const gray = new Uint8ClampedArray(w * h);
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      gray[i] = (0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]) | 0;
    }

    // Sobel — chỉ cần magnitude > threshold
    const edge = new Uint8Array(w * h);
    const TH = 50;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const tl = gray[(y - 1) * w + (x - 1)];
        const tc = gray[(y - 1) * w + x];
        const tr = gray[(y - 1) * w + (x + 1)];
        const ml = gray[y * w + (x - 1)];
        const mr = gray[y * w + (x + 1)];
        const bl = gray[(y + 1) * w + (x - 1)];
        const bc = gray[(y + 1) * w + x];
        const br = gray[(y + 1) * w + (x + 1)];
        const gx = -tl - 2 * ml - bl + tr + 2 * mr + br;
        const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
        edge[y * w + x] = (Math.abs(gx) + Math.abs(gy)) > TH ? 1 : 0;
      }
    }

    // Cell grid
    const cellsX = Math.ceil(w / cellSize);
    const cellsY = Math.ceil(h / cellSize);
    const density = new Float32Array(cellsX * cellsY);
    for (let cy = 0; cy < cellsY; cy++) {
      for (let cx = 0; cx < cellsX; cx++) {
        let sum = 0, total = 0;
        const x0 = cx * cellSize, y0 = cy * cellSize;
        const x1 = Math.min(w, x0 + cellSize), y1 = Math.min(h, y0 + cellSize);
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) { sum += edge[y * w + x]; total++; }
        }
        density[cy * cellsX + cx] = total > 0 ? sum / total : 0;
      }
    }

    // Mark hot cells (boolean grid)
    const hot = new Uint8Array(cellsX * cellsY);
    for (let i = 0; i < hot.length; i++) hot[i] = density[i] >= minDensity ? 1 : 0;

    // Connected components (4-conn với gap merge)
    const label = new Int32Array(cellsX * cellsY);
    const regions = [];
    let nextId = 1;
    const stack = [];
    for (let cy = 0; cy < cellsY; cy++) {
      for (let cx = 0; cx < cellsX; cx++) {
        const idx = cy * cellsX + cx;
        if (!hot[idx] || label[idx]) continue;
        stack.length = 0;
        stack.push([cx, cy]);
        label[idx] = nextId;
        let minX = cx, maxX = cx, minY = cy, maxY = cy, count = 0, dSum = 0;
        while (stack.length) {
          const [px, py] = stack.pop();
          count++;
          dSum += density[py * cellsX + px];
          if (px < minX) minX = px; if (px > maxX) maxX = px;
          if (py < minY) minY = py; if (py > maxY) maxY = py;
          for (let dy = -mergeGap; dy <= mergeGap; dy++) {
            for (let dx = -mergeGap; dx <= mergeGap; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = px + dx, ny = py + dy;
              if (nx < 0 || ny < 0 || nx >= cellsX || ny >= cellsY) continue;
              const nIdx = ny * cellsX + nx;
              if (hot[nIdx] && !label[nIdx]) { label[nIdx] = nextId; stack.push([nx, ny]); }
            }
          }
        }
        const widthCells = maxX - minX + 1;
        const heightCells = maxY - minY + 1;
        // Lọc region quá nhỏ hoặc quá vuông (text thường wide aspect)
        if (count < 3) { nextId++; continue; }
        regions.push({
          x: Math.round((minX * cellSize) / scale),
          y: Math.round((minY * cellSize) / scale),
          w: Math.round((widthCells * cellSize) / scale),
          h: Math.round((heightCells * cellSize) / scale),
          density: dSum / count,
          cells: count,
        });
        nextId++;
      }
    }

    // Sort by area desc
    regions.sort((a, b) => b.w * b.h - a.w * a.h);
    return regions;
  },

  /**
   * Vẽ pixelate/blur lên các vùng cho trước trên canvas.
   */
  _blurRegions(canvas, regions, strength = 12) {
    const ctx = canvas.getContext('2d');
    for (const r of regions) {
      const x = Math.max(0, r.x), y = Math.max(0, r.y);
      const w = Math.min(canvas.width - x, r.w);
      const h = Math.min(canvas.height - y, r.h);
      if (w <= 0 || h <= 0) continue;
      // Pixelate: scale down then up
      const sw = Math.max(1, Math.floor(w / strength));
      const sh = Math.max(1, Math.floor(h / strength));
      const tmp = document.createElement('canvas');
      tmp.width = sw; tmp.height = sh;
      const tctx = tmp.getContext('2d');
      tctx.imageSmoothingEnabled = false;
      tctx.drawImage(canvas, x, y, w, h, 0, 0, sw, sh);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tmp, 0, 0, sw, sh, x, y, w, h);
      ctx.imageSmoothingEnabled = true;
    }
  },

  // ==================== 6. Safe Image Generator (PoC PII auto-blur) ====================

  /**
   * Sinh "phiên bản an toàn" của ảnh:
   *  - Strip toàn bộ EXIF (re-encode JPEG qua Canvas tự động loại metadata)
   *  - Che QR code nếu có (vẽ rectangle đen lên vùng QR)
   *  - Cảnh báo nếu phát hiện CCCD nhưng KHÔNG tự crop (để user quyết định)
   *
   * @param {Blob|HTMLImageElement} input
   * @param {Object} options - { blurQR: bool, jpegQuality: 0.85 }
   * @returns {Promise<{blob, info}>}
   */
  async generateSafeImage(input, options = {}) {
    const { blurQR = true, blurText = false, jpegQuality = 0.85, textMinDensity = 0.18 } = options;

    let img;
    if (input instanceof Blob) img = await this._blobToImage(input);
    else if (input instanceof HTMLImageElement) img = input;
    else throw new Error('Invalid input for generateSafeImage');

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    const info = { exifStripped: true, qrCovered: false, idCardWarning: false, textRegionsBlurred: 0 };

    // Bước 1: QR detect TRƯỚC (trên ảnh sạch) để text-blur không phá QR finder pattern.
    // Chỉ ghi nhớ vị trí QR, chưa vẽ che — để sau text blur mới cover (giữ thứ tự visual đúng).
    let qrBox = null;
    if (blurQR && (await this.loadJsQR().catch(() => false))) {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = window.jsQR(imageData.data, imageData.width, imageData.height);
      if (code && code.location) {
        const corners = [
          code.location.topLeftCorner,
          code.location.topRightCorner,
          code.location.bottomRightCorner,
          code.location.bottomLeftCorner,
        ];
        const xs = corners.map(c => c.x);
        const ys = corners.map(c => c.y);
        qrBox = {
          x0: Math.max(0, Math.min(...xs) - 8),
          y0: Math.max(0, Math.min(...ys) - 8),
          x1: Math.min(canvas.width, Math.max(...xs) + 8),
          y1: Math.min(canvas.height, Math.max(...ys) + 8),
          data: code.data,
        };
      }
    }

    // Bước 2: Text region blur — exclude vùng QR (nếu có) khỏi danh sách regions để
    // tránh pixelate QR trông như text region.
    if (blurText) {
      try {
        let regions = this.detectTextRegions(img, { minDensity: textMinDensity });
        if (qrBox) {
          regions = regions.filter(r => {
            // Bỏ region nào overlap >50% với QR box
            const ix0 = Math.max(r.x, qrBox.x0);
            const iy0 = Math.max(r.y, qrBox.y0);
            const ix1 = Math.min(r.x + r.w, qrBox.x1);
            const iy1 = Math.min(r.y + r.h, qrBox.y1);
            const iw = Math.max(0, ix1 - ix0), ih = Math.max(0, iy1 - iy0);
            const inter = iw * ih;
            const rArea = r.w * r.h;
            return rArea === 0 || inter / rArea < 0.5;
          });
        }
        if (regions.length) {
          this._blurRegions(canvas, regions, 14);
          info.textRegionsBlurred = regions.length;
          info.textRegions = regions.slice(0, 20);
        }
      } catch (err) {
        info.textBlurError = err.message;
      }
    }

    // Bước 3: Cover QR (vẽ rectangle đen + stamp) sau cùng để chắc chắn không bị blur de
    if (qrBox) {
      const { x0, y0, x1, y1 } = qrBox;
      ctx.fillStyle = '#000';
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.max(12, (x1 - x0) / 12)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('[QR removed]', (x0 + x1) / 2, (y0 + y1) / 2);
      info.qrCovered = true;
      info.qrData = qrBox.data?.substring(0, 100);
    }

    // Check ID card heuristic → warn (không tự crop)
    const idCheck = this.detectVNIDCard(img);
    if (idCheck.likelyIdCard) {
      info.idCardWarning = true;
      info.idCardConfidence = idCheck.confidence;
    }

    // Re-encode → mất EXIF
    const blob = await new Promise(resolve =>
      canvas.toBlob(resolve, 'image/jpeg', jpegQuality)
    );
    return { blob, info };
  },

  // ==================== Helpers ====================

  _urlToImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`failed to load image: ${url}`));
      img.src = url;
    });
  },

  // ==================== Convenience: scan an image URL/blob with all checks ====================

  /**
   * Quét toàn diện 1 ảnh: EXIF + QR + CCCD heuristic.
   * OCR không tự động chạy (heavy).
   *
   * @param {string|Blob} input - URL ảnh hoặc Blob
   * @returns {Promise<Object>} { exif, qr, idCard, errors }
   */
  async scanImage(input) {
    const result = { exif: null, qr: null, idCard: null, errors: [] };

    let blob, url;
    try {
      if (typeof input === 'string') {
        const res = await fetch(input);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        blob = await res.blob();
        url = input;
      } else if (input instanceof Blob) {
        blob = input;
      } else {
        throw new Error('Invalid input type');
      }
    } catch (err) {
      result.errors.push(`fetch: ${err.message}`);
      return result;
    }

    // 1. EXIF (chỉ JPEG)
    if (blob.type === 'image/jpeg' || blob.type === 'image/jpg' ||
        (url && /\.jpe?g(\?|$)/i.test(url))) {
      try {
        result.exif = await this.extractEXIF(blob);
      } catch (err) {
        result.errors.push(`exif: ${err.message}`);
      }
    }

    // 2. Load image vào canvas cho QR + CCCD
    let img;
    try {
      img = await this._blobToImage(blob);
    } catch (err) {
      result.errors.push(`image: ${err.message}`);
      return result;
    }

    // 3. QR
    try {
      await this.loadJsQR();
      result.qr = this.detectBankQR(img);
    } catch (err) {
      result.errors.push(`qr: ${err.message}`);
    }

    // 4. CCCD heuristic
    try {
      result.idCard = this.detectVNIDCard(img);
    } catch (err) {
      result.errors.push(`idCard: ${err.message}`);
    }

    return result;
  },

  _blobToImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image decode failed')); };
      img.src = url;
    });
  },
};
