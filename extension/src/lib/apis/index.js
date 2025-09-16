export const getModels = async (key, url) => {
  try {
    // Use direct chrome API since we're running as content script
    if (typeof chrome === 'undefined' || !chrome.runtime) {
      throw new Error('Chrome extension API not available');
    }

    const response = await chrome.runtime.sendMessage({
      action: "fetchModels",
      key: key,
      url: url
    });

    if (!response.success) {
      throw new Error(response.error);
    }

    let models = response.data?.data ?? [];

    models = models
      .filter((models) => models)
      .sort((a, b) => {
        // Compare case-insensitively
        const lowerA = a.name.toLowerCase();
        const lowerB = b.name.toLowerCase();

        if (lowerA < lowerB) return -1;
        if (lowerA > lowerB) return 1;

        // If same case-insensitively, sort by original strings,
        // lowercase will come before uppercase due to ASCII values
        if (a < b) return -1;
        if (a > b) return 1;

        return 0; // They are equal
      });

    console.log(models);
    return models;
  } catch (error) {
    console.log(error);
    throw error;
  }
};

export const generateOpenAIChatCompletion = async (
  api_key = "",
  body = {},
  url = "http://localhost:8080"
) => {
  const controller = new AbortController();
  let error = null;

  const res = await fetch(`${url}/chat/completions`, {
    signal: controller.signal,
    method: "POST",
    headers: {
      Authorization: `Bearer ${api_key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }).catch((err) => {
    console.log(err);
    error = err;
    return null;
  });

  if (error) {
    throw error;
  }

  return [res, controller];
};

export const getPageContent = async () => {
  try {
    // Use chrome runtime API to request page content extraction
    if (typeof chrome === 'undefined' || !chrome.runtime) {
      throw new Error('Chrome extension API not available');
    }

    const response = await chrome.runtime.sendMessage({
      action: "getPageContent"
    });

    if (!response.success) {
      throw new Error(response.error);
    }

    return response.data;
  } catch (error) {
    console.error('Error getting page content:', error);
    throw error;
  }
};
