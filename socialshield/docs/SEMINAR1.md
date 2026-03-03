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
| **Không yêu cầu đăng nhập** | KHÔNG thu thập credentials - chỉ đọc DOM hiện tại |
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
│  │ - DOM Scraping   │   │ - Message Hub    │   │ - Quick View │  │
│  │ - UI Injection   │   │ - Notifications  │   │ - Actions    │  │
│  │ - Privacy Scan   │   │ - Alarms         │   │ - Stats      │  │
│  │ - Link Check     │   │                  │   │              │  │
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
                    ┌─────────────────────┐
                    │  instagram.com DOM  │  ← Content Script đọc
                    └─────────────────────┘
```

### 3.2 Mô tả các module chính

| Module | Chức năng | File(s) |
|--------|-----------|---------|
| **Content Script** | Inject vào trang Instagram, scrape DOM để lấy following/followers, quét privacy, kiểm tra links | `content/instagram.js`, `content/instagram.css` |
| **Background Service Worker** | Xử lý logic nền: message routing, notifications, scheduled alarms | `background/service-worker.js` |
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
                    ┌──────▼───────┐
                    │   Content    │
                    │   Script     │
                    └──────┬───────┘
                           │
            ┌──────────────┼──────────────┐
            │              │              │
     ┌──────▼──────┐ ┌────▼─────┐ ┌──────▼──────┐
     │  Snapshot   │ │ Privacy  │ │   Link      │
     │  Capture    │ │ Scan     │ │   Check     │
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

### 4.3 Sequence Diagram - Capture Following

```
    User          Content Script      Modal/DOM       Storage        Background
     │                 │                  │              │               │
     │  Click Capture  │                  │              │               │
     │────────────────►│                  │              │               │
     │                 │  Click Following │              │               │
     │                 │  Link            │              │               │
     │                 │─────────────────►│              │               │
     │                 │                  │              │               │
     │                 │  Wait for Modal  │              │               │
     │                 │◄─────────────────│              │               │
     │                 │                  │              │               │
     │                 │  ┌───────────────┤              │               │
     │                 │  │ Loop:         │              │               │
     │                 │  │ Scroll & Read │              │               │
     │                 │  │ Collect Users │              │               │
     │                 │  │               │              │               │
     │   Progress      │  │               │              │               │
     │◄────────────────│  │               │              │               │
     │                 │  └───────────────┤              │               │
     │                 │                  │              │               │
     │                 │  Save Snapshot   │              │               │
     │                 │──────────────────┼─────────────►│               │
     │                 │                  │              │               │
     │                 │  Notify Background              │               │
     │                 │─────────────────────────────────┼──────────────►│
     │                 │                  │              │               │
     │                 │                  │              │  Show         │
     │  Notification   │                  │              │  Notification │
     │◄────────────────┼──────────────────┼──────────────┼───────────────│
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
          "profileUrl": "https://www.instagram.com/alice_wonder/"
        },
        {
          "username": "bob_builder",
          "displayName": "Bob The Builder",
          "isVerified": true,
          "profileUrl": "https://www.instagram.com/bob_builder/"
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
| 1 | Capture Following | Done | Tự động scroll và thu thập danh sách following |
| 2 | Capture Followers | Done | Tự động scroll và thu thập danh sách followers |
| 3 | Snapshot Storage | Done | Lưu trữ snapshots với timestamp vào Chrome Storage |
| 4 | Snapshot Viewer | Done | Xem chi tiết từng snapshot trên Dashboard |
| 5 | Diff Comparison | Done | So sánh 2 snapshots, hiển thị added/removed |
| 6 | Suspicious Detection | Done | Phát hiện mass follow/unfollow, tỷ lệ thay đổi cao |
| 7 | Privacy Scanner | Done | Quét PII (email, SĐT, CCCD) trên profile |
| 8 | Link Checker | Done | Kiểm tra phishing, typosquatting, unsafe URLs |
| 9 | Dashboard | Done | Giao diện đầy đủ với 6 trang |
| 10 | Export Data | Done | Xuất toàn bộ dữ liệu dạng JSON |

### 6.2 Tech Stack & Giải thích

| Công nghệ | Vai trò | Lý do chọn |
|-----------|---------|-------------|
| **Chrome Extension Manifest V3** | Platform | Chuẩn mới nhất của Chrome, bắt buộc cho extension mới |
| **JavaScript (Vanilla)** | Logic + UI | Không cần build tool, tương thích trực tiếp, nhẹ |
| **HTML5 + CSS3** | Giao diện | Responsive, CSS Grid/Flexbox, Custom Properties |
| **Chrome Storage API** | Database | API native của extension, không cần backend riêng, đồng bộ an toàn |
| **Chrome Notifications API** | Thông báo | Push notification native, không cần server |

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
│   └── service-worker.js      # Background logic, notifications, alarms
├── content/
│   ├── instagram.js           # Content script - DOM scraping, UI injection
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
- Hỗ trợ thêm Twitter/X, Facebook
- Tích hợp Google Safe Browsing API cho link checking
- Biểu đồ timeline (Chart.js) cho biến động followers
- Auto-capture theo lịch (scheduled snapshots)

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
