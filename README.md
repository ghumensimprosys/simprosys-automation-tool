# Simprosys Testing Tool

An AI-powered UI test automation tool using plain English commands — powered by a local LLM (Ollama) and Playwright.

## Getting Started

Make sure Ollama is running with the `qwen2.5-coder:14b` model:

```bash
ollama serve
```

Then start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Features

- Write UI tests in plain English
- Powered by a **local LLM** (no cloud API, no quota limits)
- Playwright-based headless browser execution
- Elements Explorer, Custom Rules, Test Data variables
- Live execution logs and final screenshot

## Tech Stack

- **Frontend**: Next.js 16, React 19, TypeScript
- **AI**: Ollama (`qwen2.5-coder:14b`) running locally on Apple Silicon
- **Browser Automation**: Playwright (Chromium)

## Configuration

Edit `.env.local` to change the local model:

```env
OLLAMA_MODEL=qwen2.5-coder:14b
OLLAMA_BASE_URL=http://localhost:11434
```
