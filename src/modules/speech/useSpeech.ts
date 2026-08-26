"use client";
import { useCallback, useRef, useState } from "react";

// Browser-native only for v1 (no TTS/STT vendor, no API key, no per-use
// cost) — see docs/requirements.md decisions. Swappable later behind this
// same hook interface if voice quality ever demands a real vendor.

type SpeakOptions = { voiceName?: string; rate?: number; lang?: string };
type ListenOptions = { lang?: string };

export function useSpeech() {
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const speak = useCallback((text: string, opts?: SpeakOptions) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = opts?.lang ?? "ja-JP";
    utterance.rate = opts?.rate ?? 1;

    if (opts?.voiceName) {
      const voice = window.speechSynthesis
        .getVoices()
        .find((v) => v.name === opts.voiceName);
      if (voice) utterance.voice = voice;
    }

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, []);

  const listen = useCallback((opts?: ListenOptions): Promise<string> => {
    return new Promise((resolve, reject) => {
      const SpeechRecognitionCtor =
        window.SpeechRecognition ?? window.webkitSpeechRecognition;
      if (!SpeechRecognitionCtor) {
        reject(new Error("Speech recognition isn't supported in this browser"));
        return;
      }

      const recognition = new SpeechRecognitionCtor();
      recognition.lang = opts?.lang ?? "ja-JP";
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognitionRef.current = recognition;

      recognition.onresult = (event) => {
        resolve(event.results[0][0].transcript);
      };
      recognition.onerror = (event) => {
        reject(new Error(event.error));
      };
      recognition.onend = () => setIsListening(false);

      setIsListening(true);
      recognition.start();
    });
  }, []);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const supported =
    typeof window !== "undefined" &&
    (!!window.speechSynthesis ||
      !!(window.SpeechRecognition ?? window.webkitSpeechRecognition));

  return { speak, listen, stopListening, isListening, supported };
}
