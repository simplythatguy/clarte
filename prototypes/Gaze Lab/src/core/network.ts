import { MODEL_FILES } from './tracking';
// The optional team model is a static local asset like the model files.
const assets = new Set([...MODEL_FILES, '/team/team-estimator.json']);

export function isLocalModelGet(url: string, method: string, origin: string): boolean {
  try {
    const parsed = new URL(url, origin);
    if (method.toUpperCase() !== 'GET' || parsed.origin !== origin || parsed.search || parsed.hash || parsed.username || parsed.password) return false;
    return assets.has(parsed.pathname);
  } catch { return false; }
}

/** Defense in depth alongside CSP: inference can only fetch known local model files. */
export function installLocalNetworkBoundary(): void {
  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    if (!isLocalModelGet(url, method, globalThis.location.origin) || init?.body) return Promise.reject(new TypeError('Only local model GET requests are permitted.'));
    return nativeFetch(input, init);
  };
  XMLHttpRequest.prototype.open = new Proxy(XMLHttpRequest.prototype.open, {
    apply(target, receiver, argumentsList) {
      const [method, url] = argumentsList;
      if (typeof method !== 'string' || !(typeof url === 'string' || url instanceof URL) || !isLocalModelGet(url.toString(), method, globalThis.location.origin)) throw new TypeError('Only local model GET requests are permitted.');
      return Reflect.apply(target, receiver, argumentsList);
    },
  });
  XMLHttpRequest.prototype.send = new Proxy(XMLHttpRequest.prototype.send, {
    apply(target, receiver, argumentsList) {
      if (argumentsList[0] !== undefined && argumentsList[0] !== null) throw new TypeError('Request bodies are disabled.');
      return Reflect.apply(target, receiver, argumentsList);
    },
  });
  if ('sendBeacon' in navigator) navigator.sendBeacon = () => false;
}
