# NeuraDocs - Intelligent Document Assistant

An AI-powered document interaction system that helps users understand and extract insights from PDF documents.

## Features

- **Upload & Process PDF Documents** – Upload any PDF and extract its content
- **Document-based Q&A Chat** – Ask questions about your document with context-aware responses
- **Multi-level Document Summarization** – Concise, Standard, and Detailed summary modes
- **Voice-based Query Interaction** – Use your microphone to ask questions hands-free
- **Download AI responses as PDF** – Export chat, summary, and voice responses

## Tech Stack

Python | Flask | HTML | CSS | JavaScript | Google Gemini API | PyPDF2 | ReportLab

## Setup Instructions

### 1. Install dependencies
```bash
pip install -r requirements.txt
```

### 2. Set your Google Gemini API key
Get a free API key from https://aihub.google.com/

**Linux/Mac:**
```bash
export GEMINI_API_KEY=your_api_key_here
```

**Windows:**
```cmd
set GEMINI_API_KEY=your_api_key_here
```

### 3. Run the application
```bash
python app.py
```

### 4. Open in browser
Navigate to: http://localhost:5000

## Usage

1. **Home** – Upload a PDF document (drag & drop or browse)
2. **Chat** – Type questions about your document
3. **Summary** – Get Concise / Standard / Detailed summaries
4. **Voice** – Click the microphone and speak your question

> **Note:** Without a Gemini API key, the app runs in demo mode with placeholder responses.

## Privacy

All uploaded and generated files are automatically deleted within 10 minutes.
