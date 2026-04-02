# SocialShield - Social Media Security & Connection Monitor

## Seminar 1 - NT208 | Chrome Extension

---

## 1. Người dùng & Phân tích Nhu cầu (Use-cases)

### 1.1 Phân loại nhóm người dùng

| Nhóm | Mô tả | Nhu cầu chính |
|------|--------|----------------|
| **Người dùng cá nhân** | Người dùng Instagram phổ thông muốn theo dõi biến động tài khoản | Biết ai follow/unfollow mình, bảo vệ quyền riêng tư |
| **Content Creator / Influencer** | Người có lượng follower lớn, cần quản lý community | Phát hiện bot, theo dõi tăng trưởng, cảnh báo bất thường |
| **Security Researcher** | Người nghiên cứu bảo mật, phân tích hành vi MXH | Phân tích pattern, phát hiện tấn công, thu thập dữ liệu |
| **Admin (quản trị)** | Quản trị viên hệ thống extension | Quản lý settings, export dữ liệu, xem thống kê |

### 1.2 Use-cases chi tiết

#### Người dùng cá nhân
- **UC-01**: Chụp snapshot danh sách following của một profile
- **UC-02**: Chụp snapshot danh sách followers của một profile
- **UC-03**: So sánh 2 snapshots để xem ai mới follow / ai unfollow
- **UC-04**: Quét profile để phát hiện thông tin cá nhân bị lộ (email, SĐT)
- **UC-05**: Kiểm tra links trên profile có an toàn không
- **UC-06**: Xem lịch sử snapshots trên Dashboard
- **UC-07**: Nhận cảnh báo khi có hoạt động bất thường

#### Content Creator
- **UC-08**: Theo dõi biến động followers theo thời gian
- **UC-09**: Phát hiện mass follow/unfollow (bot attack)
- **UC-10**: Export dữ liệu để phân tích bên ngoài
- **UC-11**: Tùy chỉnh ngưỡng cảnh báo (threshold)

#### Security Researcher
- **UC-12**: Phân tích privacy risk score của một profile
- **UC-13**: Phát hiện homograph attack trong URLs
- **UC-14**: Scan phishing links trên trang MXH
- **UC-15**: Xem timeline thay đổi connections

### 1.3 Tính năng giữ chân người dùng (Retention)

| Tính năng "đinh" | Mô tả | Lý do giữ chân |
|-------------------|--------|-----------------|
| **Connection Diff Tracker** | So sánh ai follow/unfollow | Tâm lý tò mò - người dùng muốn biết ai unfollow mình hàng ngày |
| **Real-time Alerts** | Cảnh báo push khi phát hiện bất thường | FOMO - sợ bỏ lỡ thông tin quan trọng về tài khoản |
| **Privacy Risk Score** | Điểm rủi ro quyền riêng tư | Lo ngại bảo mật - muốn kiểm tra thường xuyên |
| **Historical Timeline** | Lịch sử biến động theo thời gian | Dữ liệu tích lũy - càng dùng lâu càng có giá trị |

---

## 2. Phân tích Cạnh tranh & Chiến lược khác biệt

### 2.1 Đối thủ cạnh tranh

| Đối thủ | Loại | Ưu điểm | Nhược điểm |
|---------|------|---------|------------|
| **Social Blade** | Website | Dữ liệu thống kê chi tiết, miễn phí | Không track từng follower, không có privacy scan |
| **Followers Track (iOS/Android)** | Mobile App | Giao diện đẹp, dễ dùng | Yêu cầu đăng nhập IG (rủi ro bảo mật), phí subscription |
| **Crowdfire** | Web + App | Quản lý nhiều MXH, scheduled posts | Nặng, đắt, tập trung vào marketing hơn security |
| **Ninjalitics** | Website | Phân tích profile IG chi tiết | Chỉ phân tích public data, không track changes |

### 2.2 Lợi thế cạnh tranh của SocialShield

| Lợi thế | Mô tả |
|---------|--------|
| **Browser Extension** | Hoạt động trực tiếp trên trang IG, không cần chuyển app/tab |
| **Sử dụng Instagram API** | Gọi trực tiếp Instagram Private API để lấy dữ liệu chính xác, không scrape DOM |
| **Auto Capture** | Tự động capture snapshots theo lịch (background), không cần mở Instagram |
| **Tích hợp Security** | Kết hợp connection tracking + privacy scanning + link checking |
| **Hoàn toàn miễn phí** | Open source, không subscription |
| **Dữ liệu local** | Dữ liệu lưu trên máy user, không upload lên server bên thứ 3 |

### 2.3 Chống sao chép

- **Thuật toán Diff Engine riêng**: So sánh snapshots với logic phát hiện bất thường tùy chỉnh
- **Privacy Scanner đa lớp**: Kết hợp nhiều pattern regex (VN phone, CCCD, address) đặc thù cho người dùng Việt Nam
- **Scoring System**: Hệ thống chấm điểm rủi ro riêng biệt
- **Tiếp cận ngách**: Tập trung vào security - không có extension nào kết hợp cả connection tracking lẫn security scanning

### 2.4 Unique Selling Proposition (USP)

> **"Extension đầu tiên kết hợp Connection Tracking + Privacy Scanning + Link Safety trên cùng một công cụ, hoạt động trực tiếp trên Instagram mà không yêu cầu đăng nhập."**

---

## 3. Sơ đồ Kiến trúc Hệ thống (System Architecture)

### 3.1 Tổng quan kiến trúc

```
┌──────────────────────────────────────────────────────────────────┐
│                     CHROME BROWSER                                │
│                                                                   │
│  ┌─────────────────┐   ┌──────────────────┐   ┌──────────────┐  │
│  │  Content Script  │   │  Background SW   │   │  Popup UI    │  │
│  │  (instagram.js)  │◄─►│ (service-worker) │◄─►│ (popup.html) │  │
│  │                  │   │                  │   │              │  │
│  │ - IG API Calls   │   │ - IG API (BG)   │   │ - Quick View │  │
│  │ - UI Injection   │   │ - Auto Capture   │   │ - Actions    │  │
│  │ - Privacy Scan   │   │ - Notifications  │   │ - Stats      │  │
│  │ - Link Check     │   │ - Alarms         │   │              │  │
│  │ - Context Check  │   │ - Cookies API    │   │              │  │
│  └────────┬─────────┘   └────────┬─────────┘   └──────┬───────┘  │
│           │                      │                      │         │
│           └──────────┬───────────┘                      │         │
│                      │                                  │         │
│  ┌───────────────────┴──────────────────────────────────┴──────┐  │
│  │                Chrome Storage API (Local)                    │  │
│  │  ┌──────────┐ ┌──────────┐ ┌────────┐ ┌──────────────────┐  │  │
│  │  │Snapshots │ │ Privacy  │ │ Alerts │ │    Settings      │  │  │
│  │  │ Data     │ │ Scans    │ │        │ │                  │  │  │
│  │  └──────────┘ └──────────┘ └────────┘ └──────────────────┘  │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │              Dashboard Page (dashboard.html)                 │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐  │  │
│  │  │ Overview │ │Snapshots │ │ Compare  │ │ Privacy Scans │  │  │
│  │  │          │ │ Viewer   │ │ Diff     │ │               │  │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └───────────────┘  │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘

                    Tương tác với bên ngoài:
                    ┌──────────────────────────────┐
                    │  Instagram Private API        │
                    │  /api/v1/friendships/         │  ← Content Script + Service Worker
                    │  /api/v1/users/               │
                    └──────────────────────────────┘
```

### 3.2 Mô tả các module chính

| Module | Chức năng | File(s) |
|--------|-----------|---------|
| **Content Script** | Inject vào trang Instagram, gọi Instagram API để capture following/followers, quét privacy, kiểm tra links | `content/instagram.js`, `content/instagram.css` |
| **Background Service Worker** | Instagram API (background), auto-capture theo lịch, message routing, notifications, alarms, cookies management | `background/service-worker.js` |
| **Popup UI** | Giao diện compact khi click icon extension: hiện trạng thái, quick actions, stats | `popup/popup.html`, `popup/popup.js`, `popup/popup.css` |
| **Dashboard** | Trang full-size: xem snapshots, so sánh diff, privacy history, alerts, settings | `dashboard/dashboard.html`, `dashboard/dashboard.js`, `dashboard/dashboard.css` |
| **Storage Library** | API wrapper cho Chrome Storage: CRUD snapshots, scans, alerts, settings | `lib/storage.js` |
| **Diff Engine** | So sánh 2 snapshots, tính diff, phát hiện hoạt động bất thường | `lib/diff.js` |
| **Scanner** | Privacy scanner (PII detection) + Link safety checker (phishing, typosquatting) | `lib/scanner.js` |

---

## 4. Thiết kế Luồng dữ liệu & UML

### 4.1 Data Flow Diagram (DFD Level 0)

```
                    ┌──────────────┐
                    │   User       │
                    │  (Browser)   │
                    └──────┬───────┘
                           │
              Tương tác trên Instagram
                           │
            ┌──────────────┼──────────────┐
            │              │              │
     ┌──────▼──────┐ ┌────▼─────┐ ┌──────▼──────┐
     │  Content    │ │ Service  │ │  Dashboard  │
     │  Script     │ │ Worker   │ │             │
     └──────┬──────┘ └────┬─────┘ └──────┬──────┘
            │              │              │
            │         Instagram           │
            │        Private API          │
            │              │              │
     ┌──────▼──────┐ ┌────▼─────┐ ┌──────▼──────┐
     │  Snapshot   │ │  Auto    │ │  Privacy    │
     │  Capture    │ │ Capture  │ │  Scan       │
     │  (manual)   │ │ (alarm)  │ │  Link Check │
     └──────┬──────┘ └────┬─────┘ └──────┬──────┘
            │              │              │
            └──────────────┼──────────────┘
                           │
                    ┌──────▼───────┐
                    │   Chrome     │
                    │   Storage    │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │  Dashboard   │
                    │  (Hiển thị)  │
                    └──────────────┘
```

### 4.2 Use Case Diagram

```
                        ┌───────────────────────────────────────────┐
                        │          SocialShield System               │
                        │                                            │
    ┌──────┐           │  ┌──────────────────────┐                  │
    │      │───────────┼─►│ Capture Following    │                  │
    │      │           │  └──────────────────────┘                  │
    │      │           │                                            │
    │      │───────────┼─►┌──────────────────────┐                  │
    │      │           │  │ Capture Followers     │                  │
    │ User │           │  └──────────────────────┘                  │
    │      │           │                                            │
    │      │───────────┼─►┌──────────────────────┐                  │
    │      │           │  │ Compare Snapshots     │──────┐          │
    │      │           │  └──────────────────────┘      │          │
    │      │           │                          ┌─────▼────────┐ │
    │      │───────────┼─►┌──────────────────────┐│ Detect       │ │
    │      │           │  │ Run Privacy Scan     ││ Suspicious   │ │
    │      │           │  └──────────────────────┘│ Activity     │ │
    │      │           │                          └──────────────┘ │
    │      │───────────┼─►┌──────────────────────┐                  │
    │      │           │  │ Check Link Safety    │                  │
    │      │           │  └──────────────────────┘                  │
    │      │           │                                            │
    │      │───────────┼─►┌──────────────────────┐                  │
    │      │           │  │ View Dashboard       │                  │
    │      │           │  └──────────────────────┘                  │
    │      │           │                                            │
    │      │───────────┼─►┌──────────────────────┐                  │
    │      │           │  │ Export Data           │                  │
    │      │           │  └──────────────────────┘                  │
    │      │           │                                            │
    │      │───────────┼─►┌──────────────────────┐                  │
    │      │           │  │ Configure Settings   │                  │
    └──────┘           │  └──────────────────────┘                  │
                        │                                            │
                        └───────────────────────────────────────────┘
```

### 4.3 Sequence Diagram - Capture Following (API-based)

```
    User          Content Script      Background SW    IG API         Storage
     │                 │                  │              │               │
     │  Click Capture  │                  │              │               │
     │────────────────►│                  │              │               │
     │                 │                  │              │               │
     │                 │  FETCH_PROFILE   │              │               │
     │                 │  _INFO           │              │               │
     │                 │─────────────────►│              │               │
     │                 │                  │  /api/v1/    │               │
     │                 │                  │  users/      │               │
     │                 │                  │─────────────►│               │
     │                 │                  │  Profile +   │               │
     │                 │  expectedCount   │  userId      │               │
     │                 │◄─────────────────│◄─────────────│               │
     │                 │                  │              │               │
     │                 │  ┌───────────────┤              │               │
     │                 │  │ Loop:         │              │               │
     │                 │  │ /api/v1/      │              │               │
     │                 │  │ friendships/  │              │               │
     │   Progress      │  │ {id}/following│              │               │
     │◄────────────────│  │ ?count=200    │              │               │
     │                 │  │ &max_id=...   │              │               │
     │                 │  │               │              │               │
     │                 │  │ Verify count  │              │               │
     │                 │  │ vs expected   │              │               │
     │                 │  │ Retry if miss │              │               │
     │                 │  └───────────────┤              │               │
     │                 │                  │              │               │
     │                 │  Save Snapshot   │              │               │
     │                 │──────────────────┼──────────────┼──────────────►│
     │                 │                  │              │               │
     │                 │  SNAPSHOT_SAVED  │              │               │
     │                 │─────────────────►│              │               │
     │                 │                  │  Show        │               │
     │  Notification   │                  │  Notification│               │
     │◄────────────────┼──────────────────│              │               │
     │                 │                  │              │               │
```

### 4.4 Sequence Diagram - Compare Snapshots

```
    User          Dashboard           Storage         Diff Engine
     │                │                  │                │
     │  Select 2      │                  │                │
     │  Snapshots     │                  │                │
     │───────────────►│                  │                │
     │                │  Get Snapshot A  │                │
     │                │─────────────────►│                │
     │                │  Snapshot A data │                │
     │                │◄─────────────────│                │
     │                │  Get Snapshot B  │                │
     │                │─────────────────►│                │
     │                │  Snapshot B data │                │
     │                │◄─────────────────│                │
     │                │                  │                │
     │                │  Compare(A, B)   │                │
     │                │──────────────────┼───────────────►│
     │                │                  │  Diff Result   │
     │                │◄─────────────────┼────────────────│
     │                │                  │                │
     │                │  Detect          │                │
     │                │  Suspicious(Diff)│                │
     │                │──────────────────┼───────────────►│
     │                │                  │  Alerts        │
     │                │◄─────────────────┼────────────────│
     │                │                  │                │
     │  Render Diff   │                  │                │
     │  + Alerts      │                  │                │
     │◄───────────────│                  │                │
     │                │                  │                │
```

---

## 5. Thiết kế Cơ sở dữ liệu

### 5.1 Mô hình NoSQL (Chrome Storage API)

SocialShield sử dụng **Chrome Storage Local API** - một dạng key-value store tương tự NoSQL. Dữ liệu được tổ chức thành các collection sau:

### 5.2 Cấu trúc Collection

#### Collection: Snapshots
**Key pattern**: `snapshots_{platform}_{username}_{type}`

```json
{
  "snapshots_instagram_johndoe_following": [
    {
      "id": "snap_1709462400000_a1b2c3",
      "platform": "instagram",
      "username": "johndoe",
      "type": "following",
      "count": 245,
      "timestamp": "2026-03-03T10:00:00.000Z",
      "createdAt": 1709462400000,
      "data": [
        {
          "username": "alice_wonder",
          "displayName": "Alice W.",
          "isVerified": false,
          "profileUrl": "https://www.instagram.com/alice_wonder/",
          "profilePic": "https://...",
          "userId": "12345678901"
        },
        {
          "username": "bob_builder",
          "displayName": "Bob The Builder",
          "isVerified": true,
          "profileUrl": "https://www.instagram.com/bob_builder/",
          "profilePic": "https://...",
          "userId": "98765432109"
        }
      ]
    }
  ]
}
```

#### Collection: Privacy Scans
**Key pattern**: `privacy_{platform}_{username}`

```json
{
  "privacy_instagram_johndoe": [
    {
      "id": "scan_1709462400000",
      "platform": "instagram",
      "username": "johndoe",
      "riskScore": 35,
      "timestamp": "2026-03-03T10:30:00.000Z",
      "createdAt": 1709462400000,
      "results": [
        {
          "type": "email",
          "severity": "high",
          "icon": "\ud83d\udce7",
          "title": "Email Address Exposed",
          "message": "1 email address found publicly visible",
          "values": ["john@example.com"]
        },
        {
          "type": "phone_vn",
          "severity": "high",
          "icon": "\ud83d\udcf1",
          "title": "Vietnamese Phone Number",
          "message": "1 VN phone number exposed",
          "values": ["0912345678"]
        }
      ]
    }
  ]
}
```

#### Collection: Alerts
**Key**: `alerts`

```json
{
  "alerts": [
    {
      "id": "alert_1709462400000",
      "type": "mass_unfollow",
      "severity": "danger",
      "title": "Mass Unfollow Detected",
      "message": "15 connections removed in 2 hours",
      "platform": "instagram",
      "username": "johndoe",
      "snapshotType": "followers",
      "read": false,
      "timestamp": "2026-03-03T11:00:00.000Z"
    }
  ]
}
```

#### Collection: Settings
**Key**: `settings`

```json
{
  "settings": {
    "notifications": true,
    "autoCapture": false,
    "captureInterval": 360,
    "suspiciousThreshold": {
      "massFollow": 20,
      "massUnfollow": 10,
      "changeRate": 30
    }
  }
}
```

#### Collection: Snapshot Index
**Key**: `snapshot_index`

```json
{
  "snapshot_index": {
    "snapshots_instagram_johndoe_following": {
      "platform": "instagram",
      "username": "johndoe",
      "type": "following",
      "lastUpdated": 1709462400000
    },
    "snapshots_instagram_johndoe_followers": {
      "platform": "instagram",
      "username": "johndoe",
      "type": "followers",
      "lastUpdated": 1709466000000
    }
  }
}
```

### 5.3 Mối quan hệ giữa các Collection

```
snapshot_index (1) ──────► (N) snapshots_{key}
                                    │
                                    │ (so sánh 2 snapshots)
                                    ▼
                              diff_results ──► alerts (nếu suspicious)

privacy_{key} (N) ──────── (1) user profile

settings (1) ──── global config
alerts (N) ──── ordered by timestamp
```

---

## 6. Minimum Viable Product (MVP)

### 6.1 Core Features trong MVP

| # | Feature | Trạng thái | Mô tả |
|---|---------|-----------|-------|
| 1 | Capture Following | Done | Gọi Instagram API `/api/v1/friendships/{id}/following/` với cursor-based pagination (`next_max_id`) |
| 2 | Capture Followers | Done | Gọi Instagram API `/api/v1/friendships/{id}/followers/` với cursor-based pagination (`count=25`, `next_max_id`) |
| 3 | Snapshot Storage | Done | Lưu trữ snapshots với timestamp, userId vào Chrome Storage |
| 4 | Snapshot Viewer | Done | Xem chi tiết từng snapshot trên Dashboard |
| 5 | Diff Comparison | Done | So sánh 2 snapshots cùng profile (dùng userId làm key), hiển thị added/removed |
| 6 | Suspicious Detection | Done | Phát hiện mass follow/unfollow, tỷ lệ thay đổi cao, follower spike |
| 7 | Privacy Scanner | Done | Quét PII (email, SĐT, CCCD) trên profile qua API |
| 8 | Link Checker | Done | Kiểm tra phishing, typosquatting, unsafe URLs |
| 9 | Dashboard | Done | Giao diện đầy đủ với 6 trang (Overview, Snapshots, Compare, Privacy, Alerts, Settings) |
| 10 | Export Data | Done | Xuất toàn bộ dữ liệu dạng JSON |
| 11 | Auto Capture | Done | Tự động capture theo lịch qua Service Worker + Chrome Alarms (không cần mở Instagram) |
| 12 | Capture Verification | Done | So sánh count với expected từ profile info, retry tối đa 5 lần nếu thiếu |

### 6.2 Tech Stack & Giải thích

| Công nghệ | Vai trò | Lý do chọn |
|-----------|---------|-------------|
| **Chrome Extension Manifest V3** | Platform | Chuẩn mới nhất của Chrome, bắt buộc cho extension mới |
| **JavaScript (Vanilla)** | Logic + UI | Không cần build tool, tương thích trực tiếp, nhẹ |
| **HTML5 + CSS3** | Giao diện | Responsive, CSS Grid/Flexbox, Custom Properties |
| **Chrome Storage API** | Database | API native của extension, không cần backend riêng, đồng bộ an toàn |
| **Chrome Notifications API** | Thông báo | Push notification native, không cần server |
| **Chrome Cookies API** | Authentication | Đọc session cookies Instagram cho API calls từ Service Worker |
| **Chrome Alarms API** | Scheduling | Lên lịch auto-capture định kỳ (1h - 24h) |
| **Instagram Private API** | Data Source | `/api/v1/friendships/`, `/api/v1/users/` - lấy dữ liệu chính xác |

**Tại sao không dùng React/Vue?**
- Extension nhẹ, không cần SPA framework nặng
- Không cần build step → dễ debug, dễ maintain
- Chrome Extension có CSP nghiêm ngặt, framework thêm complexity không cần thiết
- Vanilla JS đủ mạnh cho scope của project

**Tại sao Chrome Storage thay vì backend + database?**
- Dữ liệu nhạy cảm (danh sách follow) → nên giữ local, không upload lên server
- Không cần đăng ký, không cần server hosting
- Privacy-by-design: user hoàn toàn kiểm soát dữ liệu của mình
- Chrome Storage cung cấp tối đa 10MB local → đủ cho hàng ngàn snapshots

### 6.3 Cấu trúc Source Code

```
socialshield/
├── manifest.json              # Extension configuration (MV3)
├── background/
│   └── service-worker.js      # Background IG API, auto-capture, notifications, alarms
├── content/
│   ├── instagram.js           # Content script - Instagram API calls, UI injection
│   └── instagram.css          # Styles cho injected UI
├── popup/
│   ├── popup.html             # Popup layout
│   ├── popup.css              # Popup styles
│   └── popup.js               # Popup logic
├── dashboard/
│   ├── dashboard.html         # Full dashboard layout
│   ├── dashboard.css          # Dashboard styles
│   └── dashboard.js           # Dashboard logic
├── lib/
│   ├── storage.js             # Chrome Storage API wrapper
│   ├── diff.js                # Snapshot comparison engine
│   └── scanner.js             # Privacy + Link scanner
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── docs/
    └── SEMINAR1.md            # Tài liệu đồ án
```

### 6.4 Kế hoạch phát triển

#### Seminar 2 (dự kiến)
- Hỗ trợ thêm Twitter/X
- Tích hợp Google Safe Browsing API cho link checking
- Biểu đồ timeline (Chart.js) cho biến động followers
- Bot detection heuristic (phân tích pattern: no profile pic, low followers, etc.)

#### Seminar 3 (dự kiến)
- Backend API (Node.js) cho multi-device sync
- Bot detection bằng ML (phân tích pattern hành vi)
- Import/export giữa các thiết bị
- Firefox Addon version

---

## Phụ lục: Hướng dẫn cài đặt MVP

1. Mở Chrome → `chrome://extensions/`
2. Bật **Developer mode** (góc trên phải)
3. Click **Load unpacked** → chọn thư mục `socialshield/`
4. Navigate đến `https://www.instagram.com/`
5. Vào trang profile bất kỳ → Click icon SocialShield hoặc nút FAB
6. Sử dụng các chức năng: Capture, Privacy Scan, Link Check
7. Click **Open Dashboard** để xem full dashboard