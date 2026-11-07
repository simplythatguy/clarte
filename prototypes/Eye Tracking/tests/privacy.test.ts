import { describe, expect, it } from 'vitest';
import { isLocalModelGet } from '../src/core/network';
import { localVoices, chooseLocalVoice } from '../src/core/speech';

describe('runtime privacy boundaries', () => {
  const origin = 'http://localhost:4318';
  const file = '/vendor/webeyetrack/vision/wasm/vision_wasm_internal.wasm';
  it('allows local model assets, but refuses remote hosts, other ports, payloads and uploads', () => {
    expect(isLocalModelGet(file, 'GET', origin)).toBe(true);
    expect(isLocalModelGet(`https://example.com${file}`, 'GET', origin)).toBe(false);
    expect(isLocalModelGet(`http://localhost:4320${file}`, 'GET', origin)).toBe(false);
    expect(isLocalModelGet(`${file}?gaze=raw`, 'GET', origin)).toBe(false);
    expect(isLocalModelGet(file, 'POST', origin)).toBe(false);
    expect(isLocalModelGet('/api/upload', 'GET', origin)).toBe(false);
    expect(isLocalModelGet('/vendor/mediapipe/face_mesh/../upload', 'GET', origin)).toBe(false);
  });
  it('never falls back to a remote or missing speech voice', () => {
    const voice = (localService: boolean, voiceURI: string): SpeechSynthesisVoice => ({ localService, voiceURI, default: false, lang: 'en-US', name: voiceURI });
    const all = [voice(false, 'remote'), voice(true, 'local')];
    expect(localVoices(all).map(item => item.voiceURI)).toEqual(['local']);
    expect(chooseLocalVoice(all, 'remote')).toBeNull();
    expect(chooseLocalVoice(all, 'missing')).toBeNull();
    expect(chooseLocalVoice(all, 'local')?.localService).toBe(true);
  });
});
