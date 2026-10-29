import { withBase } from '../lib/urls';

export type Compilation = { sql: string; params: Record<string, string> };
let workerBundle: Promise<string> | undefined;

/** The trusted page never evaluates source. Each compilation uses a fresh realm. */
export async function compileIsolated(source: string, signal: AbortSignal): Promise<Compilation> {
  if (source.length > 32_000) throw new Error('Source exceeds 32,000 characters.');
  workerBundle ??= fetch(withBase('/sandbox/worker.js')).then(response => {
    if (!response.ok) throw new Error('Could not load the compiler. Reload to retry.');
    return response.text();
  }).catch(error => { workerBundle = undefined; throw error; });
  const bundle = await workerBundle;
  if (signal.aborted) throw new DOMException('Compilation canceled', 'AbortError');
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.title = 'Isolated query compiler';
    frame.setAttribute('sandbox', 'allow-scripts');
    const token = crypto.randomUUID();
    const finish = (error?: Error, value?: Compilation) => {
      clearTimeout(timer);
      window.removeEventListener('message', receive);
      signal.removeEventListener('abort', abort);
      frame.contentWindow?.postMessage({ token, cancel: true }, '*');
      frame.remove();
      if (error) reject(error);
      else resolve(value!);
    };
    const abort = () => finish(new DOMException('Compilation canceled', 'AbortError'));
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.data?.token !== token) return;
      const message = event.data;
      if (message.ready === true) {
        frame.contentWindow?.postMessage({ token, source }, '*');
        return;
      }
      if (typeof message.text !== 'string' || message.text.length > 100_000 || typeof message.ok !== 'boolean') {
        finish(new Error('Invalid compiler response.'));
        return;
      }
      if (!message.ok) { finish(new Error(message.text)); return; }
      try {
        const value: unknown = JSON.parse(message.text);
        if (!value || typeof value !== 'object' || !('sql' in value) || typeof value.sql !== 'string' ||
            !('params' in value) || !value.params || typeof value.params !== 'object' ||
            Array.isArray(value.params) || Object.values(value.params).some(v => typeof v !== 'string')) {
          throw new Error('Invalid compiler output.');
        }
        finish(undefined, value as Compilation);
      } catch { finish(new Error('Invalid compiler output.')); }
    };
    const timer = window.setTimeout(() => finish(new Error('Compilation timed out (5 seconds). Simplify the query and try again.')), 5000);
    window.addEventListener('message', receive);
    signal.addEventListener('abort', abort, { once: true });
    const script = `
      const token = ${JSON.stringify(token)};
      const worker = new Worker(URL.createObjectURL(new Blob([${JSON.stringify(bundle)}], {type:'text/javascript'})));
      worker.onmessage = event => {
        const data = event.data;
        if (data && typeof data.text === 'string' && data.text.length <= 100000 && typeof data.ok === 'boolean') {
          parent.postMessage({token, ok:data.ok, text:data.text}, '*');
        }
      };
      worker.onerror = () => parent.postMessage({token, ok:false, text:'Compiler worker failed.'}, '*');
      onmessage = event => {
        if (event.source !== parent || event.data?.token !== token) return;
        if (event.data.cancel) worker.terminate();
        else if (typeof event.data.source === 'string') worker.postMessage(event.data.source);
      };
      parent.postMessage({token, ready:true}, '*');
    `;
    // CSP is inherited by blob workers. No same-origin privilege, network, nested
    // frames, external imports, forms, or popups are granted to evaluated code.
    frame.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'; child-src 'none'; base-uri 'none'; form-action 'none'"><script>${script.replace(/<\/script/gi, '<\\/script')}</script>`;
    document.body.append(frame);
  });
}
