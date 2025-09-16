# Open WebUI Chrome Extension 👋

A powerful Chrome extension that provides a spotlight-style search interface for Open WebUI with context-aware query capabilities. Ask questions about any webpage content and get relevant AI responses without leaving your current page.

![Extension Demo](./demo.gif)

## ✨ Features

### 🔍 Spotlight Search Interface
- **Quick Access**: Use `Cmd/Ctrl+Shift+Space` to open the search interface anywhere
- **Universal Search**: Works on any website or webpage
- **Elegant UI**: Clean, modal-style interface with backdrop blur effects

### 🧠 Context-Aware Queries ⭐ *New*
- **Page Content Analysis**: Automatically extracts and analyzes current webpage content
- **Smart Context Toggle**: "Ask about this page" toggle to enable/disable context-aware queries
- **Intelligent Content Extraction**: Extracts page title, meta description, main content, and selected text
- **Content Filtering**: Removes navigation, ads, and other noise for cleaner context

### 💬 Inline AI Responses ⭐ *New*
- **Real-time Streaming**: See AI responses appear in real-time without leaving the page
- **Copy & Share**: One-click copy functionality for AI responses
- **Scrollable Interface**: Handles long responses with proper scrolling
- **Visual Feedback**: Loading indicators and streaming status

### 🛠 Advanced Error Handling ⭐ *New*
- **Smart Recovery**: Multiple retry options when operations fail
- **Error Classification**: Categorizes network, API, and content extraction errors
- **Graceful Fallbacks**: Always provides alternative ways to complete your query
- **Timeout Protection**: Prevents hanging operations with intelligent timeouts

### ⚡ Direct Text Completion
- **Quick Enhancement**: Use `Cmd/Ctrl+Shift+Enter` to enhance selected text
- **In-place Editing**: AI responses are written directly to input fields
- **Smart Detection**: Automatically finds and targets the appropriate input field

### ⚙️ Flexible Configuration
- **Multiple Endpoints**: Support for both OpenAI and Ollama APIs
- **Model Selection**: Choose from available models on your Open WebUI instance
- **Persistent Settings**: Configuration saved automatically across sessions

## 🚀 Getting Started

### Prerequisites
- Chrome browser (or Chromium-based browser)
- Open WebUI instance running locally or remotely
- Valid API key for your Open WebUI instance

### Installation
1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension directory
5. The extension icon should appear in your browser toolbar

### Initial Setup
1. Press `Cmd/Ctrl+Shift+Space` to open the extension
2. Configure your Open WebUI settings:
   - **URL**: Your Open WebUI instance URL (e.g., `http://localhost:8080`)
   - **API Key**: Your Open WebUI API key
   - **Model**: Select from available models after connecting

## 📖 Usage Guide

### Context-Aware Queries
1. **Enable Context**: Make sure "Ask about this page" toggle is checked (enabled by default)
2. **Ask Questions**: Type questions about the current webpage content
3. **Get Answers**: Receive AI responses that reference the page content
4. **Example**: On a news article, ask "What are the key points?" or "Summarize this article"

### Standard Queries
1. **Disable Context**: Uncheck "Ask about this page" toggle
2. **General Questions**: Ask any general question or search query
3. **Opens New Tab**: Redirects to Open WebUI in a new tab (original behavior)

### Direct Text Enhancement
1. **Select Text**: Highlight any text on a webpage
2. **Trigger Enhancement**: Press `Cmd/Ctrl+Shift+Enter`
3. **Get Results**: AI enhancement appears directly in the nearest input field

### Error Recovery
If something goes wrong:
- **Retry with Context**: Try the same operation again
- **Retry without Context**: Disable page context and retry
- **Open in New Tab**: Fall back to standard Open WebUI interface
- **Check Settings**: Verify your URL, API key, and model selection

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+Shift+Space` | Open/close spotlight search |
| `Cmd/Ctrl+Shift+Enter` | Enhance selected text |
| `Escape` | Close response/error → Close modal |
| `Cmd/Ctrl+Shift+Escape` | Reset extension configuration |

## 🔧 Development

### Project Structure
```
/
├── manifest.json          # Chrome extension manifest
├── background.js           # Service worker & message handling
├── content.js             # Content script injection
└── extension/             # Svelte application
    ├── src/
    │   ├── App.svelte
    │   ├── lib/
    │   │   ├── components/
    │   │   │   └── SpotlightSearch.svelte
    │   │   ├── apis/
    │   │   └── utils/
    │   └── ...
    └── dist/              # Built extension files
```

### Build Commands
```bash
cd extension/
npm install          # Install dependencies
npm run dev          # Development with hot reload
npm run build        # Production build
npm run preview      # Preview production build
```

### Architecture Notes
- **Dual Structure**: Chrome extension + Svelte app
- **Message Passing**: Background ↔ Content ↔ Svelte communication
- **Content Extraction**: Smart page analysis with noise filtering
- **Streaming Support**: Real-time AI response streaming
- **Error Resilience**: Comprehensive error handling and recovery

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built for the [Open WebUI](https://github.com/open-webui/open-webui) ecosystem
- Uses [Svelte](https://svelte.dev/) for the user interface
- Styled with [Tailwind CSS](https://tailwindcss.com/)
