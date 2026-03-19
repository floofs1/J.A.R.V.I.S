# J.A.R.V.I.S. AI Assistant - Product Requirements Document

## Overview
A Jarvis-level AI assistant mobile app with full multi-modal capabilities including text chat, voice input/output, image understanding (vision), and image generation.

## Tech Stack
- **Frontend**: Expo React Native (SDK 54) with expo-router
- **Backend**: FastAPI (Python)
- **Database**: MongoDB
- **AI Brain**: OpenAI GPT-5.2 via Emergent LLM Key
- **Voice Input**: OpenAI Whisper-1 (STT)
- **Voice Output**: OpenAI TTS-1 with Nova voice
- **Image Generation**: OpenAI GPT-Image-1
- **Image Understanding**: GPT-5.2 Vision

## Features
### Core
- [x] Multi-turn conversational AI chat (GPT-5.2)
- [x] Voice input via microphone recording → STT transcription → AI response
- [x] Text-to-Speech for AI responses (auto-speak toggle)
- [x] Image understanding (attach photo → AI analyzes it)
- [x] Image generation from text prompts
- [x] Persistent chat history with MongoDB
- [x] Multiple conversation sessions with sidebar
- [x] Auto-titling conversations based on first message

### UI/UX
- [x] Dark sci-fi JARVIS theme (Stark OS inspired)
- [x] Arc Reactor branding with capability chips
- [x] Cyan/teal accent colors with glowing borders
- [x] Responsive message bubbles (user vs AI)
- [x] Per-message TTS playback button
- [x] Voice recording pulse animation
- [x] Image generation modal
- [x] Web + Native platform support for TTS

## API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/ | Health check |
| POST | /api/conversations | Create conversation |
| GET | /api/conversations | List conversations |
| GET | /api/conversations/{id} | Get conversation + messages |
| DELETE | /api/conversations/{id} | Delete conversation |
| POST | /api/chat | Send message (text + optional image) |
| POST | /api/transcribe | Speech-to-text |
| POST | /api/tts | Text-to-speech |
| POST | /api/generate-image | Generate image from prompt |

## Future Enhancements
- Smart home / IoT control simulation
- Plugin/extension system for custom capabilities
- Multi-language support
- Conversation search & export
- Custom voice selection
- Streaming responses
