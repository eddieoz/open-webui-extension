/// <reference types="svelte" />
/// <reference types="vite/client" />

declare global {
  var chrome: {
    runtime: {
      sendMessage: (message: any) => Promise<any>;
    };
    storage: {
      local: {
        get: () => Promise<any>;
        set: (items: any) => Promise<void>;
        clear: () => Promise<void>;
      };
    };
  };
}
