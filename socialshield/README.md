# SocialShield - Social Media Security Extension

Chrome extension giám sát và bảo vệ tài khoản mạng xã hội khỏi bot, phishing, rò rỉ dữ liệu và các rủi ro bảo mật.

## Features

### Capture & Bot Detection
- **Hỗ trợ đa nền tảng**: Instagram và Twitter/X
- **Capture danh sách followers/following** với phân trang tự động
- **Phát hiện bot** bằng 8+ tín hiệu heuristic (ảnh đại diện, username pattern, follow ratio, mức độ hoạt động...)
- **Hiển thị tỷ lệ Real/Bot** trong notification và dashboard
- **So sánh snapshot**: Theo dõi thay đổi giữa các lần capture, phát hiện hoạt động bất thường

### Privacy Scanning
- **Phát hiện PII toàn diện**:
  - Email, số điện thoại (Việt Nam và quốc tế)
  - CCCD/CMND (kiểm tra ngữ cảnh)
  - Hộ chiếu, tài khoản ngân hàng, mẫu thẻ tín dụng
  - API key/token, địa chỉ ví crypto
- **Phân tích văn bản bằng AI**: Sử dụng OpenAI GPT-4o-mini phát hiện phishing, scam (fallback sang rule-based)
- **Kiểm tra rò rỉ dữ liệu** (multi-source, không cần API key):
  - XposedOrNot API (primary) → check email trong breach database thật
  - HackCheck API (fallback) → CORS enabled, chi tiết data classes bị lộ
  - Domain heuristic (last resort) → danh sách dịch vụ đã bị breach lớn
  - Hiển thị tên breach, số lượng, nguồn kiểm tra
- **Kiểm tra password trong breach DB**: HIBP Pwned Passwords API (free, k-anonymity SHA-1) — chỉ gửi 5 ký tự đầu hash, privacy-preserving
- **Phát hiện mật khẩu lộ**: Cảnh báo nếu plaintext password/PIN xuất hiện trong bio
- **Gợi ý bảo mật**: Đưa ra lời khuyên dựa trên rủi ro phát hiện được

### Link Scanning
- **Phân tích URL** phát hiện phishing và malware
- **Phát hiện URL shortener** (thường dùng trong scam)
- **Phát hiện typosquatting** với pattern đặc thù mạng xã hội
- **Tích hợp Google Safe Browsing** (tùy chọn, cần API key)
- **Highlight link không an toàn** trực tiếp trên trang

### Profile Change Tracking
- **Tự động lưu snapshot profile** metadata (bio, display name, avatar, link, trạng thái riêng tư/xác minh)
- **Phát hiện thay đổi**: So sánh với snapshot trước, cảnh báo khi có thay đổi bất thường
- **Lịch sử thay đổi**: Xem toàn bộ timeline thay đổi profile trên Security Score dashboard
- **Giới hạn 50 entry/profile** để tối ưu storage

### Engagement Rate Calculator
- **Tính engagement rate** dựa trên likes, comments, followers
- **Đánh giá chất lượng**: Excellent (>=3%), Good (>=1%), Average (>=0.5%), Low (<0.5%)
- **Phát hiện bất thường**: Suspicious high (>10%), follower/following ratio cực đoan, engagement quá thấp so với followers
- Truy cập qua FAB menu trên trang profile

### DM/Comment Scam Warning
- **Quét comment/tweet real-time** bằng MutationObserver (debounced)
- **Phát hiện pattern scam**: phishing link, yêu cầu chuyển tiền, crypto scam, giả mạo support...
- **Overlay badge** trên comment/tweet đáng ngờ với mức độ risk
- Hoạt động tự động khi duyệt Instagram/Twitter

### Impersonation Detection
- **Phát hiện tài khoản giả mạo** dựa trên phân tích username
- **Kiểm tra đa chiều**: substring matching, character substitution (l↔1, o↔0), edit distance, common affix patterns (real_, official_, _backup...)
- **So khớp display name** và kiểm tra ảnh đại diện mặc định
- **Scoring threshold 30+** với sắp xếp theo độ nghi ngờ

### Security Score Dashboard
- **Điểm bảo mật tổng hợp** (hệ thống trừ điểm từ 100)
- **Bảng phân tích chi tiết**: Privacy findings, active alerts, bot ratio, profile stability, monitoring freshness
- **Lịch sử thay đổi profile** với giá trị cũ → mới
- **Gợi ý bảo mật thông minh** dựa trên điểm số và breakdown
- **Export báo cáo**: CSV (UTF-8 BOM) và JSON đầy đủ

### Dashboard
- **Snapshot history** với bot/real ratio và timestamps
- **Diff viewer** hiển thị followers thêm/xóa giữa các capture
- **Quản lý cảnh báo** với mức độ severity (low/medium/high/critical)
- **Kết quả privacy scan** chi tiết với findings và recommendations
- **Settings panel**: Google Safe Browsing API key, AI analysis endpoint, toggle AI

### AI Endpoint Backend
- **Express.js server** với OpenAI integration
- **Phân loại văn bản**: scam / suspicious / safe với confidence scoring
- **Rate limiting**: 60 requests/phút/IP
- **CORS bảo mật**: Chỉ cho phép chrome-extension và localhost
- **Fallback pattern**: Rule-based analysis khi AI không khả dụng
- **Health check endpoint**: Kiểm tra kết nối backend

## Installation

### 1. Clone & Setup Extension
```bash
git clone <repo-url> socialshield
cd socialshield
```

### 2. Install Server Dependencies
```bash
cd server
npm install
```

### 3. Configure Environment
```bash
cp server/.env.example server/.env
```
Chỉnh sửa `server/.env`:
```env
OPENAI_API_KEY=your_openai_api_key   # Tùy chọn - fallback sang rule-based nếu không có
PORT=3000
```

### 4. Load Extension in Chrome
1. Mở Chrome → `chrome://extensions/`
2. Bật "Developer mode" (góc trên phải)
3. Click "Load unpacked"
4. Chọn thư mục `socialshield`
5. Icon extension sẽ xuất hiện trên toolbar

### 5. Start Backend Server
```bash
cd server
npm start
```
Server chạy tại `http://localhost:3000`

> **Note**: Server là tùy chọn. Không có server, extension vẫn hoạt động với rule-based text analysis.

## Usage

### Capture Followers/Following
1. Vào trang profile trên Instagram hoặc Twitter/X
2. Click FAB (nút tròn góc dưới phải)
3. Chọn "Capture Following" hoặc "Capture Followers"
4. Chờ capture hoàn tất → xem kết quả trên Dashboard

### Privacy Scan
1. Vào bất kỳ trang profile nào
2. Click FAB → "Privacy Scan"
3. Extension phân tích: PII, AI analysis, data breach, password exposure
4. Kết quả hiển thị trực tiếp + lưu vào Dashboard

### Engagement Rate
1. Vào trang profile
2. Click FAB → "Engagement Rate"
3. Xem tỷ lệ tương tác, chất lượng, và cảnh báo bất thường

### Impersonation Check
1. Vào trang profile
2. Click FAB → "Impersonation Check"
3. Extension quét followers để tìm tài khoản giả mạo username tương tự

### Security Score
1. Mở Dashboard → click "Security Score" trên sidebar
2. Xem điểm bảo mật tổng hợp, breakdown chi tiết
3. Xem lịch sử thay đổi profile và gợi ý bảo mật
4. Export báo cáo CSV hoặc JSON

## Architecture

```
socialshield/
├── manifest.json                 # Extension config (Manifest V3)
├── background/
│   └── service-worker.js        # Background: API calls, message routing, auto-capture, alarms
├── content/
│   ├── instagram.js             # Instagram: capture, scan, FAB, comment scanner, profile tracking
│   ├── instagram.css
│   ├── twitter.js               # Twitter/X: capture, scan, FAB, tweet scanner, profile tracking
│   └── twitter.css
├── lib/
│   ├── storage.js               # Chrome Storage API wrapper + profile history
│   ├── scanner.js               # Privacy scan, link scan, engagement calc, impersonation detect
│   ├── diff.js                  # Snapshot comparison, bot detection (8+ signals)
│   ├── text-analyzer.js         # AI + rule-based text classification (20+ patterns)
│   └── chart.min.js             # Chart.js for dashboard visualizations
├── dashboard/
│   ├── dashboard.html           # Dashboard UI (snapshots, compare, privacy, alerts, settings, security score)
│   ├── dashboard.js             # Dashboard logic + security score + CSV/JSON export
│   └── dashboard.css            # Dark theme styling
├── popup/
│   ├── popup.html               # Extension popup UI
│   └── popup.js                 # Popup logic (stats, quick actions)
├── server/
│   ├── index.js                 # Express.js backend (OpenAI + rule-based fallback)
│   ├── package.json
│   └── .env.example             # Environment template
├── icons/                       # Extension icons
├── .gitignore
└── README.md
```

### Platform APIs Used

| Platform | Endpoint | Purpose |
|----------|----------|---------|
| Instagram | `web_profile_info` | Profile metadata + user ID |
| Instagram | `friendships/{id}/followers` | Fetch followers (cursor-based) |
| Instagram | `friendships/{id}/following` | Fetch following (cursor-based) |
| Twitter/X | `users/show.json` | User info (follower count, etc.) |
| Twitter/X | `followers/list.json` | Fetch followers (cursor-based) |
| Twitter/X | `friends/list.json` | Fetch following (cursor-based) |

## Privacy & Security

- Không gửi dữ liệu cho bên thứ ba (trừ OpenAI nếu bật AI analysis)
- Snapshot lưu local trong Chrome Storage
- Pwned Passwords check dùng k-anonymity (chỉ gửi 5 ký tự đầu SHA-1 hash, không gửi password thật)
- Email breach check qua XposedOrNot/HackCheck (free, không cần API key)
- API key do người dùng tự nhập
- CORS server chỉ cho phép chrome-extension và localhost
- URL parameters được encode đúng cách (chống injection)

## Tech Stack

- **Frontend**: Chrome Extensions Manifest V3, Vanilla JavaScript, CSS
- **Backend**: Node.js, Express.js, OpenAI API
- **APIs**: Instagram API v1.1, Twitter/X API v1.1, XposedOrNot, HackCheck, HIBP Pwned Passwords, Google Safe Browsing v4, OpenAI GPT-4o-mini

## Troubleshooting

| Vấn đề | Giải pháp |
|--------|-----------|
| "Extension context invalidated" | Refresh trang (extension đã được cập nhật) |
| AI analysis không hoạt động | Kiểm tra server: `http://localhost:3000/health` |
| Capture không đủ users | Chờ giữa các lần capture (rate limit). Extension tự retry tối đa 5 lần |
| Safe Browsing không scan | Cấu hình API key trong Dashboard → Settings |
| Server crash khi start | Kiểm tra port không bị chiếm, `.env` đúng format |

## License

Đồ án môn Lập trình Web.
