/**
 * SocialShield Background Service Worker
 * Xử lý logic nền, notifications, và scheduled tasks
 */

// ==================== Installation ====================

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[SocialShield] Extension installed:', details.reason);

  if (details.reason === 'install') {
    // Mở dashboard khi cài lần đầu
    chrome.tabs.create({
      url: chrome.runtime.getURL('dashboard/dashboard.html')
    });
  }

  // Setup periodic alarm
  chrome.alarms.create('periodic-check', { periodInMinutes: 60 });
});

// ==================== Message Handling ====================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'SNAPSHOT_SAVED':
      handleSnapshotSaved(message.data);
      break;

    case 'PRIVACY_SCAN_COMPLETE':
      handlePrivacyScanComplete(message.data);
      break;

    case 'LINK_SCAN_COMPLETE':
      handleLinkScanComplete(message.data);
      break;

    case 'URL_CHANGED':
      // Content script báo URL thay đổi, cập nhật badge
      updateBadge(sender.tab?.id, message.data);
      break;

    case 'GET_TAB_INFO':
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        sendResponse(tabs[0] || null);
      });
      return true;
  }
});

// ==================== Event Handlers ====================

function handleSnapshotSaved(snapshot) {
  if (!snapshot) return;

  // Show notification
  chrome.notifications.create(`snapshot-${snapshot.id}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'SocialShield - Snapshot Saved',
    message: `Captured ${snapshot.count} ${snapshot.type} for @${snapshot.username}`,
    priority: 1
  });

  // Update badge
  chrome.action.setBadgeText({ text: String(snapshot.count) });
  chrome.action.setBadgeBackgroundColor({ color: '#00d4aa' });

  // Clear badge after 5 seconds
  setTimeout(() => {
    chrome.action.setBadgeText({ text: '' });
  }, 5000);
}

function handlePrivacyScanComplete(analysis) {
  if (!analysis) return;

  const count = analysis.privacyFindings?.length || 0;
  if (count > 0) {
    chrome.notifications.create(`privacy-${Date.now()}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'SocialShield - Privacy Alert',
      message: `Found ${count} privacy risk(s) - Risk level: ${analysis.riskLevel?.toUpperCase()}`,
      priority: 2
    });
  }
}

function handleLinkScanComplete(data) {
  if (!data) return;

  if (data.unsafe > 0) {
    chrome.notifications.create(`links-${Date.now()}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'SocialShield - Unsafe Links',
      message: `Found ${data.unsafe} unsafe link(s) out of ${data.total} scanned`,
      priority: 2
    });
  }
}

function updateBadge(tabId, data) {
  if (!tabId) return;

  if (data?.isProfilePage) {
    chrome.action.setBadgeText({ text: '', tabId });
  }
}

// ==================== Alarms ====================

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'periodic-check') {
    // Có thể thêm logic kiểm tra định kỳ ở đây
    console.log('[SocialShield] Periodic check triggered');
  }
});

// ==================== Tab Events ====================

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.includes('instagram.com')) {
    // Tab Instagram đã load xong
    chrome.action.setBadgeText({ text: '', tabId });
  }
});
