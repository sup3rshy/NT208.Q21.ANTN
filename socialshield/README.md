# SocialShield — Social Media Security & Privacy Extension

Chrome extension (Manifest V3) bảo vệ tài khoản mạng xã hội khỏi bot, phishing, malware, rò rỉ dữ liệu, doxxing và các rủi ro OSINT. Hoạt động sâu trên Instagram & X/Twitter, đồng thời cung cấp các công cụ Privacy/Link/Footprint scan **chạy được trên mọi website**.

---

## Tổng quan kiến trúc

```
SocialShield Extension
├── Content scripts (Instagram, X/Twitter) ──> Capture, deep scan, FAB UI
├── Popup (every site)                     ──> Quick scan + status
├── Dashboard (full UI)                    ──> Tools, doxxing reports, snapshots, compare, settings
├── Background service worker              ──> Platform APIs, breach lookups, auto-capture, alarms
└── Optional Node.js server                ──> AI text classification (OpenAI fallback rule-based)
```

3 tier hoạt động:
1. **IG/X profile** — đầy đủ tính năng kèm capture followers/following
2. **Page bất kỳ** — popup chạy Privacy Scan / Link Scan inline qua `chrome.scripting`
3. **Standalone (Dashboard Tools)** — không cần page nào: input username/URL/text/email/password trực tiếp

---

## Tính năng

### 1. Connection Monitoring (IG/X)
- **Capture followers/following** với pagination tự động (cursor-based, retry tối đa 5 lần khi count chưa khớp)
- **Snapshot diff** giữa các lần capture: phát hiện added / removed / unchanged + change rate
- **Suspicious activity detection**: mass follow/unfollow, follower spike (>10/giờ), high change rate
- **Auto-capture** theo lịch (alarms API), tùy chỉnh interval
- **Profile change tracking**: bio, display name, avatar, external link, privacy/verified status — lưu lịch sử 50 entries/profile, normalize CDN URL trước khi diff để tránh false positive ảnh

### 2. Bot Detection (8+ tín hiệu)
- has_anonymous_profile_picture
- Username pattern (digit ratio, generic `wordNNNNN`, special chars)
- Display name analysis (empty / same as username)
- Follow ratio cực đoan (following >> followers)
- Tweet count = 0 (egg account) hoặc rất ít kèm follow nhiều
- Verified bypass (verified = 0 score)
- Tỷ lệ Real/Bot hiển thị trên notification + dashboard

### 3. Privacy Scanner — PII & Credential Leaks
**Quét sâu** trên bio + display name + captions (12 post gần nhất từ IG API) + tweets visible — recon tools chỉ thấy được public bio.

PII patterns được detect:
| Loại | Severity | Ghi chú |
|---|---|---|
| Email | high | Cross-check với 2 breach DB |
| SĐT VN (`0/+84` + đầu số nhà mạng) | high | |
| SĐT quốc tế | high | |
| CCCD/CMND VN (12 chữ số bắt đầu 0) | critical | |
| Hộ chiếu VN (yêu cầu context) | critical | |
| Thẻ tín dụng (Luhn-aware) | critical | Mask khi hiển thị |
| Số tài khoản ngân hàng (yêu cầu context) | critical | |
| API key / token (sk_live, ghp_, AIza...) | critical | |
| Password/PIN plaintext (strict context) | critical | Bắt buộc `password\|passwd\|mật khẩu` + `:`/`=` |
| Crypto wallet (BTC/ETH) | medium | |
| **Biển số xe VN** (51K-12345, 30A-123.45) | medium | Format chuẩn |
| **Mã sinh viên** (yêu cầu context "MSSV") | medium | |
| **MoMo/ZaloPay/VietQR handle** | high | Detect scam chuyển khoản |
| **Trường học / Công ty** | low | Pretexting risk |
| **Địa chỉ chi tiết VN** (số + đường + phường/quận) | high | Stalking/swatting |
| **Family member tagged** (`mẹ @user`) | medium | Pivot attack risk |
| Date of birth | medium | |

**Email breach check** (multi-source, free, không cần API key):
1. XposedOrNot API (primary)
2. HackCheck API (fallback)
3. Domain heuristic (last resort)

**Password pwned check**: HIBP Pwned Passwords k-anonymity SHA-1 — chỉ gửi 5 ký tự đầu hash, password không bao giờ rời máy người dùng.

**AI text analysis** (optional): OpenAI GPT-4o-mini phân loại scam/suspicious/safe → fallback rule-based 20+ pattern khi không có server.

### 4. Link Scanner — Phishing & Malware
**Heuristic engine** (cục bộ, nhanh):
- URL shortener (bit.ly, t.co...) — −15
- Typosquatting domain (`instagr*m`, `1nstagram`, `twltter`...) — −40
- Phishing keywords (login/verify/secure/account/suspended) — −10/từ
- Scam keywords (free-followers, hack-instagram) — −50
- IP thay vì domain — −20
- HTTP không HTTPS — −15
- Excessive subdomains — −10
- Homograph attack (Cyrillic mixed) — −50

**Threat intel APIs** (chạy song song qua `Promise.allSettled`):
- **Google Safe Browsing v4** — MALWARE / SOCIAL_ENGINEERING / UNWANTED_SOFTWARE / PHA
- **VirusTotal v3** — 60+ AV engines, auto-submit URL chưa từng quét, parse `last_analysis_stats` + threat names. Free 4 req/min, 500/ngày
- **URLhaus (abuse.ch)** — database malware distribution URL, parse threat family tags + online/offline status

Mỗi engine cộng/trừ score độc lập, score < 50 → unsafe. Kết quả hiển thị inline + highlight link unsafe trên page.

### 5. Username Footprint Enumeration (Sherlock-style)
Quét username song song trên **15 site CORS-friendly**:

| Category | Sites |
|---|---|
| Dev/Code | GitHub, GitLab, Codeberg, dev.to, Docker Hub, npm |
| Forums | Reddit, Hacker News, Wikipedia |
| Identity | Keybase |
| Federated | Mastodon, Bluesky |
| Gaming | Lichess, Chess.com |
| Competitive | Codeforces |

- Timeout 8s/request, parallel `Promise.all`
- 3 trạng thái: Found / Not found / **Inconclusive** (rate-limit / CORS / network) — phân biệt rõ với errors thực sự
- Cảnh báo nếu username dùng ≥3 site (linkability risk)
- Chạy được client-side (dashboard Tools) hoặc background monitor (#11 bên dưới)

### 6. Cross-Platform Linkage Detector
So sánh profile IG ↔ X cùng người dùng — phát hiện linkability mà attacker dùng để pivot:
- Identical username (+50)
- Identical display name (+30)
- Bio cross-link (`bio IG có twitter.com/X`) (+60)
- Shared external URL hostname (+40)
- Shared profile pic pathname (+30)

Output: confidence pairs (high/medium/low) + signals.

### 7. Doxxing Risk Report (feature differentiator)
Tổng hợp toàn bộ findings + breach + footprint + linkage thành **narrative attacker-perspective**:

```
"Một attacker có kinh nghiệm cần khoảng 15-30 phút để dựng hồ sơ về
@username từ public footprint hiện tại. Họ có thể biết được 8 loại
thông tin và thực hiện 6 hướng tấn công khác nhau."
```

3 phần báo cáo:
- **Attacker biết được**: facts theo category (Identity, Contact, Government ID, Financial, Location, Vehicle, Affiliation, Relationships, Credentials, Breaches, Online Presence, Linkability)
- **Hướng tấn công khả thi**: SIM-swap, phishing, identity theft, swatting, credential stuffing, pretexting, family pivot...
- **Bạn cần làm**: action items sort theo priority (critical → high → medium)

Risk score 0-100, tier critical/high/medium/low.

### 8. Impersonation Detection
Phát hiện account giả mạo trong followers/following:
- Substring matching username gốc
- Character substitution (l↔1, o↔0, i↔1)
- Edit distance ≤2
- Common affixes (`real_`, `official_`, `_backup`, `_original`)
- Display name match
- Anonymous profile pic boost
- Threshold score 30+, sort theo độ nghi ngờ

### 9. DM/Comment Scam Warning
- MutationObserver theo dõi comment/tweet real-time (debounced)
- Detect pattern scam: phishing link, yêu cầu chuyển tiền, crypto scam, fake support
- Overlay badge mức độ risk trên comment đáng ngờ
- Tự động khi browse IG/X

### 10. Engagement Rate Calculator
- Tính ER từ likes + comments / followers
- Quality tier: Excellent ≥3% / Good ≥1% / Average ≥0.5% / Low / Suspicious-high >10%
- Flag follower/following ratio cực đoan, posts=0 nhưng followers>100

### 11. Security Score Dashboard
- Tổng hợp 100 điểm trừ dần theo: privacy findings, active alerts, bot ratio, profile stability, monitoring freshness
- Lịch sử thay đổi profile timeline (old → new)
- Smart recommendations theo breakdown

---

## Cấu trúc thư mục

```
socialshield/
├── manifest.json                # MV3 config (host_permissions cho tất cả threat-intel + footprint APIs)
├── background/
│   └── service-worker.js        # IG/X API, breach lookups, auto-capture alarms, message routing
├── content/
│   ├── instagram.js             # IG: capture, deep scan (bio + 12 captions), FAB, comment scanner
│   ├── twitter.js               # X: capture, deep scan (bio + 10 visible tweets), FAB, tweet scanner
│   ├── instagram.css / twitter.css
├── lib/
│   ├── storage.js               # Chrome Storage wrapper + profile history (CDN URL normalization)
│   ├── scanner.js               # Privacy/Link/Footprint/Linkage/Doxxing engines + VN-specific patterns
│   ├── diff.js                  # Snapshot diff + 8-signal bot detection
│   ├── text-analyzer.js         # AI + 20+ rule-based scam patterns
│   └── chart.min.js
├── dashboard/
│   ├── dashboard.html           # 8 pages: Overview, Snapshots, Compare, Privacy, Security, Tools, Doxxing, Alerts, Settings
│   ├── dashboard.js
│   └── dashboard.css            # Dark theme với toggle light
├── popup/
│   ├── popup.html               # Quick actions + inline scan results
│   └── popup.js                 # Generic mode trên non-IG/X qua chrome.scripting.executeScript
├── server/                      # Optional Node.js + Express + OpenAI
└── icons/
```

---

## Cài đặt

### 1. Clone repo
```bash
git clone <repo-url> socialshield
cd socialshield
```

### 2. (Tùy chọn) Cài AI server
```bash
cd server
npm install
cp .env.example .env
# Sửa .env: OPENAI_API_KEY=sk-... (để trống nếu chỉ dùng rule-based)
npm start
```
Server chạy tại `http://localhost:3456`. Không có server, extension vẫn hoạt động đầy đủ với rule-based fallback.

### 3. Load extension vào Chrome
1. Mở `chrome://extensions/`
2. Bật **Developer mode**
3. Click **Load unpacked** → chọn thư mục `socialshield/`
4. Pin icon SocialShield lên toolbar

### 4. Cấu hình API keys (tùy chọn — Dashboard → Settings)
| API | Mục đích | Free tier | Đăng ký |
|---|---|---|---|
| Google Safe Browsing | Phishing/malware database Google | Free | [Google Cloud Console](https://console.cloud.google.com/apis/credentials) |
| VirusTotal | 60+ AV engines | 4 req/min, 500/ngày | [virustotal.com/my-apikey](https://www.virustotal.com/gui/my-apikey) |
| URLhaus (abuse.ch) | Malware URL DB | Free | [auth.abuse.ch](https://auth.abuse.ch) |

Không cần API key cho: Email breach (XposedOrNot/HackCheck), Pwned Passwords (HIBP k-anonymity), Username footprint (9 site CORS-friendly).

---

## Cách dùng

### Trên Instagram / X profile
1. Vào trang profile bất kỳ
2. Click FAB (góc dưới phải) → chọn:
   - **Capture Following / Followers** — snapshot list
   - **Privacy Scan** — quét sâu PII + breach + AI + auto-generate Doxxing Report
   - **Link Scan** — quét toàn bộ link trên page với threat intel
   - **Engagement Rate** — phân tích chất lượng tương tác
   - **Impersonation Check** — quét tài khoản giả mạo

### Trên page bất kỳ (Generic mode)
1. Click icon SocialShield trên toolbar
2. **Privacy Scan** hoặc **Link Scanner** vẫn enable — popup tự inject scanner qua `chrome.scripting`
3. Kết quả hiển thị inline trong popup
4. Capture Following/Followers bị disable (cần platform API)

### Dashboard Tools (standalone, không cần page nào)
Open Dashboard → tab **Tools**:
- **Username Footprint** — input username, quét 15 site
- **URL Safety Check** — paste URL bất kỳ, chạy heuristic + GSB + VT + URLhaus
- **Text PII Scanner** — paste bất kỳ text (bio, message, file...)
- **Email Breach Check** — input email
- **Password Pwned Check** — input password (k-anonymity, không lưu)
- **Image Privacy Scanner** — chọn file ảnh, quét EXIF GPS + VietQR + CCCD heuristic, **+ Generate safe version** (strip EXIF + cover QR)
- **Reverse Image Search** — paste URL ảnh → mở Google Lens / Yandex / TinEye / Bing
- **Geo Pattern Heatmap** — input IG username → cluster locations từ recent posts + cảnh báo "nơi sống"
- **Connected Apps Revocation** — deep-links tới settings page của 5 platform lớn
- **Footprint Monitor** — config danh sách username + interval cho background monitoring
- **Privacy Audit Viewer** — xem report mới nhất từ FAB IG/X audit

### Doxxing Risk
Open Dashboard → tab **Doxxing Risk**:
- List các report đã generate (sort theo risk score)
- Click row để xem narrative + attacker knows + attack vectors + fix actions

### Security Score
Dashboard → tab **Security Score**: tổng hợp + export CSV/JSON.

---

## Privacy & Security

- **Không gửi dữ liệu cho bên thứ ba** trừ:
  - OpenAI API (chỉ khi bật AI analysis trong settings)
  - Threat intel APIs (chỉ URL được quét)
  - Breach DBs (chỉ email khi user yêu cầu)
- **HIBP Pwned Passwords** dùng k-anonymity SHA-1: chỉ 5 ký tự đầu hash được gửi, password gốc không rời máy
- **Snapshot lưu local** (Chrome Storage), user clear bất cứ lúc nào
- **CDN URL normalization** trước khi diff profile pic → không log false-positive thay đổi
- **API key user tự nhập**, không hardcode
- **CORS server** chỉ chấp nhận `chrome-extension://` và `localhost`
- **No outbound for footprint** với username chưa được user submit
- Password input trong Tools tự clear sau check

---

## Threat Intel APIs

| API | Loại | Free tier | Endpoint |
|---|---|---|---|
| Google Safe Browsing v4 | Phishing/malware | Free | `safebrowsing.googleapis.com` |
| VirusTotal v3 | Multi-engine AV | 4/min, 500/day | `virustotal.com/api/v3/urls` |
| URLhaus | Malware URL DB | Free | `urlhaus-api.abuse.ch/v1/url/` |
| HIBP Pwned Passwords | Password DB | Free | `api.pwnedpasswords.com/range/` |
| XposedOrNot | Email breach | Free | `api.xposedornot.com/v1/check-email` |
| HackCheck | Email breach | Free | `hackcheck.woventeams.com/api/v4` |
| OpenAI GPT-4o-mini | Text classification | Optional | qua local backend |

## Footprint Sites (9 site, CORS-friendly)

GitHub • Reddit • GitLab • Hacker News • dev.to • Keybase • npm • Docker Hub • Codepen

---

## Tech Stack

- **Frontend**: Chrome MV3, Vanilla JS, CSS, Chart.js
- **Backend (optional)**: Node.js, Express, OpenAI SDK
- **Platform APIs**: Instagram web_profile_info v1, Twitter/X v1.1
- **Storage**: chrome.storage.local

---

## Troubleshooting

| Vấn đề | Giải pháp |
|---|---|
| "Extension context invalidated" | Refresh page (extension đã được reload) |
| Privacy Scan không chạy trên page non-IG/X | Check page có phải `chrome://` không — extension không inject vào pages internal |
| AI analysis không hoạt động | Test server: `http://localhost:3456/health` |
| Capture không đủ users | Rate limit IG/X — extension tự retry 5 lần. Đợi giữa các lần capture |
| VirusTotal trả pending | URL chưa từng quét → đã auto-submit, đợi 30s rồi quét lại |
| Footprint scan: nhiều "errors" | Site đó tạm thời rate-limit hoặc block CORS — không ảnh hưởng các site khác |
| Profile picture luôn báo "changed" | Đã fix (CDN URL normalization). Clear lịch sử cũ trong Settings nếu vẫn còn entry sai |
| False positive PII | Regex đã siết: password phải có `password:` đầy đủ, address phải có "đường + phường/quận". Báo nếu còn pattern lỏng |

---

### 12. Image Privacy Scanner
Quét ảnh local 100% client-side (ảnh không rời máy):

- **EXIF GPS extraction** — bóc lat/lng từ JPEG metadata (no deps, ~150 dòng JS thuần). Cảnh báo + link Google Maps khi có GPS leak.
- **EXIF camera info** — Make/Model + DateTimeOriginal (suy ra timezone/schedule).
- **VietQR / Bank QR decode** — dùng jsQR bundle local (`lib/jsQR.min.js`), parse EMV format → trích bank BIN + account number + amount + merchant.
- **CCCD/CMND heuristic** — aspect ratio (1.585) + dominant color + brightness. Cảnh báo trước khi user post.
- **OCR workaround** — Tesseract.js không bundle được trong MV3 (CSP `script-src 'self'` cấm remote script, lib ~10MB với worker setup phức tạp). Workflow thay thế: dùng [tesseract.projectnaptha.com](https://tesseract.projectnaptha.com/) hoặc Google Lens → copy text → paste vào **Text PII Scanner**.

### 13. Background Footprint Monitor
Quét username trên 10 site định kỳ (interval 6h-7d), so sánh baseline:
- Site mới có account → alert + Chrome notification
- Phát hiện sớm impersonator hoặc service user vô tình đăng ký
- Settings UI ngay trong dashboard Tools

### 14. Privacy Settings Auditor (IG/X)
First-person view mà recon tools không thấy được. FAB action **"Audit Privacy Settings"** đọc DOM của trang Settings:

| Platform | Audited |
|---|---|
| Instagram | Private account toggle, Activity status, Story resharing, 2FA, Login activity sessions, Apps & Websites count |
| X/Twitter | Protect posts, Tag policy, Findable by email/phone, Active sessions, Connected apps, 2FA |

Output: Privacy Posture score 0-100 + findings categorized (visibility/tracking/session/oauth/auth) + actionable recommendations.

---

### 15. Perceptual Hash (aHash) Cross-Platform Match
- `computeAHash(image)` — resize 8×8 grayscale → 64-bit bitstring
- Hamming distance threshold: 0 = identical, ≤8 = "very likely same image"
- Tự động compute khi `saveProfileSnapshot` chạy trên IG/X — lưu vào snapshot history
- `detectCrossPlatformLinkage` thêm 2 signal mới: `identical_profile_pic_hash` (+70), `similar_profile_pic_hash` (+50). Đây là bằng chứng mạnh nhất xác định cùng 1 người dù URL khác nhau (CDN khác).

### 16. Reverse Image Search Shortcuts
- Tools card: paste URL ảnh → 4 button mở **Google Lens / Yandex / TinEye / Bing**
- Ngay trong Doxxing Report detail: hiển thị link reverse search profile pic của target
- Yandex thường tốt nhất cho face match (kinh nghiệm OSINT)

### 17. Geo Pattern Heatmap
- Tools card: input username (đã quét trên IG) → fetch `recentPosts` từ background, cluster theo `location.name`
- Bảng ranked: location + count + link Google Maps
- Cảnh báo nếu 1 location ≥3 lần (= "nơi sống/làm việc" → stalking risk)

### 18. Safe Image Generator (PoC PII auto-blur)
- Tools card: button **"Generate safe version"** trên image scanner
- Workflow:
  - Re-encode JPEG qua Canvas → tự động strip toàn bộ EXIF (GPS, camera, datetime)
  - Detect QR code (jsQR) → vẽ rectangle đen che + stamp "[QR removed]"
  - CCCD heuristic: chỉ cảnh báo, KHÔNG tự crop (để user tự quyết định)
  - Output: download link + preview ảnh đã clean

### 19. Connected Apps Revocation Helper
- Tools card với 5 deep-link buttons:
  - 📷 IG manage access — `/accounts/manage_access/`
  - 🐦 X connected apps — `/settings/connected_apps`
  - 🔑 Google 3rd-party — `myaccount.google.com/connections`
  - 👤 Facebook business integrations
  - 🐙 GitHub authorized apps
- Quick checklist: revoke nếu app không dùng >6 tháng / scope quá rộng / không nhận ra tên / developer đã shut down
- Extension không tự revoke (cần user click) nhưng deep-link rút ngắn workflow

---

## Roadmap

(Tất cả features ban đầu đã ship — đề xuất hướng phát triển tiếp:)
- [ ] pHash thay aHash (DCT-based, tolerant với rotate/crop nhỏ)
- [ ] Real heatmap với Leaflet local (no CDN, ~40KB)
- [ ] Auto-detect text region trong ảnh để blur (cần lightweight ML)
- [ ] Revocation count parser cho IG/X/GitHub apps page (qua content script)
- [ ] Background pHash diff: alert khi profile pic giống ai đó nổi tiếng (impersonation từ phía mình)

---

## License

Đồ án môn NT208.Q21.ANTN — UIT.
