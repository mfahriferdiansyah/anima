/**
 * SSE chat streaming via fetch-reader (POST body + auth header — EventSource
 * can't do either). Parses `data:` deltas, `event: done`, `event: error`.
 */
import { useCallback, useRef, useState } from 'react';
import { BACKEND_URL } from '../lib/backendAuth.js';

export interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
}

export interface ContextNote {
  noteId: string;
  title: string;
  body: string;
}

export function useChatStream(opts: { getJwt: () => Promise<string>; model?: string }) {
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const stream = useCallback(
    async (
      args: { persona: string; transcript: ChatMsg[]; context: ContextNote[] },
      onDelta: (text: string) => void,
    ): Promise<string> => {
      const jwt = await opts.getJwt();
      const ac = new AbortController();
      abortRef.current = ac;
      setStreaming(true);
      let full = '';
      try {
        const res = await fetch(`${BACKEND_URL}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
          body: JSON.stringify({ model: opts.model, ...args }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) throw new Error(`chat failed: ${res.status} ${await res.text()}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let event = 'message';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (line.startsWith('event: ')) event = line.slice(7).trim();
            else if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (event === 'error') throw new Error(JSON.parse(data)?.error ?? 'stream error');
              if (event === 'done') return full;
              try {
                const delta = JSON.parse(data)?.delta ?? '';
                if (delta) {
                  full += delta;
                  onDelta(full);
                }
              } catch {
                /* keepalive/comment lines */
              }
            } else if (line === '') event = 'message';
          }
        }
        return full;
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [opts.getJwt, opts.model],
  );

  const distill = useCallback(
    async (transcript: ChatMsg[]): Promise<{ title: string; body: string; tags?: string[]; links?: string[] }[]> => {
      const jwt = await opts.getJwt();
      const res = await fetch(`${BACKEND_URL}/distill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ transcript }),
      });
      if (!res.ok) return [];
      const j = await res.json();
      return j.notes ?? [];
    },
    [opts.getJwt],
  );

  return { stream, distill, streaming, abort: () => abortRef.current?.abort() };
}
