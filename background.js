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
                action: 'streamComplete'
              });
              break;
            } else if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.replace(/^data: /, ''));
                if (data.choices && data.choices[0] && data.choices[0].delta && data.choices[0].delta.content) {
                  // Send each chunk to content script
                  chrome.tabs.sendMessage(sender.tab.id, {
                    action: 'streamChunk',
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
  } else {
    sendResponse({});
  }

  return true;
});
