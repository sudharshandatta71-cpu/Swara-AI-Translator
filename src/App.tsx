/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, Volume2, ArrowRightLeft, Loader2, Play } from 'lucide-react';
import { GoogleGenAI, Type, Modality } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const LANGUAGES = [
  { code: 'hi-IN', name: 'Hindi (हिंदी)' },
  { code: 'bn-IN', name: 'Bengali (বাংলা)' },
  { code: 'ta-IN', name: 'Tamil (தமிழ்)' },
  { code: 'te-IN', name: 'Telugu (తెలుగు)' },
  { code: 'mr-IN', name: 'Marathi (मराठी)' },
  { code: 'gu-IN', name: 'Gujarati (ગુજરાતી)' },
  { code: 'kn-IN', name: 'Kannada (ಕನ್ನಡ)' },
  { code: 'ml-IN', name: 'Malayalam (മലയാളം)' },
  { code: 'pa-IN', name: 'Punjabi (ਪੰਜਾਬੀ)' },
  { code: 'or-IN', name: 'Odia (ଓଡ଼ିଆ)' },
  { code: 'as-IN', name: 'Assamese (অসমীয়া)' },
  { code: 'ur-IN', name: 'Urdu (اردو)' },
  { code: 'en-IN', name: 'English (India)' },
];

export default function App() {
  const [sourceLang, setSourceLang] = useState(LANGUAGES[0].code);
  const [targetLang, setTargetLang] = useState(LANGUAGES[12].code);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  
  const [transcript, setTranscript] = useState('');
  const [translation, setTranslation] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);

  const getSourceLangName = () => LANGUAGES.find(l => l.code === sourceLang)?.name || '';
  const getTargetLangName = () => LANGUAGES.find(l => l.code === targetLang)?.name || '';

  const startRecording = async () => {
    setTranscript('');
    setTranslation('');
    setErrorMsg('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      let mimeType = 'audio/webm';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'audio/mp4';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = ''; // Let browser choose default
        }
      }
      
      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType });
        await processAudio(audioBlob, mediaRecorder.mimeType);
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Error accessing microphone:', err);
      setErrorMsg('Could not access microphone. Please check permissions.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      // Stop all microphone tracks
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const processAudio = async (blob: Blob, rawMimeType: string) => {
    setIsProcessing(true);
    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = () => {
          if (typeof reader.result === 'string') {
            resolve(reader.result.split(',')[1]);
          } else {
            reject(new Error('Failed to convert to base64'));
          }
        };
        reader.onerror = reject;
      });

      // Format MIME type for Gemini (strip codecs)
      const cleanMimeType = rawMimeType ? rawMimeType.split(';')[0] : 'audio/webm';

      const prompt = `You are a professional, direct-to-the-point translator. 
TASK: 
1. Listen to the audio.
2. Transcribe the exactly spoken words in ${getSourceLangName()}.
3. Translate those words into ${getTargetLangName()}.
STRICT RULES:
- Output ONLY the result in the specified JSON format.
- DO NOT add any greetings, explanations, or extra commentary.
- Be extremely accurate to the words spoken in the audio.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: {
          parts: [
            { inlineData: { mimeType: cleanMimeType, data: base64Data } },
            { text: prompt }
          ]
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              transcription: { type: Type.STRING, description: `Transcription of ${getSourceLangName()}` },
              translation: { type: Type.STRING, description: `Strict translation to ${getTargetLangName()}` }
            },
            required: ['transcription', 'translation']
          },
          temperature: 0,
        }
      });

      if (response.text) {
        const result = JSON.parse(response.text);
        setTranscript(result.transcription);
        setTranslation(result.translation);
        
        // Let's immediately generate speech playback
        speakTranslationWithGemini(result.translation, getTargetLangName(), targetLang);
      }
    } catch (err) {
      console.error('Error processing audio with Gemini:', err);
      setErrorMsg(`Error: ${err instanceof Error ? err.message : 'Transcription failed'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const playPCM16 = (base64Data: string, sampleRate = 24000) => {
    try {
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      const buffer = new Int16Array(bytes.buffer);
      const float32Data = new Float32Array(buffer.length);
      for (let i = 0; i < buffer.length; i++) {
        float32Data[i] = buffer[i] / 32768.0;
      }
      
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const audioBuffer = audioContext.createBuffer(1, float32Data.length, sampleRate);
      audioBuffer.getChannelData(0).set(float32Data);
      
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      source.start(0);
    } catch (err) {
      console.error("Error playing audio data:", err);
      setErrorMsg("Failed to play the audio response.");
    }
  };

  const speakTranslationWithGemini = async (text: string, langName: string, langCode: string) => {
    if (!text) return;
    setIsPlaying(true);
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-tts-preview",
        contents: [{ parts: [{ text: text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Puck' },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        playPCM16(base64Audio, 24000);
      } else {
        throw new Error("No audio data");
      }
    } catch (err) {
      console.warn('Gemini TTS failed, falling back to browser TTS:', err);
      // Fallback to browser native TTS
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = langCode;
      window.speechSynthesis.speak(utterance);
    } finally {
      setIsPlaying(false);
    }
  };

  const swapLanguages = () => {
    const temp = sourceLang;
    setSourceLang(targetLang);
    setTargetLang(temp);
  };

  return (
    <div className="min-h-screen p-4 sm:p-8 md:p-12 font-sans flex flex-col items-center">
      {/* Header */}
      <header className="mb-12 text-center max-w-2xl mt-4">
        <h1 className="text-4xl sm:text-5xl font-serif font-semibold text-orange-600 mb-3 tracking-tight">Swara AI</h1>
        <p className="text-gray-600 text-lg sm:text-xl font-light">
          Your bridge to Indian languages. Speak, translate, and connect seamlessly.
        </p>
      </header>

      {/* Main Container */}
      <main className="w-full max-w-3xl bg-white rounded-3xl shadow-sm border border-gray-100 p-6 sm:p-10 overflow-hidden">
        
        {/* Language Selection */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-10">
          <div className="w-full sm:w-2/5">
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Speak In</label>
            <div className="relative">
              <select 
                value={sourceLang}
                onChange={(e) => setSourceLang(e.target.value)}
                className="w-full appearance-none bg-gray-50 border border-gray-200 text-gray-800 py-3 px-4 rounded-xl cursor-pointer focus:outline-none focus:ring-2 focus:ring-orange-500/50 transition-all font-medium text-sm sm:text-base"
              >
                {LANGUAGES.map(lang => (
                  <option key={`src-${lang.code}`} value={lang.code}>{lang.name}</option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-gray-500">
                <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
              </div>
            </div>
          </div>

          <button 
            onClick={swapLanguages}
            className="hidden sm:flex mt-6 h-10 w-10 bg-orange-50 hover:bg-orange-100 text-orange-600 rounded-full items-center justify-center transition-colors"
            title="Swap Languages"
          >
            <ArrowRightLeft className="w-5 h-5" />
          </button>

          <div className="w-full sm:w-2/5">
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Translate To</label>
            <div className="relative">
              <select 
                value={targetLang}
                onChange={(e) => setTargetLang(e.target.value)}
                className="w-full appearance-none bg-gray-50 border border-gray-200 text-gray-800 py-3 px-4 rounded-xl cursor-pointer focus:outline-none focus:ring-2 focus:ring-orange-500/50 transition-all font-medium text-sm sm:text-base"
              >
                {LANGUAGES.map(lang => (
                  <option key={`tgt-${lang.code}`} value={lang.code}>{lang.name}</option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-gray-500">
                <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
              </div>
            </div>
          </div>
        </div>

        {/* Recording Controls */}
        <div className="flex flex-col items-center justify-center py-8">
          {errorMsg && (
            <div className="mb-6 px-4 py-3 bg-red-50 text-red-700 text-sm rounded-lg w-full text-center">
              {errorMsg}
            </div>
          )}

          <div className="relative flex items-center justify-center w-32 h-32 mb-6">
            <button
              onPointerDown={startRecording}
              onPointerUp={stopRecording}
              onPointerLeave={stopRecording}
              onPointerCancel={stopRecording}
              disabled={isProcessing}
              className={`absolute inset-0 flex items-center justify-center rounded-full transition-all duration-200 ${
                isRecording ? 'bg-orange-600 scale-95 recording-pulse' : 'bg-orange-500 hover:bg-orange-600'
              } ${isProcessing ? 'opacity-50 cursor-not-allowed bg-gray-400' : ''}`}
            >
              {isRecording ? (
                <div className="flex flex-col items-center">
                  <Square className="w-10 h-10 text-white fill-current" />
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <Mic className="w-12 h-12 text-white" />
                </div>
              )}
            </button>
          </div>
          
          <p className="text-sm font-medium text-gray-500 text-center">
            {isRecording ? (
              <span className="text-orange-600 animate-pulse font-semibold tracking-wide">Recording... Release to stop</span>
            ) : isProcessing ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-orange-500" /> Wait, analyzing audio...
              </span>
            ) : (
              "Hold button to speak"
            )}
          </p>
        </div>

        {/* Results Area */}
        { (transcript || translation) && (
          <div className="mt-8 space-y-6 pt-8 border-t border-gray-100">
            {/* Transcript */}
            <div className="p-5 bg-gray-50 rounded-2xl">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Original • {getSourceLangName()}</span>
              </div>
              <p className="text-gray-800 text-lg font-serif">
                {transcript}
              </p>
            </div>

            {/* Translation */}
            <div className="p-5 bg-orange-50/50 rounded-2xl relative border border-orange-100">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-orange-500">Translated • {getTargetLangName()}</span>
                <button 
                  onClick={() => speakTranslationWithGemini(translation, getTargetLangName(), targetLang)}
                  disabled={isPlaying}
                  className={`p-2 rounded-full shadow-sm transition-colors ${isPlaying ? 'bg-orange-200 text-orange-500 cursor-wait' : 'bg-white text-orange-600 hover:bg-orange-100'}`}
                  title="Play translation"
                >
                  {isPlaying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Volume2 className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-gray-900 text-2xl font-serif leading-relaxed">
                {translation}
              </p>
            </div>
          </div>
        )}

      </main>
      
      {/* Footer Info */}
      <footer className="mt-12 text-center text-xs text-gray-400 pb-12">
        <p>Uses Gemini 3.1 Pro & Voice TTS for High-Quality Audio</p>
      </footer>
    </div>
  );
}

