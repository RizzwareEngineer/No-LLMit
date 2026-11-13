// Game stream client for No-LLMit: Server-Sent Events from the engine (docs/stream.md)

// The deploy setting is still the engine's old WebSocket address, so no Vercel setting changes.
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8080/ws';

// The engine's HTTP address
export const API_URL = WS_URL.replace(/^ws/, 'http').replace(/\/ws$/, '');
const STREAM_URL = `${API_URL}/stream`;

export type MessageType =
  | 'snapshot'
  | 'stats'
  | 'game_state'
  | 'hand_start'
  | 'street_change'
  | 'hand_complete'
  | 'llm_thinking'
  | 'llm_action'
  | 'button_card'
  | 'button_winner'
  | 'table_notice';

// One SSE frame from the engine (docs/stream.md). snapshot and stats carry no table.
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
  isButton: boolean;
  position: string; // from the engine, the same name the models see
  winnings: number;
}

export interface Winner {
  playerIdx: number;
  amount: number;
  handType: string;
  handDesc: string;
}

export interface GameState {
  id: string;
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
  peeked?: number[]; // seats whose turn has come this hand (face up); always sent by the engine, [] when none
}

// Why the shared table is stopped. An empty kind means it is running again.
export interface TableNoticePayload {
  kind: 'closed' | 'cap' | 'outage' | 'saving' | '';
  message: string;
  reopensAt?: string; // RFC3339
}

export type ConnectionStatus = 'open' | 'reconnecting' | 'gave_up';

// The stream, reopened by this class on every error: EventSource never retries after a non-200
// answer (a 502 from the edge while the engine restarts), so its own retry is not relied on.
export class GameStream {
  private es: EventSource | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 2000;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  onStatus?: (status: ConnectionStatus) => void;
  onMessage?: (message: ServerMessage) => void;

  // Resolves on the first open, rejects on the first error; later ones go to the reconnect loop.
  connect(): Promise<void> {
    this.es?.close();
    const es = (this.es = new EventSource(STREAM_URL));
    return new Promise((resolve, reject) => {
      es.onopen = () => {
        this.onStatus?.('open');
        resolve();
      };
      es.onerror = () => {
        es.close();
        reject(new Error('stream error'));
        if (this.es !== es) return; // replaced or disconnected
        this.es = null;
        this.handleReconnect();
      };
      es.onmessage = (event) => {
        this.reconnectAttempts = 0; // a message (the snapshot first) proves the stream healthy; an open alone does not
        try {
          this.onMessage?.(JSON.parse(event.data) as ServerMessage);
        } catch (e) {
          console.error('Failed to parse message:', e);
        }
      };
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
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.reconnectAttempts = 0;
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
