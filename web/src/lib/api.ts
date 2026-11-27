// Game stream client for No-LLMit: Server-Sent Events from the engine (engine/api/stream.go)

// The engine's address: an http(s) base URL without a trailing slash, such as https://engine.example.com. Unset, the site
// talks to localhost; next.config.ts refuses a production Vercel build without it.
export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
const STREAM_URL = `${API_URL}/stream`;

// The home page opens its stream from an inline script as the HTML is parsed (page.tsx), so the first snapshot is in
// by the time the page has hydrated instead of being asked for only then: the table's first paint waits on it. Its
// messages wait in `q`, each with the time it arrived, until GameStream adopts it (connect) and becomes their `sink`:
// the engine's figures (a shot clock's elapsedMs, nextHandInMs) count from when it sent them, so a message is timed
// from its arrival, not from when the page drained it after hydrating (seconds later on a slow phone).
type Early = { es: EventSource; q: [MessageEvent, number][]; sink: ((e: MessageEvent, at: number) => void) | null };
export const EARLY_STREAM = `(function(){try{var es=new EventSource(${JSON.stringify(STREAM_URL)}),s={es:es,q:[],sink:null};es.onmessage=function(e){var t=Date.now();s.sink?s.sink(e,t):s.q.push([e,t])};window.__earlyStream=s}catch(e){}})()`;
const adoptEarly = (): Early | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { __earlyStream?: Early };
  const s = w.__earlyStream ?? null;
  w.__earlyStream = undefined; // once: a reconnect opens a stream of its own
  if (!s || s.es.readyState === EventSource.CLOSED) { s?.es.close(); return null; }
  return s;
};

type MessageType =
  | 'snapshot'
  | 'stats'
  | 'game_state'
  | 'hand_start'
  | 'llm_thinking'
  | 'llm_action'
  | 'button_card'
  | 'button_winner'
  | 'table_notice'
  | 'table_stats';

// One SSE frame from the engine (engine/api/messages.go). snapshot and stats carry no table.
export interface ServerMessage {
  seq: number;
  table?: string;
  type: MessageType;
  payload?: unknown;
}

export interface ButtonCardPayload {
  playerIdx: number;
  playerName: string;
  card: string;
}

export interface ButtonWinnerPayload {
  playerIdx: number;
  playerName: string;
}

export interface PlayerState {
  id: string;
  name: string;
  stack: number;
  holeCards?: string[];
  status: string;
  currentBet: number;
  lastAction?: string;
  lastAmount?: number;
  acted?: boolean; // lastAction was taken on the current street (the engine's): otherwise the seat waits or thinks
  isButton: boolean;
  position: string; // from the engine, the same name the models see
  winnings: number;
}

interface Winner {
  playerIdx: number;
  amount: number;
  handType: string;
  handDesc: string;
}

export interface GameState {
  handNumber: number;
  street: string;
  pot: number;
  communityCards: string[];
  currentPlayerIdx: number;
  buttonIdx: number;
  players: PlayerState[];
  winners?: Winner[];
  stakes: {
    smallBlind: number;
    bigBlind: number;
  };
  gameStartTime: string; // ISO8601 timestamp from server
  nextHandInMs?: number; // Shared table: time until the server deals the next hand
  pace?: number; // Shared table: multiplier on every pause (the engine's TABLE_PACE); reasons type at 25 ms per character times it
}

// Why the shared table is stopped. An empty kind means it is running again.
export interface TableNoticePayload {
  kind: 'closed' | 'cap' | 'outage' | 'saving' | '';
  message: string;
  reopensAt?: string; // RFC3339
}

type ConnectionStatus = 'open' | 'reconnecting' | 'gave_up';

// The stream, reopened by this class on every error: EventSource never retries after a non-200
// answer (a 502 from the edge while the engine restarts), so its own retry is not relied on.
export class GameStream {
  private es: EventSource | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 2000;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  onStatus?: (status: ConnectionStatus) => void;
  onMessage?: (message: ServerMessage, receivedAt: number) => void; // receivedAt: Date.now() when it arrived

  // Resolves on the first open, rejects on the first error; later ones go to the reconnect loop.
  connect(): Promise<void> {
    this.es?.close();
    const early = adoptEarly();
    const es = (this.es = early?.es ?? new EventSource(STREAM_URL));
    return new Promise((resolve, reject) => {
      es.onopen = () => {
        this.onStatus?.('open');
        resolve();
      };
      if (early && es.readyState === 1) es.onopen(new Event('open')); // the early stream opened already (1: OPEN)
      es.onerror = () => {
        es.close();
        reject(new Error('stream error'));
        if (this.es !== es) return; // replaced or disconnected
        this.es = null;
        this.handleReconnect();
      };
      const onMessage = (event: MessageEvent, at = Date.now()) => {
        this.reconnectAttempts = 0; // a message (the snapshot first) proves the stream healthy; an open alone does not
        try {
          this.onMessage?.(JSON.parse(event.data) as ServerMessage, at);
        } catch (e) {
          console.error('Failed to parse message:', e);
        }
      };
      if (early) {
        early.sink = onMessage;
        early.q.splice(0).forEach(([e, at]) => onMessage(e, at));
      } else es.onmessage = e => onMessage(e);
    });
  }

  private handleReconnect() {
    if (this.reconnectTimeout) {
      return;
    }
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      this.onStatus?.('gave_up');
      return;
    }
    this.reconnectAttempts++;
    // The first reopen is spread over 1 s so a burst of viewers (the server ends every stream within 14 min) does not land at once.
    const delay = this.reconnectAttempts === 1
      ? Math.random() * 1000
      : this.reconnectDelay * this.reconnectAttempts * (0.5 + Math.random());
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect().catch(() => {}); // an error schedules the next attempt
    }, delay);
    this.onStatus?.('reconnecting');
  }

  // Start over after giving up: a fresh round of reconnect attempts.
  retry() {
    this.disconnect();
    this.onStatus?.('reconnecting');
    this.connect().catch(() => {}); // an error schedules the next attempt
  }

  disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.es?.close();
    this.es = null;
    this.reconnectAttempts = 0;
  }
}
