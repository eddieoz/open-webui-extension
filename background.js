chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  console.log(request, sender);
  const id = sender.tab.id;

  if (request.action == "getSelection") {
    chrome.scripting
      .executeScript({
        target: { tabId: id, allFrames: true },
        func: () => {
          return window.getSelection().toString();
        },
      })
      .then((res) => {
        console.log(res);
        sendResponse({ data: res[0]["result"] });
      });
  } else if (request.action == "writeText") {
    function writeTextToInput(text) {
      // Try to find the active element first
      let targetElement = document.activeElement;

      // If no active element or it's not an input, try to find any focused input
      if (!targetElement || (targetElement.tagName !== "INPUT" && targetElement.tagName !== "TEXTAREA")) {
        // Look for any visible input or textarea that might be focused
        const inputs = document.querySelectorAll('input[type="text"], input[type="search"], input:not([type]), textarea');
        for (const input of inputs) {
          if (input.offsetParent !== null && !input.disabled && !input.readOnly) {
            targetElement = input;
            input.focus(); // Focus it
            break;
          }
        }
      }

      if (
        targetElement &&
        (targetElement.tagName === "INPUT" || targetElement.tagName === "TEXTAREA")
      ) {
        // Set cursor to end and append text
        const currentValue = targetElement.value;
        targetElement.value = currentValue + text;

        // Trigger input events to notify any listeners
        targetElement.dispatchEvent(new Event('input', { bubbles: true }));
        targetElement.dispatchEvent(new Event('change', { bubbles: true }));

        if (targetElement.tagName === "TEXTAREA") {
          targetElement.scrollTop = targetElement.scrollHeight;
        }

        // Set cursor to end
        targetElement.setSelectionRange(targetElement.value.length, targetElement.value.length);
      } else {
        console.log("AI Response (no input field):", text);
      }
    }
    chrome.scripting.executeScript({
      target: { tabId: id, allFrames: true },
      func: writeTextToInput,
      args: [request.text],
    });
    sendResponse({});
  } else if (request.action == "fetchModels") {
    // Handle API calls from background script
    fetch(`${request.url}/api/models`, {
      headers: {
        'Authorization': `Bearer ${request.key}`
      }
    })
    .then(response => response.json())
    .then(data => sendResponse({ success: true, data }))
    .catch(error => sendResponse({ success: false, error: error.message }));
  } else if (request.action == "fetchCompletion") {
    // Handle streaming chat completion API calls
    const endpoint = request.isOpenAI
      ? `${request.url}/openai/chat/completions`
      : `${request.url}/ollama/v1/chat/completions`;

    const isInlineMode = request.inlineMode ?? false;

    fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${request.key}`
      },
      body: JSON.stringify(request.payload)
    })
    .then(async response => {
      if (response.ok) {
        // Handle streaming response
        const reader = response.body
          .pipeThrough(new TextDecoderStream())
          .getReader();

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          // Split by newlines to handle multiple data chunks
          const lines = value.split('\n');
          for (const line of lines) {
            if (line.trim() === '') continue;

            if (line === 'data: [DONE]') {
              // Send completion message to content script
              chrome.tabs.sendMessage(sender.tab.id, {
                action: isInlineMode ? 'streamComplete' : 'contextStreamComplete'
              });
              break;
            } else if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.replace(/^data: /, ''));
                if (data.choices && data.choices[0] && data.choices[0].delta && data.choices[0].delta.content) {
                  // Send each chunk to content script with different action based on mode
                  chrome.tabs.sendMessage(sender.tab.id, {
                    action: isInlineMode ? 'streamChunk' : 'contextStreamChunk',
                    text: data.choices[0].delta.content
                  });
                }
              } catch (e) {
                console.log('Parse error:', e);
              }
            }
          }
        }
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: `Request failed: ${response.status}` });
      }
    })
    .catch(error => {
      console.error('Background fetch error:', error);
      sendResponse({ success: false, error: error.message });
    });
  } else if (request.action == "getPageContent") {
    // Extract page content for context-aware queries
    chrome.scripting.executeScript({
      target: { tabId: id, allFrames: false },
      func: extractPageContent,
    })
    .then((res) => {
      console.log('Page content extracted:', res[0]["result"]);
      sendResponse({ success: true, data: res[0]["result"] });
    })
    .catch((error) => {
      console.error('Content extraction error:', error);
      sendResponse({ success: false, error: error.message });
    });
  } else {
    sendResponse({});
  }

  return true;
});

// Page content extraction function (injected into target tab)
function extractPageContent() {
  const MAX_CONTENT_LENGTH = 4000;

  try {
    // Helper function to clean text
    function cleanText(text) {
      return text
        .replace(/\s+/g, ' ')
        .replace(/\n\s*\n/g, '\n')
        .trim();
    }

    // Helper function to get meta description
    function getMetaDescription() {
      const metaDesc = document.querySelector('meta[name="description"]');
      return metaDesc ? metaDesc.getAttribute('content') : '';
    }

    // Helper function to extract main content
    function extractMainContent() {
      // Define content selectors in order of preference
      const contentSelectors = [
        'article',
        'main',
        '[role="main"]',
        '.content',
        '#content',
        '.post-content',
        '.entry-content',
        '.article-content',
        '.page-content',
        '.post',
        '.entry',
        'body'
      ];

      // Elements to exclude from content
      const excludeSelectors = [
        'nav', 'header', 'footer', 'aside', '.sidebar', '.navigation',
        '.menu', '.nav', '.breadcrumb', '.pagination', '.social-share',
        '.comments', '.related-posts', '.advertisement', '.ad', '.ads',
        '.cookie-banner', '.newsletter', '.popup', '.modal', 'script',
        'style', 'noscript', '.sr-only', '.visually-hidden'
      ];

      let contentElement = null;

      // Find the best content container
      for (const selector of contentSelectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent.trim().length > 100) {
          contentElement = element;
          break;
        }
      }

      if (!contentElement) {
        return 'No suitable content found on this page.';
      }

      // Clone the element to avoid modifying the original
      const clonedElement = contentElement.cloneNode(true);

      // Remove excluded elements
      excludeSelectors.forEach(selector => {
        const elements = clonedElement.querySelectorAll(selector);
        elements.forEach(el => el.remove());
      });

      // Extract text content
      let content = clonedElement.textContent || '';
      content = cleanText(content);

      // If content is too long, truncate intelligently
      if (content.length > MAX_CONTENT_LENGTH) {
        // Try to cut at sentence boundary
        const truncated = content.substring(0, MAX_CONTENT_LENGTH);
        const lastSentence = Math.max(
          truncated.lastIndexOf('.'),
          truncated.lastIndexOf('!'),
          truncated.lastIndexOf('?')
        );

        if (lastSentence > MAX_CONTENT_LENGTH * 0.7) {
          content = truncated.substring(0, lastSentence + 1);
        } else {
          content = truncated + '...';
        }
      }

      return content;
    }

    // Get page information
    const title = document.title || '';
    const url = window.location.href;
    const metaDescription = getMetaDescription();
    const mainContent = extractMainContent();
    const selectedText = window.getSelection().toString();

    // Construct result
    const result = {
      title: cleanText(title),
      url: url,
      metaDescription: cleanText(metaDescription),
      mainContent: mainContent,
      selectedText: cleanText(selectedText),
      contentLength: mainContent.length,
      timestamp: new Date().toISOString(),
      domain: window.location.hostname
    };

    console.log('Content extraction result:', {
      title: result.title,
      domain: result.domain,
      contentLength: result.contentLength,
      hasSelection: !!result.selectedText,
      hasMetaDescription: !!result.metaDescription
    });

    return result;

  } catch (error) {
    console.error('Content extraction error:', error);
    return {
      title: document.title || 'Untitled Page',
      url: window.location.href,
      metaDescription: '',
      mainContent: 'Error extracting page content: ' + error.message,
      selectedText: window.getSelection().toString(),
      contentLength: 0,
      timestamp: new Date().toISOString(),
      domain: window.location.hostname,
      error: error.message
    };
  }
}
