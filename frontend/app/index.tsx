import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Image,
  Animated, Dimensions, Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAudioRecorder, RecordingPresets, useAudioPlayer } from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import {
  Send, Mic, MicOff, Image as ImageIcon, Sparkles, MessageSquare,
  Volume2, VolumeX, Menu, Plus, ChevronLeft, Trash2, Wand2,
} from 'lucide-react-native';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Types ───
interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  message_type: string;
  image_base64?: string | null;
  audio_base64?: string | null;
  created_at: string;
}

interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

// ─── Colors ───
const C = {
  bg: '#050505',
  surface: '#0A0A0F',
  surfaceLight: '#111118',
  primary: '#00F0FF',
  primaryDim: 'rgba(0,240,255,0.15)',
  primaryGlow: 'rgba(0,240,255,0.3)',
  secondary: '#FF2A6D',
  accent: '#F0E68C',
  success: '#00FF9D',
  text: '#E0E0E0',
  textDim: '#9CA3AF',
  textMuted: '#6B7280',
  border: 'rgba(0,240,255,0.15)',
  error: '#FF003C',
  userBubble: 'rgba(0,240,255,0.08)',
  aiBubble: 'rgba(15,15,25,0.9)',
};

export default function JarvisChat() {
  const router = useRouter();
  const params = useLocalSearchParams<{ conversationId?: string }>();
  const insets = useSafeAreaInsets();

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [conversationId, setConversationId] = useState<string | null>(
    params.conversationId || null
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [showSidebar, setShowSidebar] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [imageGenPrompt, setImageGenPrompt] = useState('');
  const [showImageGen, setShowImageGen] = useState(false);

  const flatListRef = useRef<FlatList>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const [ttsSource, setTtsSource] = useState<string | null>(null);

  // expo-audio hooks
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const player = useAudioPlayer(ttsSource);

  // ─── Init ───
  useEffect(() => {
    loadConversations();
    if (params.conversationId) {
      loadConversation(params.conversationId);
    }
  }, [params.conversationId]);

  // ─── Pulse Animation for Recording ───
  useEffect(() => {
    if (isRecording) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.3, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isRecording]);

  // ─── API Calls ───
  const loadConversations = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/conversations`);
      const data = await res.json();
      setConversations(data);
    } catch (e) {
      console.error('Load conversations error:', e);
    }
  };

  const loadConversation = async (id: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/conversations/${id}`);
      const data = await res.json();
      setMessages(data.messages || []);
      setConversationId(id);
    } catch (e) {
      console.error('Load conversation error:', e);
    }
  };

  const createConversation = async (): Promise<string> => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Conversation' }),
      });
      const data = await res.json();
      setConversationId(data.id);
      loadConversations();
      return data.id;
    } catch (e) {
      console.error('Create conversation error:', e);
      throw e;
    }
  };

  const deleteConversation = async (id: string) => {
    try {
      await fetch(`${BACKEND_URL}/api/conversations/${id}`, { method: 'DELETE' });
      if (conversationId === id) {
        setConversationId(null);
        setMessages([]);
      }
      loadConversations();
    } catch (e) {
      console.error('Delete error:', e);
    }
  };

  // ─── Send Text Message ───
  const sendMessage = async (text?: string, imageBase64?: string) => {
    const msg = text || inputText.trim();
    if (!msg && !imageBase64) return;
    setInputText('');
    setIsLoading(true);

    try {
      let cId = conversationId;
      if (!cId) {
        cId = await createConversation();
      }

      const res = await fetch(`${BACKEND_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: cId,
          message: msg || 'What do you see in this image?',
          image_base64: imageBase64 || null,
        }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, data.user_message, data.ai_message]);
      loadConversations();

      // Auto-speak AI response
      if (autoSpeak && data.ai_message?.content) {
        speakText(data.ai_message.content);
      }

      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (e) {
      console.error('Send error:', e);
      Alert.alert('Error', 'Failed to send message. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // ─── Voice Recording ───
  const startRecording = async () => {
    try {
      await recorder.prepareToRecordAsync();
      recorder.record();
      setIsRecording(true);
    } catch (e) {
      console.error('Start recording error:', e);
      Alert.alert('Error', 'Failed to start recording. Please check microphone permissions.');
    }
  };

  const stopRecording = async () => {
    if (!isRecording) return;
    setIsRecording(false);
    setIsLoading(true);

    try {
      await recorder.stop();
      const uri = recorder.uri;

      if (!uri) throw new Error('No recording URI');

      // Upload for transcription
      const formData = new FormData();
      formData.append('audio', {
        uri,
        type: 'audio/m4a',
        name: 'recording.m4a',
      } as any);

      const res = await fetch(`${BACKEND_URL}/api/transcribe`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (data.text) {
        setInputText(data.text);
        sendMessage(data.text);
      }
    } catch (e) {
      console.error('Transcription error:', e);
      Alert.alert('Error', 'Failed to transcribe audio.');
      setIsLoading(false);
    }
  };

  // ─── Text-to-Speech ───
  const speakText = async (text: string) => {
    if (isSpeaking) {
      if (player) {
        player.pause();
      }
      setIsSpeaking(false);
      return;
    }

    setIsSpeaking(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.substring(0, 4000), voice: 'nova' }),
      });
      const data = await res.json();

      if (data.audio_base64) {
        if (Platform.OS === 'web') {
          // Web: use HTML5 Audio with data URI
          const audioSrc = `data:audio/mp3;base64,${data.audio_base64}`;
          const audioEl = new (window as any).Audio(audioSrc);
          audioEl.onended = () => setIsSpeaking(false);
          audioEl.onerror = () => setIsSpeaking(false);
          await audioEl.play();
        } else {
          // Native: write file and use expo-audio player
          const fileUri = FileSystem.cacheDirectory + 'tts_output_' + Date.now() + '.mp3';
          await FileSystem.writeAsStringAsync(fileUri, data.audio_base64, {
            encoding: FileSystem.EncodingType.Base64,
          });
          setTtsSource(fileUri);
          // Player will auto-load when ttsSource changes, then play
          setTimeout(() => {
            if (player) {
              player.play();
            }
          }, 300);
          // Set timeout to reset speaking state
          const duration = text.length * 80; // rough estimate
          setTimeout(() => setIsSpeaking(false), Math.min(duration, 60000));
        }
      }
    } catch (e) {
      console.error('TTS error:', e);
      setIsSpeaking(false);
    }
  };

  // ─── Image Picker ───
  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Photo library access is needed.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      base64: true,
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]?.base64) {
      sendMessage(inputText || 'What do you see in this image?', result.assets[0].base64);
    }
  };

  // ─── Image Generation ───
  const generateImage = async () => {
    if (!imageGenPrompt.trim()) return;
    setShowImageGen(false);
    setIsLoading(true);

    try {
      let cId = conversationId;
      if (!cId) {
        cId = await createConversation();
      }

      const res = await fetch(`${BACKEND_URL}/api/generate-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: cId, prompt: imageGenPrompt }),
      });
      const data = await res.json();
      if (data.user_message && data.ai_message) {
        setMessages(prev => [...prev, data.user_message, data.ai_message]);
      }
      setImageGenPrompt('');
      loadConversations();
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (e) {
      console.error('Image gen error:', e);
      Alert.alert('Error', 'Image generation failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // ─── New Conversation ───
  const startNewConversation = () => {
    setConversationId(null);
    setMessages([]);
    setShowSidebar(false);
  };

  // ─── Render Message ───
  const renderMessage = useCallback(({ item }: { item: Message }) => {
    const isUser = item.role === 'user';
    return (
      <View
        testID={`message-${item.id}`}
        style={[styles.messageBubble, isUser ? styles.userBubble : styles.aiBubble]}
      >
        <View style={styles.messageHeader}>
          <View style={[styles.roleIndicator, { backgroundColor: isUser ? C.primary : C.accent }]} />
          <Text style={[styles.roleText, { color: isUser ? C.primary : C.accent }]}>
            {isUser ? 'YOU' : 'J.A.R.V.I.S.'}
          </Text>
        </View>
        {item.image_base64 ? (
          <Image
            source={{ uri: `data:image/png;base64,${item.image_base64}` }}
            style={styles.messageImage}
            resizeMode="contain"
          />
        ) : null}
        <Text style={styles.messageText}>{item.content}</Text>
        {!isUser && item.content ? (
          <TouchableOpacity
            testID={`speak-btn-${item.id}`}
            style={styles.speakBtn}
            onPress={() => speakText(item.content)}
          >
            {isSpeaking ? (
              <VolumeX size={14} color={C.primary} />
            ) : (
              <Volume2 size={14} color={C.textDim} />
            )}
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }, [isSpeaking, autoSpeak]);

  // ─── Empty State ───
  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <View style={styles.arcReactorContainer}>
        <View style={styles.arcReactorOuter}>
          <View style={styles.arcReactorMiddle}>
            <View style={styles.arcReactorInner}>
              <Sparkles size={32} color={C.primary} />
            </View>
          </View>
        </View>
      </View>
      <Text style={styles.emptyTitle}>J.A.R.V.I.S.</Text>
      <Text style={styles.emptySubtitle}>Just A Rather Very Intelligent System</Text>
      <Text style={styles.emptyHint}>How may I assist you today?</Text>
      <View style={styles.capabilitiesRow}>
        {[
          { icon: <MessageSquare size={16} color={C.primary} />, label: 'Chat' },
          { icon: <Mic size={16} color={C.primary} />, label: 'Voice' },
          { icon: <ImageIcon size={16} color={C.primary} />, label: 'Vision' },
          { icon: <Wand2 size={16} color={C.primary} />, label: 'Create' },
        ].map((cap, i) => (
          <View key={i} style={styles.capabilityChip}>
            {cap.icon}
            <Text style={styles.capabilityText}>{cap.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );

  // ─── Sidebar ───
  const renderSidebar = () => (
    <View style={[styles.sidebar, { paddingTop: insets.top + 10 }]}>
      <View style={styles.sidebarHeader}>
        <Text style={styles.sidebarTitle}>SESSIONS</Text>
        <TouchableOpacity testID="new-conversation-btn" onPress={startNewConversation} style={styles.newBtn}>
          <Plus size={18} color={C.primary} />
        </TouchableOpacity>
      </View>
      <FlatList
        data={conversations}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            testID={`conversation-${item.id}`}
            style={[styles.convItem, conversationId === item.id && styles.convItemActive]}
            onPress={() => { loadConversation(item.id); setShowSidebar(false); }}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.convTitle} numberOfLines={1}>{item.title}</Text>
              <Text style={styles.convMeta}>{item.message_count} messages</Text>
            </View>
            <TouchableOpacity
              testID={`delete-conv-${item.id}`}
              onPress={() => deleteConversation(item.id)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Trash2 size={14} color={C.textMuted} />
            </TouchableOpacity>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <Text style={styles.emptyConvText}>No conversations yet</Text>
        }
      />
    </View>
  );

  // ─── Image Gen Modal ───
  const renderImageGenModal = () => {
    if (!showImageGen) return null;
    return (
      <View style={styles.imageGenOverlay}>
        <View style={styles.imageGenModal}>
          <Text style={styles.imageGenTitle}>IMAGE GENERATION</Text>
          <Text style={styles.imageGenSubtitle}>Describe the image you want to create</Text>
          <TextInput
            testID="image-gen-input"
            style={styles.imageGenInput}
            placeholder="A futuristic city at sunset..."
            placeholderTextColor={C.textMuted}
            value={imageGenPrompt}
            onChangeText={setImageGenPrompt}
            multiline
          />
          <View style={styles.imageGenActions}>
            <TouchableOpacity
              testID="image-gen-cancel-btn"
              style={styles.imageGenCancelBtn}
              onPress={() => setShowImageGen(false)}
            >
              <Text style={styles.imageGenCancelText}>CANCEL</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="image-gen-submit-btn"
              style={styles.imageGenSubmitBtn}
              onPress={generateImage}
            >
              <Wand2 size={16} color="#050505" />
              <Text style={styles.imageGenSubmitText}>GENERATE</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity testID="sidebar-toggle-btn" onPress={() => setShowSidebar(!showSidebar)} style={styles.headerBtn}>
          {showSidebar ? <ChevronLeft size={22} color={C.primary} /> : <Menu size={22} color={C.primary} />}
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.statusDot} />
          <Text style={styles.headerTitle}>J.A.R.V.I.S.</Text>
        </View>
        <TouchableOpacity
          testID="auto-speak-toggle"
          onPress={() => setAutoSpeak(!autoSpeak)}
          style={styles.headerBtn}
        >
          {autoSpeak ? <Volume2 size={20} color={C.primary} /> : <VolumeX size={20} color={C.textMuted} />}
        </TouchableOpacity>
      </View>

      <View style={styles.body}>
        {/* Sidebar */}
        {showSidebar && renderSidebar()}

        {/* Chat Area */}
        <KeyboardAvoidingView
          style={styles.chatArea}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
        >
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={item => item.id}
            renderItem={renderMessage}
            contentContainerStyle={[
              styles.messageList,
              messages.length === 0 && { flex: 1 },
            ]}
            ListEmptyComponent={renderEmptyState}
            onContentSizeChange={() =>
              messages.length > 0 && flatListRef.current?.scrollToEnd({ animated: true })
            }
          />

          {/* Loading Indicator */}
          {isLoading && (
            <View style={styles.loadingBar}>
              <ActivityIndicator size="small" color={C.primary} />
              <Text style={styles.loadingText}>Processing...</Text>
            </View>
          )}

          {/* Input Area */}
          <View style={[styles.inputArea, { paddingBottom: Math.max(insets.bottom, 8) }]}>
            <View style={styles.inputRow}>
              {/* Image Attach */}
              <TouchableOpacity testID="image-attach-btn" onPress={pickImage} style={styles.actionBtn}>
                <ImageIcon size={20} color={C.textDim} />
              </TouchableOpacity>

              {/* Image Gen */}
              <TouchableOpacity testID="image-gen-btn" onPress={() => setShowImageGen(true)} style={styles.actionBtn}>
                <Wand2 size={20} color={C.textDim} />
              </TouchableOpacity>

              {/* Text Input */}
              <View style={styles.inputWrapper}>
                <TextInput
                  testID="chat-input"
                  style={styles.textInput}
                  placeholder="Message J.A.R.V.I.S..."
                  placeholderTextColor={C.textMuted}
                  value={inputText}
                  onChangeText={setInputText}
                  multiline
                  maxLength={4000}
                  onSubmitEditing={() => sendMessage()}
                />
              </View>

              {/* Voice / Send Toggle */}
              {inputText.trim() ? (
                <TouchableOpacity
                  testID="send-btn"
                  onPress={() => sendMessage()}
                  style={[styles.actionBtn, styles.sendBtn]}
                  disabled={isLoading}
                >
                  <Send size={18} color="#050505" />
                </TouchableOpacity>
              ) : (
                <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                  <TouchableOpacity
                    testID="voice-btn"
                    onPress={isRecording ? stopRecording : startRecording}
                    style={[styles.actionBtn, isRecording ? styles.voiceBtnRecording : styles.voiceBtn]}
                    disabled={isLoading}
                  >
                    {isRecording ? (
                      <MicOff size={20} color={C.error} />
                    ) : (
                      <Mic size={20} color={C.primary} />
                    )}
                  </TouchableOpacity>
                </Animated.View>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>

      {/* Image Gen Modal */}
      {renderImageGenModal()}
    </SafeAreaView>
  );
}

// ─── Styles ───
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.surface,
  },
  headerBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.success,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: C.text,
    letterSpacing: 3,
  },
  body: {
    flex: 1,
    flexDirection: 'row',
  },
  // Sidebar
  sidebar: {
    width: SCREEN_WIDTH * 0.75,
    maxWidth: 300,
    backgroundColor: C.surface,
    borderRightWidth: 1,
    borderRightColor: C.border,
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    zIndex: 10,
  },
  sidebarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  sidebarTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: C.primary,
    letterSpacing: 2,
  },
  newBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  convItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.03)',
  },
  convItemActive: {
    backgroundColor: C.primaryDim,
    borderLeftWidth: 2,
    borderLeftColor: C.primary,
  },
  convTitle: {
    fontSize: 14,
    color: C.text,
    fontWeight: '500',
  },
  convMeta: {
    fontSize: 11,
    color: C.textMuted,
    marginTop: 2,
  },
  emptyConvText: {
    textAlign: 'center',
    color: C.textMuted,
    fontSize: 13,
    paddingVertical: 30,
  },
  // Chat
  chatArea: {
    flex: 1,
  },
  messageList: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  messageBubble: {
    marginBottom: 12,
    borderRadius: 16,
    padding: 14,
    maxWidth: '88%',
  },
  userBubble: {
    backgroundColor: C.userBubble,
    borderWidth: 1,
    borderColor: 'rgba(0,240,255,0.12)',
    alignSelf: 'flex-end',
    borderTopRightRadius: 4,
  },
  aiBubble: {
    backgroundColor: C.aiBubble,
    borderWidth: 1,
    borderColor: 'rgba(240,230,140,0.1)',
    alignSelf: 'flex-start',
    borderTopLeftRadius: 4,
  },
  messageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  roleIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  roleText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  messageText: {
    fontSize: 14.5,
    color: C.text,
    lineHeight: 22,
  },
  messageImage: {
    width: '100%',
    height: 200,
    borderRadius: 10,
    marginBottom: 8,
    backgroundColor: C.surfaceLight,
  },
  speakBtn: {
    alignSelf: 'flex-end',
    marginTop: 6,
    padding: 4,
  },
  // Empty State
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  arcReactorContainer: {
    marginBottom: 24,
  },
  arcReactorOuter: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
    borderColor: 'rgba(0,240,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  arcReactorMiddle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1.5,
    borderColor: 'rgba(0,240,255,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  arcReactorInner: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0,240,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: C.text,
    letterSpacing: 6,
  },
  emptySubtitle: {
    fontSize: 11,
    color: C.primary,
    letterSpacing: 2,
    marginTop: 4,
    textTransform: 'uppercase',
  },
  emptyHint: {
    fontSize: 15,
    color: C.textDim,
    marginTop: 20,
  },
  capabilitiesRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 24,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  capabilityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.primaryDim,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
  },
  capabilityText: {
    fontSize: 12,
    color: C.primary,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  // Loading
  loadingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 8,
    backgroundColor: C.surface,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  loadingText: {
    fontSize: 12,
    color: C.primary,
    letterSpacing: 1,
  },
  // Input
  inputArea: {
    backgroundColor: C.surface,
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingTop: 10,
    paddingHorizontal: 12,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
  },
  actionBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.surfaceLight,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  sendBtn: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  voiceBtn: {
    borderColor: C.primary,
    borderWidth: 1.5,
  },
  voiceBtnRecording: {
    backgroundColor: 'rgba(255,0,60,0.15)',
    borderColor: C.error,
    borderWidth: 1.5,
  },
  inputWrapper: {
    flex: 1,
    backgroundColor: C.surfaceLight,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 16,
    minHeight: 42,
    justifyContent: 'center',
  },
  textInput: {
    fontSize: 15,
    color: C.text,
    maxHeight: 100,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
  },
  // Image Gen Modal
  imageGenOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
    padding: 24,
  },
  imageGenModal: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 24,
  },
  imageGenTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: C.text,
    letterSpacing: 2,
  },
  imageGenSubtitle: {
    fontSize: 13,
    color: C.textDim,
    marginTop: 4,
    marginBottom: 16,
  },
  imageGenInput: {
    backgroundColor: C.surfaceLight,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    color: C.text,
    fontSize: 14,
    padding: 14,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  imageGenActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 16,
  },
  imageGenCancelBtn: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  imageGenCancelText: {
    fontSize: 13,
    color: C.textDim,
    letterSpacing: 1,
    fontWeight: '600',
  },
  imageGenSubmitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: C.primary,
  },
  imageGenSubmitText: {
    fontSize: 13,
    color: '#050505',
    fontWeight: '700',
    letterSpacing: 1,
  },
});
