# SocialShield - Social Media Security Extension

A comprehensive Chrome extension for monitoring and protecting your social media accounts from bots, phishing, data breaches, and privacy risks.

## Features

### 📸 Capture & Bot Detection
- **Multi-platform support**: Instagram and Twitter/X
- **Capture followers/following lists** with automatic pagination handling
- **Bot detection heuristics**: Analyzes profile pictures, username patterns, follow ratios, activity levels
- **Real vs Bot count display**: Shows bot percentage in capture notifications and dashboard
- **Snapshot comparison**: Track changes between captures and detect suspicious activity

### 🔍 Privacy Scanning
- **Comprehensive PII detection**:
  - Email addresses
  - Phone numbers (Vietnamese and international formats)
  - National ID numbers (CCCD with context checking)
  - Passport numbers
  - Bank account numbers
  - Credit card patterns
  - API keys and tokens
  - Crypto wallet addresses

- **AI-powered text analysis**: Uses OpenAI GPT-4o-mini to detect:
  - Phishing attempts
  - Scam content
  - Suspicious text patterns
  - Confidence scoring (with fallback to rule-based analysis)

- **Data breach checking**: Integration with Have I Been Pwned API
  - Check if exposed emails appear in known breaches
  - Shows breach service names and count
  - Includes fallback domain-based heuristics

- **Password exposure detection**: Alerts if plaintext passwords/PINs are in bio

- **Security recommendations**: Generates actionable advice based on detected risks

### 🔗 Link Scanning
- **URL analysis** for phishing and malware indicators
- **URL shortener detection** (often used in scams)
- **Typosquatting detection** with social media-specific patterns
- **Google Safe Browsing integration** (optional, requires API key)
- **Highlighted unsafe links** on the page

### 📊 Dashboard
- **Snapshot history** with bot/real ratios and timestamps
- **Diff viewer** showing added/removed followers between captures
- **Alert management** with severity levels (low/medium/high/critical)
- **Privacy scan results** with detailed findings and recommendations
- **Settings panel**:
  - Google Safe Browsing API key configuration
  - AI analysis endpoint (Express backend)
  - Enable/disable AI analysis

### 🤖 AI Endpoint Backend
- **Express.js server** with OpenAI integration
- **Text classification**: Analyzes social media content for security threats
- **Rate limiting**: 60 requests per minute per IP
- **CORS enabled** for Chrome extension communication
- **Fallback pattern**: Rule-based analysis when AI is unavailable
- **Health check endpoint**: Verify backend connectivity

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
Create `.env` in the `server` directory:
```env
OPENAI_API_KEY=your_openai_api_key
PORT=3000
```

### 4. Load Extension in Chrome
1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (top-right toggle)
3. Click "Load unpacked"
4. Select the `socialshield` folder
5. Extension icon should appear in toolbar

### 5. Start Backend Server
```bash
cd server
npm start
```
Server will run on `http://localhost:3000`

## Configuration

### OpenAI Setup
Get your API key from [OpenAI API Keys](https://platform.openai.com/api-keys)

### Google Safe Browsing (Optional)
1. Get API key from [Google Cloud Console](https://console.cloud.google.com/)
2. Enter in extension settings (Dashboard → Settings → Safe Browsing API Key)

### AI Endpoint Configuration
In Dashboard → Settings → AI Analysis:
- Enter backend URL (default: `http://localhost:3000`)
- Toggle "Enable AI Analysis"
- Click "Test Connection" to verify

## Usage

### Capture Followers/Following
1. Navigate to a user's profile on Instagram or Twitter/X
2. Click the SocialShield FAB (floating button, bottom-right)
3. Select "Capture Following" or "Capture Followers"
4. Wait for capture to complete
5. View results in Dashboard with bot/real counts

### Privacy Scan
1. Go to any profile page
2. Click FAB → "Privacy Scan"
3. Extension analyzes profile text for exposed data
4. Results show:
   - Detected PII (emails, phone, IDs, etc.)
   - AI analysis results (phishing/scam indicators)
   - Data breach status
   - Security recommendations

### Link Scanning
1. Click FAB → "Check Links"
2. Scans all external links on page
3. Shows unsafe/warning links with details
4. Unsafe links are highlighted with red outline

### View Snapshots
1. Open Dashboard (extension icon → Dashboard)
2. View all captured snapshots with:
   - Capture date
   - Total count
   - Real user / Suspected bot ratio
   - Progress bar visualization

### Compare Snapshots
1. Click on any snapshot in Dashboard
2. View detailed comparison:
   - Added accounts
   - Removed accounts
   - Bot analysis for each
   - Change summary

## Architecture

### Frontend
- **Manifest V3**: Modern extension architecture
- **Content Scripts**: `content/instagram.js`, `content/twitter.js`
  - DOM observation and user interaction
  - API data collection
  - Privacy scanning on-page
- **Service Worker**: `background/service-worker.js`
  - Background API calls
  - Message routing
  - Storage management
- **Dashboard**: `dashboard/dashboard.html`
  - Snapshot viewing
  - Settings management
  - Analytics display

### Backend
- **Express.js**: RESTful API server
- **OpenAI Integration**: GPT-4o-mini text analysis
- **CORS Support**: Chrome extension communication
- **Rate Limiting**: Protect API endpoints

### Libraries
- **Storage**: Chrome Storage API (local storage for snapshots/settings)
- **Scanner**: Privacy detection, link analysis, bot scoring
- **Diff Engine**: Snapshot comparison and anomaly detection
- **Text Analyzer**: AI + rule-based text classification

## Platform-Specific APIs

### Instagram
- `web_profile_info`: Get user ID and profile metadata
- `friendships/{id}/followers`: Fetch followers list (cursor-based)
- `friendships/{id}/following`: Fetch following list (cursor-based)

### Twitter/X
- `users/show.json`: Get user info (followers count, etc.)
- `followers/list.json`: Fetch followers (cursor-based)
- `friends/list.json`: Fetch following (cursor-based)

## Privacy & Security

- ✅ No data sent to third parties (except OpenAI for text analysis if enabled)
- ✅ Snapshots stored locally in browser storage
- ✅ Have I Been Pwned checks use only email (no password)
- ✅ API keys and credentials entered only by user
- ✅ Chrome extension sandboxing protects against malware

## Tech Stack

- **Frontend**: Chrome Extensions Manifest V3, Vanilla JavaScript, CSS
- **Backend**: Node.js, Express.js, OpenAI API
- **APIs**:
  - Instagram internal API (v1.1)
  - Twitter/X internal API (v1.1)
  - Have I Been Pwned v3
  - Google Safe Browsing v4 (optional)
  - OpenAI GPT-4o-mini

## Development

### Project Structure
```
socialshield/
├── manifest.json              # Extension configuration
├── background/
│   └── service-worker.js     # Background logic
├── content/
│   ├── instagram.js          # Instagram content script
│   ├── twitter.js            # Twitter/X content script
│   └── *.css                 # Content script styles
├── lib/
│   ├── storage.js            # Chrome Storage API wrapper
│   ├── scanner.js            # Privacy & link scanning
│   ├── diff.js               # Snapshot comparison & bot detection
│   └── text-analyzer.js      # AI + rule-based text analysis
├── dashboard/
│   ├── dashboard.html        # Dashboard UI
│   ├── dashboard.js          # Dashboard logic
│   └── dashboard.css         # Dashboard styles
├── popup/
│   ├── popup.html            # Popup UI
│   └── popup.js              # Popup logic
├── server/                   # Express backend
│   ├── index.js              # Server entry point
│   ├── package.json          # Dependencies
│   └── .env                  # Environment variables
└── README.md                 # This file
```

### Adding New Platforms

To add support for a new social media platform:

1. **Create content script**: `content/[platform].js`
   - Implement `getCurrentProfile()`, `fetchConnectionsAPI()`, `runPrivacyScan()`
   - Mirror Instagram/Twitter structure

2. **Create CSS**: `content/[platform].css`
   - Copy FAB and notification styles from existing

3. **Update manifest.json**:
   - Add host permissions for new domain
   - Add content script entry

4. **Update service-worker.js**:
   - Add platform-specific message handlers if needed
   - Add auto-capture logic

## Troubleshooting

### "Extension context invalidated" error
- Refresh the page you're on (extension was updated)

### AI analysis not working
- Check if Express server is running: `http://localhost:3000/health`
- Verify OpenAI API key is correct in `.env`
- Check browser console for error messages

### Capture incomplete (fewer users than expected)
- Wait between attempts - Instagram/Twitter rate limit requests
- Extension retries up to 5 times automatically
- Check if account is public/not blocked

### Links not scanning with Safe Browsing
- Configure API key in Dashboard settings
- Verify quota not exceeded on Google Cloud Console

## License

University project for Web Programming course.

## Contributing

Pull requests welcome for bug fixes and improvements.

## Support

For issues and feature requests, open an issue on GitHub.
