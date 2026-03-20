from fastapi import FastAPI, APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import base64
import tempfile
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timezone

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Logging setup (must be before using logger)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# LLM Key
EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY', '')

app = FastAPI()
api_router = APIRouter(prefix="/api")

# ─── Pydantic Models ───

class ConversationCreate(BaseModel):
    title: Optional[str] = "New Conversation"

class ConversationResponse(BaseModel):
    id: str
    title: str
    created_at: str
    updated_at: str
    message_count: int = 0

class MessageResponse(BaseModel):
    id: str
    conversation_id: str
    role: str
    content: str
    message_type: str = "text"
    image_base64: Optional[str] = None
    audio_base64: Optional[str] = None
    created_at: str

class ChatRequest(BaseModel):
    conversation_id: str
    message: str
    image_base64: Optional[str] = None

class ImageGenerateRequest(BaseModel):
    conversation_id: str
    prompt: str

class TTSRequest(BaseModel):
    text: str
    voice: str = "nova"

# ─── Helper Functions ───

async def get_conversation_messages(conversation_id: str, limit: int = 20):
    messages = await db.messages.find(
        {"conversation_id": conversation_id},
        {"_id": 0}
    ).sort("created_at", -1).limit(limit).to_list(limit)
    messages.reverse()
    return messages

async def save_message(conversation_id: str, role: str, content: str,
                       message_type: str = "text", image_base64: str = None,
                       audio_base64: str = None):
    msg = {
        "id": str(uuid.uuid4()),
        "conversation_id": conversation_id,
        "role": role,
        "content": content,
        "message_type": message_type,
        "image_base64": image_base64,
        "audio_base64": audio_base64,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.messages.insert_one(msg)
    await db.conversations.update_one(
        {"id": conversation_id},
        {"$set": {"updated_at": datetime.now(timezone.utc).isoformat()},
         "$inc": {"message_count": 1}}
    )
    return {k: v for k, v in msg.items() if k != "_id"}

# ─── Conversation Endpoints ───

@api_router.post("/conversations", response_model=ConversationResponse)
async def create_conversation(body: ConversationCreate):
    now = datetime.now(timezone.utc).isoformat()
    conv = {
        "id": str(uuid.uuid4()),
        "title": body.title or "New Conversation",
        "created_at": now,
        "updated_at": now,
        "message_count": 0,
    }
    await db.conversations.insert_one(conv)
    return {k: v for k, v in conv.items() if k != "_id"}

@api_router.get("/conversations", response_model=List[ConversationResponse])
async def list_conversations():
    convs = await db.conversations.find({}, {"_id": 0}).sort("updated_at", -1).to_list(100)
    return convs

@api_router.get("/conversations/{conversation_id}")
async def get_conversation(conversation_id: str):
    conv = await db.conversations.find_one({"id": conversation_id}, {"_id": 0})
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    messages = await db.messages.find(
        {"conversation_id": conversation_id}, {"_id": 0}
    ).sort("created_at", 1).to_list(1000)
    return {"conversation": conv, "messages": messages}

@api_router.delete("/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str):
    await db.conversations.delete_one({"id": conversation_id})
    await db.messages.delete_many({"conversation_id": conversation_id})
    return {"status": "deleted"}

# ─── Web Search Helper ───

async def web_search(query: str, max_results: int = 5) -> str:
    """Search the web using DuckDuckGo and return formatted results."""
    import asyncio
    from ddgs import DDGS

    def _search():
        try:
            ddgs = DDGS()
            # Try news search first for current events
            results = ddgs.news(query, max_results=max_results)
            if not results:
                # Fallback to text search
                results = ddgs.text(query, max_results=max_results)
            if not results:
                return ""
            formatted = []
            for r in results:
                title = r.get("title", "")
                body = r.get("body", "")
                source = r.get("source", "")
                href = r.get("url", r.get("href", ""))
                source_info = f" — {source}" if source else ""
                formatted.append(f"• {title}{source_info}: {body} ({href})")
            return "\n".join(formatted)
        except Exception as e:
            logger.error(f"Web search error: {e}")
            return ""

    return await asyncio.to_thread(_search)

def needs_web_search(message: str) -> bool:
    """Detect if a message likely needs real-time web data."""
    msg = message.lower()
    # Keywords that suggest real-time info is needed
    triggers = [
        "latest", "current", "today", "now", "recent", "news",
        "weather", "price", "stock", "score", "update", "happening",
        "who won", "who is winning", "results", "live", "real time",
        "search", "look up", "find out", "what is the", "how much",
        "when is", "where is", "2024", "2025", "2026", "this week",
        "this month", "this year", "yesterday", "tomorrow",
        "trending", "popular", "new release", "launched",
        "election", "championship", "game", "match",
    ]
    return any(trigger in msg for trigger in triggers)

# ─── Chat Endpoint (Text + Vision + Web Search) ───

@api_router.post("/chat")
async def chat(body: ChatRequest):
    from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent

    # Save user message
    user_msg = await save_message(
        body.conversation_id, "user", body.message,
        message_type="image" if body.image_base64 else "text",
        image_base64=body.image_base64
    )

    # Check if web search is needed
    search_context = ""
    if needs_web_search(body.message):
        logger.info(f"Web search triggered for: {body.message}")
        search_results = await web_search(body.message, max_results=5)
        if search_results:
            search_context = (
                f"\n\n[REAL-TIME WEB SEARCH RESULTS]\n"
                f"The following information was retrieved from the internet just now:\n"
                f"{search_results}\n"
                f"[END SEARCH RESULTS]\n"
            )

    system_message = (
        "You are J.A.R.V.I.S., an advanced AI assistant inspired by the iconic AI from Iron Man. "
        "You are brilliant, witty, precise, and slightly formal but warm. "
        "You address the user respectfully. You provide insightful, comprehensive answers. "
        "Keep responses concise but thorough. Use technical language when appropriate. "
        "You can analyze images when provided. Be helpful and proactive. "
        "When web search results are provided, use them to give accurate real-time information. "
        "Cite sources when using web search data. If search results are provided, prioritize that data for your answer."
    )

    chat_instance = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=body.conversation_id,
        system_message=system_message
    )
    chat_instance.with_model("openai", "gpt-5.2")

    # Build user message with optional image and search context
    message_text = body.message
    if search_context:
        message_text = f"{body.message}\n{search_context}"

    file_contents = []
    if body.image_base64:
        file_contents.append(ImageContent(image_base64=body.image_base64))

    user_message = UserMessage(text=message_text, file_contents=file_contents if file_contents else None)

    try:
        response_text = await chat_instance.send_message(user_message)
    except Exception as e:
        logger.error(f"Chat error: {e}")
        response_text = "I apologize, but I encountered an issue processing your request. Please try again."

    # Save AI response
    ai_msg = await save_message(body.conversation_id, "assistant", response_text)

    # Auto-title conversation if it's the first message
    conv = await db.conversations.find_one({"id": body.conversation_id}, {"_id": 0})
    if conv and conv.get("message_count", 0) <= 2 and conv.get("title") == "New Conversation":
        short_title = body.message[:50] + ("..." if len(body.message) > 50 else "")
        await db.conversations.update_one(
            {"id": body.conversation_id},
            {"$set": {"title": short_title}}
        )

    return {"user_message": user_msg, "ai_message": ai_msg}

# ─── Speech-to-Text Endpoint ───

@api_router.post("/transcribe")
async def transcribe_audio(audio: UploadFile = File(...)):
    from emergentintegrations.llm.openai import OpenAISpeechToText

    stt = OpenAISpeechToText(api_key=EMERGENT_LLM_KEY)

    # Save uploaded file to temp
    audio_bytes = await audio.read()
    suffix = ".webm"
    if audio.filename:
        suffix = Path(audio.filename).suffix or ".webm"

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        with open(tmp_path, "rb") as audio_file:
            response = await stt.transcribe(
                file=audio_file,
                model="whisper-1",
                response_format="json",
                language="en"
            )
        return {"text": response.text}
    except Exception as e:
        logger.error(f"Transcription error: {e}")
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")
    finally:
        os.unlink(tmp_path)

# ─── Text-to-Speech Endpoint ───

@api_router.post("/tts")
async def text_to_speech(body: TTSRequest):
    from emergentintegrations.llm.openai import OpenAITextToSpeech

    tts = OpenAITextToSpeech(api_key=EMERGENT_LLM_KEY)

    try:
        audio_base64 = await tts.generate_speech_base64(
            text=body.text,
            model="tts-1",
            voice=body.voice,
            response_format="mp3",
            speed=1.0
        )
        return {"audio_base64": audio_base64}
    except Exception as e:
        logger.error(f"TTS error: {e}")
        raise HTTPException(status_code=500, detail=f"TTS failed: {str(e)}")

# ─── Image Generation Endpoint ───

@api_router.post("/generate-image")
async def generate_image(body: ImageGenerateRequest):
    from emergentintegrations.llm.openai.image_generation import OpenAIImageGeneration
    from io import BytesIO
    from PIL import Image as PILImage

    image_gen = OpenAIImageGeneration(api_key=EMERGENT_LLM_KEY)

    # Save user message
    user_msg = await save_message(
        body.conversation_id, "user", f"Generate image: {body.prompt}",
        message_type="text"
    )

    try:
        images = await image_gen.generate_images(
            prompt=body.prompt,
            model="gpt-image-1",
            number_of_images=1
        )
        if images and len(images) > 0:
            # Compress image for mobile (resize + JPEG quality)
            img = PILImage.open(BytesIO(images[0]))
            img = img.convert("RGB")
            if img.width > 768:
                ratio = 768 / img.width
                img = img.resize((768, int(img.height * ratio)), PILImage.LANCZOS)
            buffer = BytesIO()
            img.save(buffer, format="JPEG", quality=80)
            image_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')

            ai_msg = await save_message(
                body.conversation_id, "assistant",
                f"Here's the generated image for: {body.prompt}",
                message_type="image",
                image_base64=image_base64
            )
            return {"user_message": user_msg, "ai_message": ai_msg, "image_base64": image_base64}
        else:
            raise HTTPException(status_code=500, detail="No image was generated")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Image generation error: {e}")
        error_detail = f"Image generation failed: {str(e)}"
        await save_message(
            body.conversation_id, "assistant",
            "I apologize, but I was unable to generate that image. Please try a different prompt.",
            message_type="text"
        )
        raise HTTPException(status_code=500, detail=error_detail)

# ─── Health Check ───

@api_router.get("/")
async def root():
    return {"message": "J.A.R.V.I.S. API Online", "status": "operational"}

# ─── App Setup ───

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
