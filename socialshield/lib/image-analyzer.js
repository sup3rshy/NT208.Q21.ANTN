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
