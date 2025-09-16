// Create a div to host the Svelte app
const appDiv = document.createElement("div");
appDiv.id = "extension-app";
document.body.appendChild(appDiv);

// Function to inject a CSS file
function injectCSS(file) {
  const link = document.createElement("link");
  link.href = file;
  link.type = "text/css";
  link.rel = "stylesheet";
  document.getElementsByTagName("head")[0].appendChild(link);
}

// Handle streaming messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'streamChunk') {
    // Find target element for writing text
    let targetElement = document.activeElement;

    if (!targetElement || (targetElement.tagName !== "INPUT" && targetElement.tagName !== "TEXTAREA")) {
      // Look for any visible input or textarea
      const inputs = document.querySelectorAll('input[type="text"], input[type="search"], input:not([type]), textarea');
      for (const input of inputs) {
        if (input.offsetParent !== null && !input.disabled && !input.readOnly) {
          targetElement = input;
          input.focus();
          break;
        }
      }
    }

    if (targetElement && (targetElement.tagName === "INPUT" || targetElement.tagName === "TEXTAREA")) {
      // Write to input field
      targetElement.value += request.text;
      targetElement.dispatchEvent(new Event('input', { bubbles: true }));

      if (targetElement.tagName === "TEXTAREA") {
        targetElement.scrollTop = targetElement.scrollHeight;
      }
      targetElement.setSelectionRange(targetElement.value.length, targetElement.value.length);
    } else {
      // Show in floating box only if we're not on an ad-heavy page
      if (!isAdElement(document.activeElement)) {
        showFloatingResponse(request.text);
      }
    }
  } else if (request.action === 'streamComplete') {
    console.log('🏁 Stream completed');
  }
});

// Check if current context is likely an ad
function isAdElement(element) {
  if (!element) return false;

  const adSelectors = [
    '[id*="ad"]', '[class*="ad"]', '[data-ad]',
    '[id*="banner"]', '[class*="banner"]',
    '[id*="sponsor"]', '[class*="sponsor"]',
    'iframe[src*="googlesyndication"]',
    'iframe[src*="doubleclick"]'
  ];

  // Check if element or its parents match ad patterns
  let current = element;
  for (let i = 0; i < 5 && current; i++) {
    for (const selector of adSelectors) {
      if (current.matches && current.matches(selector)) {
        return true;
      }
    }
    current = current.parentElement;
  }

  return false;
}

// Improved floating response box
function showFloatingResponse(text) {
  let responseDiv = document.getElementById('openwebui-response');

  if (!responseDiv) {
    responseDiv = document.createElement('div');
    responseDiv.id = 'openwebui-response';
    responseDiv.style.cssText = `
      position: fixed !important;
      top: 20px !important;
      right: 20px !important;
      width: 350px !important;
      max-height: 400px !important;
      background: #1a1a1a !important;
      color: #ffffff !important;
      padding: 15px !important;
      border-radius: 8px !important;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5) !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
      font-size: 14px !important;
      line-height: 1.4 !important;
      z-index: 999999999 !important;
      overflow-y: auto !important;
      border: 1px solid #444 !important;
      white-space: pre-wrap !important;
      word-wrap: break-word !important;
    `;

    // Add close button
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '×';
    closeBtn.style.cssText = `
      position: absolute !important;
      top: 5px !important;
      right: 10px !important;
      background: none !important;
      border: none !important;
      color: #888 !important;
      font-size: 20px !important;
      cursor: pointer !important;
      padding: 0 !important;
      width: 20px !important;
      height: 20px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
    `;

    closeBtn.onmouseover = () => closeBtn.style.color = '#fff';
    closeBtn.onmouseout = () => closeBtn.style.color = '#888';
    closeBtn.onclick = () => responseDiv.remove();

    responseDiv.appendChild(closeBtn);

    // Add content area
    const contentArea = document.createElement('div');
    contentArea.id = 'openwebui-content';
    contentArea.style.cssText = `
      margin-top: 10px !important;
      padding-right: 10px !important;
    `;
    responseDiv.appendChild(contentArea);

    document.body.appendChild(responseDiv);
  }

  const contentArea = responseDiv.querySelector('#openwebui-content');
  if (contentArea) {
    contentArea.textContent += text;
    responseDiv.scrollTop = responseDiv.scrollHeight;
  }
}

// Inject the CSS file (JS is loaded via manifest)
injectCSS(chrome.runtime.getURL("extension/dist/style.css"));
