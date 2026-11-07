export function localVoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  return voices.filter(voice => voice.localService).sort((a, b) => Number(b.default) - Number(a.default) || a.name.localeCompare(b.name));
}

export function chooseLocalVoice(voices: SpeechSynthesisVoice[], uri: string): SpeechSynthesisVoice | null {
  return localVoices(voices).find(voice => voice.voiceURI === uri) ?? null;
}
