import { DurableObject } from 'cloudflare:workers';

/** How long a host stays registered without polling, and an offer or answer is kept (ms). */
const HOST_TTL = 20_000;
const MSG_TTL = 60_000;

interface Pending {
  id: string;
  offer: string;
  answer: string | null;
  at: number;
}

/**
 * The signalling relay for races hosted on a phone (or any browser): the host runs the room itself (RoomCore, as
 * offline) and its players connect straight to it over WebRTC data channels. This only passes each guest's offer to
 * the host and the host's answer back (one exchange, the candidates included); the race itself never comes through
 * here, and on one Wi-Fi network it stays on it. One instance per room code; nothing is stored.
 *
 *   POST /api/p2p/<code>/host            the host is there (every poll refreshes it)
 *   GET  /api/p2p/<code>                 is this code hosted on a device? {hosted}
 *   POST /api/p2p/<code>/offer  {sdp}    a guest's offer → {id}
 *   GET  /api/p2p/<code>/offers          the host's poll: offers not answered yet
 *   POST /api/p2p/<code>/answer {id,sdp} the host's answer
 *   GET  /api/p2p/<code>/answer/<id>     the guest's poll: {sdp} or 204
 */
export class SignalDO extends DurableObject<Record<string, never>> {
  private hostAt = 0;
  private pending = new Map<string, Pending>();

  override async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean);
    const action = parts[0] ?? '';
    const now = Date.now();
    for (const [id, p] of this.pending) if (now - p.at > MSG_TTL) this.pending.delete(id);
    const hosted = now - this.hostAt < HOST_TTL;
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    const body = async () => {
      try {
        return (await req.json()) as Record<string, unknown>;
      } catch {
        return {};
      }
    };
    if (req.method === 'GET' && action === '') return json({ hosted });
    if (req.method === 'POST' && action === 'host') {
      this.hostAt = now;
      return json({ ok: true });
    }
    if (req.method === 'POST' && action === 'offer') {
      if (!hosted) return json({ error: 'No race is hosted with this code.' }, 404);
      const b = await body();
      if (typeof b.sdp !== 'string' || b.sdp.length > 20_000 || this.pending.size > 32) return json({ error: 'Bad offer.' }, 400);
      const id = crypto.randomUUID();
      this.pending.set(id, { id, offer: b.sdp, answer: null, at: now });
      return json({ id });
    }
    if (req.method === 'GET' && action === 'offers') {
      this.hostAt = now;
      return json({ offers: [...this.pending.values()].filter((p) => p.answer === null).map((p) => ({ id: p.id, sdp: p.offer })) });
    }
    if (req.method === 'POST' && action === 'answer') {
      const b = await body();
      const p = typeof b.id === 'string' ? this.pending.get(b.id) : undefined;
      if (!p || typeof b.sdp !== 'string' || b.sdp.length > 20_000) return json({ error: 'Unknown offer.' }, 404);
      p.answer = b.sdp;
      return json({ ok: true });
    }
    if (req.method === 'GET' && action === 'answer' && parts[1]) {
      const p = this.pending.get(parts[1]);
      if (!p) return json({ error: 'Unknown offer.' }, 404);
      if (p.answer === null) return new Response(null, { status: 204 });
      this.pending.delete(p.id);
      return json({ sdp: p.answer });
    }
    return json({ error: 'Not found' }, 404);
  }
}
