<script lang="ts">
  import { onMount } from "svelte";
  import { generateOpenAIChatCompletion, getModels, getPageContent } from "../apis";
  import { splitStream } from "../utils";

  let show = false;
  let showConfig = true;

  let url = "";
  let key = "";
  let model = "";

  let searchValue = "";
  let models = [];
  let includePageContext = true; // Default to enabled for context-aware queries

  // Response handling state
  let isStreaming = false;
  let streamingResponse = "";
  let showResponse = false;
  let errorState = null;
  let showRetryOptions = false;

  // Save toggle state when it changes (reactive statement)
  $: if (typeof includePageContext !== 'undefined') {
    try {
      chrome.storage.local.set({ includePageContext: includePageContext });
    } catch (error) {
      localStorage.setItem("includePageContext", includePageContext.toString());
    }
  }

  const resetConfig = () => {
    console.log("resetConfig");

    try {
      chrome.storage.local.clear().then(() => {
        console.log("Value is cleared");
      });
    } catch (error) {
      console.log(error);

      localStorage.setItem("url", "");
      localStorage.setItem("key", "");
      localStorage.setItem("model", "");
      localStorage.setItem("includePageContext", "true");
    }

    url = "";
    key = "";
    model = "";
    models = [];
    includePageContext = true; // Reset to default enabled state
    showConfig = true;

    // Reset response state
    showResponse = false;
    streamingResponse = "";
    isStreaming = false;
    errorState = null;
    showRetryOptions = false;
  };

  const submitHandler = async (e) => {
    e.preventDefault();

    if (!searchValue.trim()) {
      return;
    }

    // If context is disabled, use the existing behavior (open new tab with web search enabled)
    if (!includePageContext) {
      const openWebUIURL = `${url}/?q=${encodeURIComponent(searchValue)}&models=${model}&web-search=true`;
      console.log("🔗 Opening Open WebUI in new tab with web search enabled:", {
        url: url,
        searchValue: searchValue,
        model: model,
        fullURL: openWebUIURL
      });
      window.open(openWebUIURL, "_blank");
      searchValue = "";
      show = false;
      return;
    }

    // Context-aware query processing
    try {
      isStreaming = true;
      showResponse = true;
      streamingResponse = "";
      errorState = null;
      showRetryOptions = false;

      let pageContent = null;
      let contentExtractionFailed = false;

      // Extract page content with enhanced error handling
      try {
        console.log("📄 Extracting page content...");
        pageContent = await Promise.race([
          getPageContent(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Content extraction timeout")), 10000)
          )
        ]);
        console.log("✅ Page content extracted successfully");
      } catch (contentError) {
        console.warn("⚠️ Content extraction failed:", contentError);
        contentExtractionFailed = true;

        // Show user-friendly error and retry options
        errorState = {
          type: 'content_extraction',
          message: 'Unable to extract page content',
          details: contentError.message,
          canRetryWithoutContext: true
        };

        streamingResponse = `Unable to extract page content: ${contentError.message}\n\nYou can try again without page context, or retry with context.`;
        isStreaming = false;
        showRetryOptions = true;
        return;
      }

      // Create context-aware prompt
      const contextPrompt = createContextPrompt(searchValue, pageContent);

      console.log("🚀 Starting context-aware completion:", {
        userQuery: searchValue,
        hasContext: !!pageContent,
        contextLength: pageContent?.mainContent?.length || 0
      });

      // Use background script for API call with timeout handling
      const completionResult = await Promise.race([
        chrome.runtime.sendMessage({
          action: "fetchCompletion",
          url: url,
          key: key,
          isOpenAI: models.find((m) => m.id === model)?.owned_by === "openai" ?? false,
          inlineMode: false, // Don't write inline for content-aware queries
          payload: {
            model: model,
            messages: [
              {
                role: "system",
                content: "You are a helpful assistant. When provided with page context, use it to give more relevant and specific answers to the user's questions."
              },
              {
                role: "user",
                content: contextPrompt
              }
            ],
            stream: true,
          }
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("API request timeout")), 30000)
        )
      ]);

      if (!completionResult.success) {
        throw new Error(completionResult.error);
      }

    } catch (error) {
      console.error("❌ Context-aware query failed:", error);

      // Determine error type and provide appropriate handling
      const isNetworkError = error.message.includes('timeout') ||
                            error.message.includes('network') ||
                            error.message.includes('fetch');

      const isAPIError = error.message.includes('API') ||
                        error.message.includes('unauthorized') ||
                        error.message.includes('400') ||
                        error.message.includes('401') ||
                        error.message.includes('500');

      if (isNetworkError) {
        errorState = {
          type: 'network',
          message: 'Network connection issue',
          details: error.message,
          canRetry: true,
          canRetryWithoutContext: true
        };
        streamingResponse = `Network Error: ${error.message}\n\nThis might be due to:\n• Poor internet connection\n• Server is temporarily unavailable\n• Request timeout\n\nYou can retry or try without page context.`;
      } else if (isAPIError) {
        errorState = {
          type: 'api',
          message: 'AI service unavailable',
          details: error.message,
          canRetry: true,
          canRetryWithoutContext: true
        };
        streamingResponse = `API Error: ${error.message}\n\nThis might be due to:\n• Invalid API key or configuration\n• Server maintenance\n• Rate limiting\n\nPlease check your settings or try again later.`;
      } else {
        errorState = {
          type: 'unknown',
          message: 'Unexpected error occurred',
          details: error.message,
          canRetry: true,
          canRetryWithoutContext: true
        };
        streamingResponse = `Unexpected Error: ${error.message}\n\nSomething went wrong. You can try again or use the fallback search.`;
      }

      isStreaming = false;
      showRetryOptions = true;

      console.error("🐛 Error details:", {
        type: errorState.type,
        message: errorState.message,
        details: errorState.details,
        timestamp: new Date().toISOString()
      });
    }
  };

  // Create context-aware prompt template
  const createContextPrompt = (userQuery, pageContent) => {
    let prompt = "";

    if (pageContent) {
      prompt += `Context: Page Title: ${pageContent.title || 'Untitled'}\n`;
      prompt += `URL: ${pageContent.url}\n`;

      if (pageContent.metaDescription) {
        prompt += `Description: ${pageContent.metaDescription}\n`;
      }

      if (pageContent.selectedText) {
        prompt += `Selected Text: ${pageContent.selectedText}\n`;
      }

      prompt += `Content: ${pageContent.mainContent || 'No content available'}\n\n`;
    }

    prompt += `User Question: ${userQuery}\n\n`;

    if (pageContent) {
      prompt += `Please answer the user's question based on the provided page context. If the context is not relevant to the question, you can provide a general answer but mention that the context may not be directly related.`;
    }

    return prompt;
  };

  // Retry functions for error recovery
  const retryWithContext = async () => {
    console.log("🔄 Retrying with context...");
    errorState = null;
    showRetryOptions = false;
    await submitHandler({ preventDefault: () => {} });
  };

  const retryWithoutContext = async () => {
    console.log("🔄 Retrying without context...");
    const originalToggleState = includePageContext;
    includePageContext = false;
    errorState = null;
    showRetryOptions = false;

    try {
      await submitHandler({ preventDefault: () => {} });
    } finally {
      // Restore original toggle state
      includePageContext = originalToggleState;
    }
  };

  const fallbackToSearch = () => {
    console.log("🔄 Falling back to normal search with web search enabled...");
    window.open(
      `${url}/?q=${encodeURIComponent(searchValue)}&models=${model}&web-search=true`,
      "_blank"
    );
    searchValue = "";
    show = false;
    showResponse = false;
    streamingResponse = "";
    errorState = null;
    showRetryOptions = false;
  };

  // Test function for content extraction and prompt creation
  const testContentExtraction = async () => {
    try {
      console.log("🧪 Testing content extraction and context-aware prompt...");
      console.log("📋 Toggle State:", {
        includePageContext: includePageContext,
        placeholder: includePageContext ? 'Ask about this page...' : 'Search Open WebUI'
      });

      const content = await getPageContent();
      console.log("✅ Content extracted successfully:", content);

      // Test prompt creation
      const testQuery = "What is this page about?";
      const testPrompt = createContextPrompt(testQuery, content);
      console.log("📝 Context-aware prompt created:", testPrompt);

      // Display a summary in the console
      console.log("📊 Content Summary:", {
        title: content.title,
        domain: content.domain,
        contentLength: content.contentLength,
        hasMetaDescription: !!content.metaDescription,
        hasSelectedText: !!content.selectedText,
        timestamp: content.timestamp,
        promptLength: testPrompt.length
      });

      alert(`Content extraction & prompt creation successful!\n\nToggle State: ${includePageContext ? 'Enabled' : 'Disabled'}\nTitle: ${content.title}\nDomain: ${content.domain}\nContent Length: ${content.contentLength} chars\nPrompt Length: ${testPrompt.length} chars\n\nCheck console for full details including the generated prompt.`);
    } catch (error) {
      console.error("❌ Content extraction failed:", error);
      alert(`Content extraction failed: ${error.message}`);
    }
  };

  const initHandler = (e) => {
    e.preventDefault();

    try {
      chrome.storage.local
        .set({ url: url, key: key, model: model, includePageContext: includePageContext })
        .then(() => {
          console.log("Value is set");
        });
    } catch (error) {
      console.log(error);

      localStorage.setItem("url", url);
      localStorage.setItem("key", key);
      localStorage.setItem("model", model);
      localStorage.setItem("includePageContext", includePageContext.toString());
    }

    showConfig = false;
  };

  onMount(async () => {
    let _storageCache = null;

    try {
      _storageCache = await chrome.storage.local.get();
    } catch (error) {
      console.log(error);
    }

    // Listen for streaming messages from background script
    const messageListener = (message) => {
      if (message.action === 'contextStreamChunk') {
        streamingResponse += message.text;
      } else if (message.action === 'contextStreamComplete') {
        console.log('🏁 Context-aware stream completed');
        isStreaming = false;
      }
    };

    try {
      chrome.runtime.onMessage.addListener(messageListener);
    } catch (error) {
      console.log("Failed to add message listener:", error);
    }

    if (_storageCache) {
      url = _storageCache.url ?? "";
      key = _storageCache.key ?? "";
      model = _storageCache.model ?? "";
      includePageContext = _storageCache.includePageContext ?? true; // Default to enabled

      if (_storageCache.url && _storageCache.key && _storageCache.model) {
        models = await getModels(_storageCache.key, _storageCache.url).catch(
          (error) => {
            console.log(error);
            resetConfig();
          }
        );

        if (models) {
          showConfig = false;
        }
      }
    }

    const down = async (e) => {
      // Reset the configuration when ⌘Shift+Escape is pressed
      if (show && e.shiftKey && e.key === "Escape") {
        resetConfig();
      } else if (e.key === "Escape") {
        if (showResponse || showRetryOptions) {
          // First escape clears the response/error
          showResponse = false;
          streamingResponse = "";
          isStreaming = false;
          errorState = null;
          showRetryOptions = false;
        } else {
          // Second escape closes the modal
          show = false;
        }
      }

      if (
        e.key === " " &&
        (e.metaKey || e.ctrlKey) &&
        (e.shiftKey || e.altKey)
      ) {
        console.log("🔧 Search shortcut triggered");
        e.preventDefault();
        try {
          const response = await chrome.runtime.sendMessage({
            action: "getSelection",
          });

          if (response?.data ?? false) {
            searchValue = response.data;
          }
        } catch (error) {
          console.log("catch", error);
        }

        show = !show;

        // console.log("toggle", show, searchValue);

        setTimeout(() => {
          const inputElement = document.getElementById(
            "open-webui-search-input"
          );

          if (inputElement) {
            inputElement.focus();
          }
        }, 0);
      }

      if (key !== "" && url !== "") {
        if (
          e.key === "Enter" &&
          (e.metaKey || e.ctrlKey) &&
          (e.shiftKey || e.altKey)
        ) {
          e.preventDefault();

          try {
            console.log("🔧 Direct completion triggered");

            const response = await chrome.runtime.sendMessage({
              action: "getSelection",
            });

            console.log("📝 Selected text:", response?.data);

            if (response?.data ?? false) {
              console.log("✅ Text selected, starting AI completion");

              await chrome.runtime.sendMessage({
                action: "writeText",
                text: "\n",
              });

              console.log("🌐 Using background script for API call");

              // Use background script to avoid ad blocker issues
              const completionResult = await chrome.runtime.sendMessage({
                action: "fetchCompletion",
                url: url,
                key: key,
                isOpenAI: models.find((m) => m.id === model)?.owned_by === "openai" ?? false,
                inlineMode: true, // Write inline for direct completion
                payload: {
                  model: model,
                  messages: [
                    {
                      role: "system",
                      content: "You are a helpful assistant.",
                    },
                    {
                      role: "user",
                      content: response.data,
                    },
                  ],
                  stream: true,
                }
              });

              if (completionResult.success) {
                console.log("🚀 Background streaming started");
              } else {
                console.error("❌ Background request failed:", completionResult.error);
                await chrome.runtime.sendMessage({
                  action: "writeText",
                  text: `Error: ${completionResult.error}`,
                });
              }
            } else {
              console.log("⚠️ No text selected, extracting page content for summarization");

              try {
                // Extract page content for summarization
                const pageContentResult = await chrome.runtime.sendMessage({
                  action: "getPageContent",
                });

                if (pageContentResult.success && pageContentResult.data) {
                  const pageContent = pageContentResult.data;
                  console.log("📄 Page content extracted for summarization");

                  await chrome.runtime.sendMessage({
                    action: "writeText",
                    text: "\n",
                  });

                  // Create summarization prompt
                  const summaryPrompt = `Task: Summarize the following article. Length: 3-5 sentences. Format: Markdown. Requirements: capture the main ideas and key points; easy to understand; summary should be free from ambiguity.

Page Title: ${pageContent.title || 'Untitled'}
URL: ${pageContent.url}
${pageContent.metaDescription ? `Description: ${pageContent.metaDescription}\n` : ''}
Content: ${pageContent.mainContent || 'No content available'}`;

                  // Use background script for API call
                  const completionResult = await chrome.runtime.sendMessage({
                    action: "fetchCompletion",
                    url: url,
                    key: key,
                    isOpenAI: models.find((m) => m.id === model)?.owned_by === "openai" ?? false,
                    inlineMode: true, // Write inline for page summarization
                    payload: {
                      model: model,
                      messages: [
                        {
                          role: "system",
                          content: "You are a helpful assistant that provides clear and concise summaries of web pages.",
                        },
                        {
                          role: "user",
                          content: summaryPrompt,
                        },
                      ],
                      stream: true,
                    }
                  });

                  if (completionResult.success) {
                    console.log("🚀 Page summarization started");
                  } else {
                    console.error("❌ Page summarization failed:", completionResult.error);
                    await chrome.runtime.sendMessage({
                      action: "writeText",
                      text: `Error: ${completionResult.error}`,
                    });
                  }
                } else {
                  console.error("❌ Failed to extract page content:", pageContentResult.error);
                  await chrome.runtime.sendMessage({
                    action: "writeText",
                    text: `Error extracting page content: ${pageContentResult.error || 'Unknown error'}`,
                  });
                }
              } catch (contentError) {
                console.error("💥 Page content extraction error:", contentError);
                await chrome.runtime.sendMessage({
                  action: "writeText",
                  text: `Error extracting page content: ${contentError.message}`,
                });
              }
            }
          } catch (error) {
            console.error("💥 Completion error:", error);
            try {
              await chrome.runtime.sendMessage({
                action: "writeText",
                text: `Error: ${error.message}`,
              });
            } catch (e) {
              console.error("Failed to send error message:", e);
            }
          }
        }
      }
    };

    document.addEventListener("keydown", down, { capture: true });

    return () => {
      document.removeEventListener("keydown", down);
      try {
        chrome.runtime.onMessage.removeListener(messageListener);
      } catch (error) {
        console.log("Failed to remove message listener:", error);
      }
    };
  });
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
{#if show}
  <div
    class="tlwd-fixed tlwd-top-0 tlwd-right-0 tlwd-left-0 tlwd-bottom-0 tlwd-w-full tlwd-min-h-screen tlwd-h-screen tlwd-flex tlwd-justify-center tlwd-z-[9999999999] tlwd-overflow-hidden tlwd-overscroll-contain"
    on:mousedown={() => {
      show = false;
    }}
  >
    {#if showConfig}
      <div class=" tlwd-m-auto tlwd-max-w-sm tlwd-w-full tlwd-pb-32">
        <div
          class="tlwd-w-full tlwd-flex tlwd-flex-col tlwd-justify-between tlwd-py-2.5 tlwd-px-3.5 tlwd-rounded-2xl tlwd-outline tlwd-outline-1 tlwd-outline-gray-850 tlwd-backdrop-blur-3xl tlwd-bg-gray-850/70 shadow-4xl modal-animation"
        >
          <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
          <form
            class="tlwd-text-gray-200 tlwd-w-full tlwd-p-0 tlwd-m-0"
            on:submit={initHandler}
            on:mousedown={(e) => {
              e.stopPropagation();
            }}
            autocomplete="off"
          >
            <div class="tlwd-flex tlwd-items-center tlwd-gap-2 tlwd-w-full">
              <div class=" tlwd-flex tlwd-items-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width={2.5}
                  stroke="currentColor"
                  class="tlwd-size-5"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
                  />
                </svg>
              </div>
              <input
                id="open-webui-url-input"
                placeholder="Open WebUI URL"
                class="tlwd-p-0 tlwd-m-0 tlwd-text-xl tlwd-w-full tlwd-font-medium tlwd-bg-transparent tlwd-border-none placeholder:tlwd-text-gray-500 tlwd-text-neutral-100 tlwd-outline-none"
                bind:value={url}
                autocomplete="one-time-code"
                required
              />
            </div>
            <div
              class="tlwd-flex tlwd-items-center tlwd-gap-2 tlwd-w-full tlwd-mt-2"
            >
              <div class=" tlwd-flex tlwd-items-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width={2.5}
                  stroke="currentColor"
                  class="tlwd-size-5"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z"
                  />
                </svg>
              </div>
              <input
                placeholder="Open WebUI API Key"
                class="tlwd-p-0 tlwd-m-0 tlwd-text-xl tlwd-w-full tlwd-font-medium tlwd-bg-transparent tlwd-border-none placeholder:tlwd-text-gray-500 tlwd-text-neutral-100 tlwd-outline-none"
                bind:value={key}
                autocomplete="one-time-code"
                required
              />
              <button
                class=" tlwd-flex tlwd-items-center tlwd-bg-transparent tlwd-text-neutral-100 tlwd-cursor-pointer tlwd-p-0 tlwd-m-0 tlwd-outline-none tlwd-border-none"
                type="button"
                on:click={async () => {
                  if (url.endsWith("/")) {
                    url = url.slice(0, -1);
                  }

                  models = await getModels(key, url);
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width={2.5}
                  stroke="currentColor"
                  class="tlwd-size-5"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
                  />
                </svg>
              </button>
            </div>

            {#if models && models.length > 0}
              <div
                class="tlwd-flex tlwd-items-center tlwd-gap-2 tlwd-w-full tlwd-mt-2"
              >
                <div class=" tlwd-flex tlwd-items-center">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke-width={2.5}
                    stroke="currentColor"
                    class="tlwd-size-5"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125"
                    />
                  </svg>
                </div>
                <select
                  id="open-webui-model-input"
                  class="tlwd-p-0 tlwd-m-0 tlwd-text-xl tlwd-w-full tlwd-font-medium tlwd-bg-transparent tlwd-border-none placeholder:tlwd-text-gray-500 tlwd-text-neutral-100 tlwd-outline-none"
                  bind:value={model}
                  autocomplete="off"
                  required
                >
                  <option value="">Select a model</option>
                  {#each models as model}
                    <option value={model.id}>{model.name ?? model.id}</option>
                  {/each}
                </select>
                <button
                  class=" tlwd-flex tlwd-items-center tlwd-bg-transparent tlwd-text-neutral-100 tlwd-cursor-pointer tlwd-p-0 tlwd-m-0 tlwd-outline-none tlwd-border-none"
                  type="submit"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke-width={2.5}
                    stroke="currentColor"
                    class="tlwd-size-5"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="m4.5 12.75 6 6 9-13.5"
                    />
                  </svg>
                </button>
              </div>
            {/if}
          </form>
        </div>
      </div>
    {:else}
      <div class=" tlwd-m-auto tlwd-max-w-xl tlwd-w-full tlwd-pb-32">
        <div
          class="tlwd-w-full tlwd-flex tlwd-flex-col tlwd-justify-between tlwd-py-2.5 tlwd-px-3.5 tlwd-rounded-2xl tlwd-outline tlwd-outline-1 tlwd-outline-gray-850 tlwd-backdrop-blur-3xl tlwd-bg-gray-850/70 shadow-4xl modal-animation"
        >
          <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
          <form
            class="tlwd-text-gray-200 tlwd-w-full tlwd-p-0 tlwd-m-0"
            on:submit={submitHandler}
            on:mousedown={(e) => {
              e.stopPropagation();
            }}
            autocomplete="off"
          >
            <!-- Context Toggle -->
            <div class="tlwd-flex tlwd-items-center tlwd-gap-2 tlwd-w-full tlwd-mb-3">
              <label
                class="tlwd-flex tlwd-items-center tlwd-gap-2 tlwd-cursor-pointer tlwd-text-sm tlwd-focus-within:tlwd-outline tlwd-focus-within:tlwd-outline-2 tlwd-focus-within:tlwd-outline-blue-500 tlwd-focus-within:tlwd-outline-offset-2 tlwd-rounded"
                for="context-toggle"
              >
                <input
                  id="context-toggle"
                  type="checkbox"
                  bind:checked={includePageContext}
                  class="tlwd-sr-only tlwd-focus:tlwd-ring-2 tlwd-focus:tlwd-ring-blue-500"
                  on:click={(e) => e.stopPropagation()}
                  on:keydown={(e) => {
                    if (e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      includePageContext = !includePageContext;
                    }
                  }}
                  aria-describedby="context-toggle-description"
                  aria-label="Include current page content in your question"
                />
                <div class="tlwd-relative tlwd-transition-colors tlwd-duration-200">
                  <div class="tlwd-w-4 tlwd-h-4 tlwd-rounded tlwd-border tlwd-transition-all tlwd-duration-200 {includePageContext ? 'tlwd-bg-blue-500 tlwd-border-blue-500 tlwd-shadow-sm' : 'tlwd-border-gray-400 tlwd-bg-transparent hover:tlwd-border-gray-300'}">
                    {#if includePageContext}
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke-width={3}
                        stroke="currentColor"
                        class="tlwd-w-3 tlwd-h-3 tlwd-text-white tlwd-absolute tlwd-top-0.5 tlwd-left-0.5 tlwd-transition-opacity tlwd-duration-200"
                        role="img"
                        aria-hidden="true"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          d="m4.5 12.75 6 6 9-13.5"
                        />
                      </svg>
                    {/if}
                  </div>
                </div>
                <span class="tlwd-text-neutral-300 tlwd-select-none tlwd-transition-colors tlwd-duration-200 hover:tlwd-text-neutral-200">Ask about this page</span>
                <div
                  class="tlwd-flex tlwd-items-center tlwd-ml-1"
                  id="context-toggle-description"
                  role="tooltip"
                  aria-label="When enabled, your question will include the current page's content as context for more relevant answers"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke-width={2}
                    stroke="currentColor"
                    class="tlwd-w-3 tlwd-h-3 tlwd-text-gray-500 hover:tlwd-text-gray-400 tlwd-transition-colors tlwd-duration-200"
                    aria-hidden="true"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z"
                    />
                  </svg>
                </div>
              </label>
            </div>

            <div class="tlwd-flex tlwd-items-center tlwd-gap-2 tlwd-w-full">
              <div class=" tlwd-flex tlwd-items-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width={2.5}
                  stroke="currentColor"
                  class="tlwd-size-5"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                  />
                </svg>
              </div>
              <input
                id="open-webui-search-input"
                placeholder="{includePageContext ? 'Ask about this page...' : 'Search Open WebUI'}"
                class="tlwd-p-0 tlwd-m-0 tlwd-text-xl tlwd-w-full tlwd-font-medium tlwd-bg-transparent tlwd-border-none placeholder:tlwd-text-gray-500 tlwd-text-neutral-100 tlwd-outline-none"
                bind:value={searchValue}
                autocomplete="one-time-code"
              />
            </div>

            <div
              class=" tlwd-flex tlwd-justify-end tlwd-gap-1 tlwd-items-center"
            >
              <div
                class="tlwd-text-right tlwd-text-[0.7rem] tlwd-p-0 tlwd-m-0 tlwd-text-neutral-300 tlwd-h-fit"
              >
                Press ⌘Space+Shift to toggle
              </div>
              <!-- Temporary test button for content extraction -->
              <button
                class=" tlwd-h-fit tlwd-flex tlwd-items-center tlwd-bg-transparent tlwd-text-yellow-400 tlwd-cursor-pointer tlwd-p-0 tlwd-m-0 tlwd-outline-none tlwd-border-none tlwd-mr-1"
                type="button"
                on:click={testContentExtraction}
                title="Test Content Extraction"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width={2.5}
                  stroke="currentColor"
                  class="tlwd-size-3"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 14.5M14.25 3.104c.251.023.501.05.75.082M19.8 14.5l-7.058 7.058a2.25 2.25 0 01-1.591.659H8.25a2.25 2.25 0 01-2.25-2.25V16.06a2.25 2.25 0 01.659-1.591L13.717 7.41a2.25 2.25 0 011.591-.659h2.892a2.25 2.25 0 012.25 2.25v2.892c0 .597-.237 1.17-.659 1.591z"
                  />
                </svg>
              </button>
              <button
                class=" tlwd-h-fit tlwd-flex tlwd-items-center tlwd-bg-transparent tlwd-text-neutral-100 tlwd-cursor-pointer tlwd-p-0 tlwd-m-0 tlwd-outline-none tlwd-border-none"
                type="button"
                on:click={() => {
                  showConfig = true;
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width={2.5}
                  stroke="currentColor"
                  class="tlwd-size-3"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
                  />
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                  />
                </svg>
              </button>
            </div>
          </form>

          <!-- Response Display Area -->
          {#if showResponse}
            <div class="tlwd-mt-4 tlwd-p-4 tlwd-rounded-xl tlwd-bg-gray-800/50 tlwd-backdrop-blur-sm tlwd-border tlwd-border-gray-700">
              <!-- Response Header -->
              <div class="tlwd-flex tlwd-items-center tlwd-justify-between tlwd-mb-3">
                <div class="tlwd-flex tlwd-items-center tlwd-gap-2">
                  <div class="tlwd-w-2 tlwd-h-2 tlwd-rounded-full {isStreaming ? 'tlwd-bg-blue-500 tlwd-animate-pulse' : 'tlwd-bg-green-500'}"></div>
                  <span class="tlwd-text-sm tlwd-text-gray-300">
                    {isStreaming ? 'AI is responding...' : 'Response complete'}
                  </span>
                </div>
                <div class="tlwd-flex tlwd-items-center tlwd-gap-2">
                  <!-- Copy button -->
                  <button
                    class="tlwd-p-1 tlwd-rounded tlwd-bg-transparent hover:tlwd-bg-gray-700 tlwd-text-gray-400 hover:tlwd-text-gray-200 tlwd-transition-colors tlwd-duration-200"
                    type="button"
                    on:click={() => {
                      navigator.clipboard.writeText(streamingResponse);
                    }}
                    title="Copy response"
                    disabled={!streamingResponse}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width={2} stroke="currentColor" class="tlwd-w-4 tlwd-h-4">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
                    </svg>
                  </button>
                  <!-- Close button -->
                  <button
                    class="tlwd-p-1 tlwd-rounded tlwd-bg-transparent hover:tlwd-bg-gray-700 tlwd-text-gray-400 hover:tlwd-text-gray-200 tlwd-transition-colors tlwd-duration-200"
                    type="button"
                    on:click={() => {
                      showResponse = false;
                      streamingResponse = "";
                      searchValue = "";
                      errorState = null;
                      showRetryOptions = false;
                    }}
                    title="Clear response"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width={2} stroke="currentColor" class="tlwd-w-4 tlwd-h-4">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              <!-- Response Content -->
              <div class="tlwd-max-h-96 tlwd-overflow-y-auto tlwd-text-sm tlwd-text-gray-200 tlwd-leading-relaxed tlwd-whitespace-pre-wrap">
                {#if streamingResponse}
                  {streamingResponse}
                {:else if isStreaming}
                  <div class="tlwd-flex tlwd-items-center tlwd-gap-2 tlwd-text-gray-400">
                    <div class="tlwd-animate-spin tlwd-w-4 tlwd-h-4 tlwd-border-2 tlwd-border-gray-600 tlwd-border-t-blue-500 tlwd-rounded-full"></div>
                    Waiting for response...
                  </div>
                {:else}
                  <div class="tlwd-text-gray-500">No response yet</div>
                {/if}
              </div>

              <!-- Retry Options for Error States -->
              {#if showRetryOptions && errorState}
                <div class="tlwd-mt-4 tlwd-pt-4 tlwd-border-t tlwd-border-gray-600">
                  <div class="tlwd-text-xs tlwd-text-gray-400 tlwd-mb-3">Error Recovery Options</div>
                  <div class="tlwd-flex tlwd-flex-wrap tlwd-gap-2">
                    {#if errorState.canRetry}
                      <button
                        class="tlwd-px-3 tlwd-py-1.5 tlwd-text-xs tlwd-bg-blue-600 hover:tlwd-bg-blue-700 tlwd-text-white tlwd-rounded tlwd-transition-colors tlwd-duration-200 tlwd-flex tlwd-items-center tlwd-gap-1"
                        type="button"
                        on:click={retryWithContext}
                        disabled={isStreaming}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width={2} stroke="currentColor" class="tlwd-w-3 tlwd-h-3">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                        </svg>
                        Retry with Context
                      </button>
                    {/if}

                    {#if errorState.canRetryWithoutContext}
                      <button
                        class="tlwd-px-3 tlwd-py-1.5 tlwd-text-xs tlwd-bg-orange-600 hover:tlwd-bg-orange-700 tlwd-text-white tlwd-rounded tlwd-transition-colors tlwd-duration-200 tlwd-flex tlwd-items-center tlwd-gap-1"
                        type="button"
                        on:click={retryWithoutContext}
                        disabled={isStreaming}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width={2} stroke="currentColor" class="tlwd-w-3 tlwd-h-3">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                        </svg>
                        Retry without Context
                      </button>
                    {/if}

                    <button
                      class="tlwd-px-3 tlwd-py-1.5 tlwd-text-xs tlwd-bg-gray-600 hover:tlwd-bg-gray-700 tlwd-text-white tlwd-rounded tlwd-transition-colors tlwd-duration-200 tlwd-flex tlwd-items-center tlwd-gap-1"
                      type="button"
                      on:click={fallbackToSearch}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width={2} stroke="currentColor" class="tlwd-w-3 tlwd-h-3">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
                      </svg>
                      Open in New Tab
                    </button>
                  </div>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </div>
{/if}
