// Layout-independent state and explicit acceptance for the local autocomplete API.
const clone = value => JSON.parse(JSON.stringify(value));
const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const sameInput = (a, b) => a && b && ['history', 'message', 'groups'].every(
  key => JSON.stringify(a[key]) === JSON.stringify(b[key]));

export function createAutocomplete({fetch: send = globalThis.fetch, onChange = () => {},
  timeoutMs = 15000} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('timeoutMs must be positive');
  const sessionId = globalThis.crypto.randomUUID();
  let revision = 0, active, state = freeze({status: 'idle', input: null, result: null, error: null, requestId: null});
  function publish(status, input, result = null, error = null, requestId = null) {
    state = freeze({status, input, result, error, requestId});
    onChange(state);
    return state;
  }
  function invalidate() {
    revision++;
    active?.abort();
    active = null;
  }
  async function update({history = [], message = [], groups = ''} = {}) {
    invalidate();
    const current = revision;
    const requestId = `${sessionId}:${current}`;
    const input = freeze(clone({history, message, groups}));
    const controller = new AbortController();
    active = controller;
    publish('pending', input, null, null, requestId);
    let timer;
    try {
      // Abort is an optimization. Revision checks remain necessary for transports
      // which finish after abort, and the timeout must settle even if they ignore it.
      const expired = new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('Autocomplete timed out. Retry.'));
          controller.abort();
        }, timeoutMs);
      });
      const cancelled = new Promise((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(new Error('Autocomplete cancelled.')), {once: true});
      });
      const work = (async () => {
        const response = await send('/api/complete', {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({...input, request_id: requestId}), signal: controller.signal
        });
        const data = await response.json();
        if (data.request_id !== requestId || ((response.ok || data.input !== undefined)
          && !sameInput(data.input, input))) {
          throw new Error('Autocomplete response does not match the current input. Retry.');
        }
        if (!response.ok) throw new Error(data.error || 'Autocomplete failed. Retry.');
        const validCandidate = item => item && typeof item.word === 'string' && item.word.length > 0
          && Number.isFinite(item.probability) && item.probability >= 0 && item.probability <= 1;
        if (data.probability_kind !== 'conditional_model_mass'
          || !Array.isArray(data.alternatives) || data.alternatives.length > 3
          || !data.alternatives.every(validCandidate)
          || !(data.status === 'suggestion' && validCandidate(data)
            || data.status === 'no_match' && data.word === '' && data.probability === 0
              && data.alternatives.length === 0)) {
          throw new Error('Invalid autocomplete response. Retry.');
        }
        return data;
      })();
      const data = await Promise.race([work, expired, cancelled]);
      if (current === revision) publish(data.status === 'suggestion' ? 'ready' : 'no_match', input,
        clone(data), null, requestId);
    } catch (error) {
      if (current === revision) publish('error', input, null, error.message || 'Autocomplete failed. Retry.', requestId);
    } finally {
      clearTimeout(timer);
      if (current === revision) active = null;
    }
    return state;
  }
  return {
    get state() { return state; },
    update,
    cancel() { invalidate(); return publish('idle', state.input); },
    // The caller must supply the identity displayed when activation began.
    // Return a new draft; no history edit, model commit, speech, or auto-request.
    accept(requestId) {
      if (state.status !== 'ready' || requestId !== state.requestId) return null;
      const input = clone(state.input);
      input.message.push(state.result.word);
      input.groups = '';
      invalidate();
      publish('idle', freeze(input));
      return input;
    }
  };
}
