// Create a div to host the Svelte app
const appDiv = document.createElement("div");
appDiv.id = "extension-app";
document.body.appendChild(appDiv);

// Store accumulated response text for markdown conversion
let accumulatedResponse = '';

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
        // Accumulate text for proper markdown conversion
        accumulatedResponse += request.text;
        showFloatingResponse(accumulatedResponse);
      }
    }
  } else if (request.action === 'streamComplete') {
    console.log('🏁 Stream completed');
    // Reset accumulated response for next stream
    accumulatedResponse = '';
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

// Simple Markdown to HTML converter for floating response box
function markdownToHtml(markdown) {
  if (!markdown) return '';

  let html = markdown
    // Headers
    .replace(/^### (.*$)/gim, '<h3 style="font-size: 16px !important; font-weight: 600 !important; color: #f3f4f6 !important; margin: 16px 0 8px 0 !important;">$1</h3>')
    .replace(/^## (.*$)/gim, '<h2 style="font-size: 18px !important; font-weight: 700 !important; color: #f3f4f6 !important; margin: 16px 0 8px 0 !important;">$1</h2>')
    .replace(/^# (.*$)/gim, '<h1 style="font-size: 20px !important; font-weight: 700 !important; color: #f3f4f6 !important; margin: 16px 0 8px 0 !important;">$1</h1>')

    // Bold and italic
    .replace(/\*\*\*(.*?)\*\*\*/g, '<strong style="font-weight: 700 !important; color: #f3f4f6 !important;"><em style="font-style: italic !important;">$1</em></strong>')
    .replace(/\*\*(.*?)\*\*/g, '<strong style="font-weight: 700 !important; color: #f3f4f6 !important;">$1</strong>')
    .replace(/\*(.*?)\*/g, '<em style="font-style: italic !important; color: #e5e7eb !important;">$1</em>')

    // Code blocks and inline code
    .replace(/```([^`]+)```/g, '<pre style="background: #374151 !important; border-radius: 4px !important; padding: 8px !important; margin: 8px 0 !important; font-size: 12px !important; font-family: Consolas, Monaco, monospace !important; color: #d1d5db !important; overflow-x: auto !important;"><code>$1</code></pre>')
    .replace(/`([^`]+)`/g, '<code style="background: #374151 !important; padding: 2px 4px !important; border-radius: 2px !important; font-size: 12px !important; font-family: Consolas, Monaco, monospace !important; color: #d1d5db !important;">$1</code>')

    // Lists
    .replace(/^\* (.*$)/gim, '<li style="margin-left: 16px !important; list-style: disc !important; color: #e5e7eb !important; margin-bottom: 4px !important;">$1</li>')
    .replace(/^- (.*$)/gim, '<li style="margin-left: 16px !important; list-style: disc !important; color: #e5e7eb !important; margin-bottom: 4px !important;">$1</li>')
    .replace(/^\d+\. (.*$)/gim, '<li style="margin-left: 16px !important; list-style: decimal !important; color: #e5e7eb !important; margin-bottom: 4px !important;">$1</li>')

    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color: #60a5fa !important; text-decoration: underline !important;" target="_blank" rel="noopener noreferrer">$1</a>')

    // Line breaks
    .replace(/\n\n/g, '</p><p style="color: #e5e7eb !important; margin-bottom: 8px !important;">')
    .replace(/\n/g, '<br>');

  // Wrap in paragraph tags if content exists
  if (html.trim()) {
    html = '<p style="color: #e5e7eb !important; margin-bottom: 8px !important;">' + html + '</p>';
  }

  // Wrap consecutive list items in ul/ol tags
  html = html.replace(/(<li[^>]*list-style: disc[^>]*>.*?<\/li>)+/g, '<ul style="margin-bottom: 8px !important;">$&</ul>');
  html = html.replace(/(<li[^>]*list-style: decimal[^>]*>.*?<\/li>)+/g, '<ol style="margin-bottom: 8px !important;">$&</ol>');

  return html;
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
    // Convert full accumulated text to HTML and replace content
    contentArea.innerHTML = markdownToHtml(text);
    responseDiv.scrollTop = responseDiv.scrollHeight;
  }
}

// Inject the CSS file (JS is loaded via manifest)
injectCSS(chrome.runtime.getURL("extension/dist/style.css"));
