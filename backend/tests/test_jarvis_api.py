"""
Backend API Tests for JARVIS AI Assistant
Tests: Health check, Conversations CRUD, Chat with AI (GPT-5.2), TTS
"""
import pytest
import requests
import time

class TestHealthCheck:
    """Health check endpoint tests"""
    
    def test_health_check(self, api_client, base_url):
        """Test GET /api/ returns operational status"""
        response = api_client.get(f"{base_url}/api/")
        assert response.status_code == 200
        
        data = response.json()
        assert "message" in data
        assert "J.A.R.V.I.S." in data["message"]
        assert data["status"] == "operational"
        print("✓ Health check passed")


class TestConversations:
    """Conversation management tests with persistence verification"""
    
    def test_create_conversation(self, api_client, base_url):
        """Test POST /api/conversations creates new conversation"""
        payload = {"title": "TEST_New Conversation"}
        response = api_client.post(f"{base_url}/api/conversations", json=payload)
        assert response.status_code == 200
        
        data = response.json()
        assert "id" in data
        assert data["title"] == "TEST_New Conversation"
        assert data["message_count"] == 0
        assert "created_at" in data
        assert "updated_at" in data
        print(f"✓ Created conversation: {data['id']}")
        
        # Verify persistence with GET
        conv_id = data["id"]
        get_response = api_client.get(f"{base_url}/api/conversations/{conv_id}")
        assert get_response.status_code == 200
        retrieved_data = get_response.json()
        assert retrieved_data["conversation"]["id"] == conv_id
        print(f"✓ Conversation persisted successfully")
    
    def test_list_conversations(self, api_client, base_url):
        """Test GET /api/conversations returns list"""
        response = api_client.get(f"{base_url}/api/conversations")
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Listed {len(data)} conversations")
    
    def test_get_conversation_with_messages(self, api_client, base_url):
        """Test GET /api/conversations/{id} returns conversation and messages"""
        # Create conversation first
        create_response = api_client.post(
            f"{base_url}/api/conversations",
            json={"title": "TEST_Get Conversation"}
        )
        assert create_response.status_code == 200
        conv_id = create_response.json()["id"]
        
        # Get conversation
        response = api_client.get(f"{base_url}/api/conversations/{conv_id}")
        assert response.status_code == 200
        
        data = response.json()
        assert "conversation" in data
        assert "messages" in data
        assert data["conversation"]["id"] == conv_id
        assert isinstance(data["messages"], list)
        print(f"✓ Retrieved conversation {conv_id} with messages")
    
    def test_delete_conversation(self, api_client, base_url):
        """Test DELETE /api/conversations/{id} removes conversation"""
        # Create conversation
        create_response = api_client.post(
            f"{base_url}/api/conversations",
            json={"title": "TEST_To Delete"}
        )
        conv_id = create_response.json()["id"]
        
        # Delete conversation
        delete_response = api_client.delete(f"{base_url}/api/conversations/{conv_id}")
        assert delete_response.status_code == 200
        assert delete_response.json()["status"] == "deleted"
        
        # Verify deletion with GET (should return 404)
        get_response = api_client.get(f"{base_url}/api/conversations/{conv_id}")
        assert get_response.status_code == 404
        print(f"✓ Deleted conversation {conv_id} successfully")


class TestChat:
    """Chat endpoint tests with GPT-5.2 AI integration"""
    
    def test_chat_text_message(self, api_client, base_url):
        """Test POST /api/chat sends message and receives AI response"""
        # Create conversation
        create_response = api_client.post(
            f"{base_url}/api/conversations",
            json={"title": "TEST_Chat Test"}
        )
        conv_id = create_response.json()["id"]
        
        # Send chat message
        chat_payload = {
            "conversation_id": conv_id,
            "message": "What is 2+2? Answer in one word.",
            "image_base64": None
        }
        response = api_client.post(f"{base_url}/api/chat", json=chat_payload)
        assert response.status_code == 200
        
        data = response.json()
        assert "user_message" in data
        assert "ai_message" in data
        
        # Verify user message
        user_msg = data["user_message"]
        assert user_msg["role"] == "user"
        assert user_msg["content"] == "What is 2+2? Answer in one word."
        assert user_msg["conversation_id"] == conv_id
        
        # Verify AI message
        ai_msg = data["ai_message"]
        assert ai_msg["role"] == "assistant"
        assert len(ai_msg["content"]) > 0
        assert ai_msg["conversation_id"] == conv_id
        print(f"✓ Chat successful. AI response: {ai_msg['content'][:50]}...")
        
        # Verify messages were persisted
        get_response = api_client.get(f"{base_url}/api/conversations/{conv_id}")
        assert get_response.status_code == 200
        messages = get_response.json()["messages"]
        assert len(messages) == 2
        assert messages[0]["role"] == "user"
        assert messages[1]["role"] == "assistant"
        print(f"✓ Chat messages persisted correctly")


class TestTTS:
    """Text-to-Speech endpoint tests"""
    
    def test_tts_generation(self, api_client, base_url):
        """Test POST /api/tts returns base64 audio"""
        payload = {
            "text": "Hello, I am JARVIS.",
            "voice": "nova"
        }
        response = api_client.post(f"{base_url}/api/tts", json=payload)
        assert response.status_code == 200
        
        data = response.json()
        assert "audio_base64" in data
        assert len(data["audio_base64"]) > 0
        # Verify it's valid base64
        import base64
        try:
            base64.b64decode(data["audio_base64"])
            print(f"✓ TTS generated valid audio (base64 length: {len(data['audio_base64'])})")
        except Exception as e:
            pytest.fail(f"Invalid base64 audio: {e}")
