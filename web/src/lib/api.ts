// WebSocket API client for No-LLMit

export const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8080/ws';

export type MessageType = 
  | 'new_game'
  | 'start_hand'
  | 'action'
  | 'get_state'
  | 'game_state'
  | 'error'
  | 'hand_start'
  | 'action_required'
  | 'street_change'
  | 'hand_complete'
  | 'pot_awarded';

export interface ClientMessage {
  type: MessageType;
  payload?: unknown;
}

export interface ServerMessage {
  type: MessageType;
  payload?: unknown;
}

export interface NewGamePayload {
  playerNames: string[];
  startingStack: number;
  smallBlind: number;
  bigBlind: number;
  mode: 'simulate' | 'play' | 'test';
  userSeatIdx?: number;
}

export interface ActionPayload {
  playerIdx: number;
  action: 'fold' | 'check' | 'call' | 'raise' | 'all-in';
  amount?: number;
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
  winnings: number;
}

export interface ValidAction {
  type: string;
  minAmount?: number;
  maxAmount?: number;
}

export interface Winner {
  playerIdx: number;
  amount: number;
  handType: string;
  handDesc: string;
  eligiblePlayers: number[]; // Player indices who competed for this pot
  potNumber: number;         // 1 = main pot, 2+ = side pots
}

export interface GameState {
  id: string;
  handNumber: number;
  street: string;
  pot: number;
  communityCards: string[];
  currentBet: number;
  minRaise: number;
  currentPlayerIdx: number;
  buttonIdx: number;
  players: PlayerState[];
  validActions?: ValidAction[];
  winners?: Winner[];
  mode: string;
  stakes: {
    smallBlind: number;
    bigBlind: number;
  };
  gameStartTime: string; // ISO8601 timestamp from server
}

export interface ActionRequiredPayload {
  playerIdx: number;
  playerName: string;
  validActions: ValidAction[];
  timeoutMs?: number;
}

export interface HandCompletePayload {
  winners: Winner[];
  handNumber: number;
}

export interface ErrorPayload {
  message: string;
}

// WebSocket wrapper class
export class PokerWebSocket {
  private ws: WebSocket | null = null;
  private messageHandlers: Map<MessageType, ((payload: unknown) => void)[]> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

  constructor(private url: string = WS_URL) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          console.log('WebSocket connected');
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onclose = (event) => {
          console.log('WebSocket closed:', event.code, event.reason);
          this.handleReconnect();
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          reject(error);
        };

        this.ws.onmessage = (event) => {
          try {
            const message: ServerMessage = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (e) {
            console.error('Failed to parse message:', e);
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  private handleReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`Reconnecting... attempt ${this.reconnectAttempts}`);
      setTimeout(() => this.connect(), this.reconnectDelay * this.reconnectAttempts);
    }
  }

  private handleMessage(message: ServerMessage) {
    const handlers = this.messageHandlers.get(message.type);
    if (handlers) {
      handlers.forEach(handler => handler(message.payload));
    }
  }

  on(type: MessageType, handler: (payload: unknown) => void) {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, []);
    }
    this.messageHandlers.get(type)!.push(handler);
  }

  off(type: MessageType, handler: (payload: unknown) => void) {
    const handlers = this.messageHandlers.get(type);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  send(message: ClientMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.error('WebSocket not connected');
    }
  }

  // Convenience methods
  newGame(payload: NewGamePayload) {
    this.send({ type: 'new_game', payload });
  }

  startHand() {
    this.send({ type: 'start_hand' });
  }

  action(payload: ActionPayload) {
    this.send({ type: 'action', payload });
  }

  getState() {
    this.send({ type: 'get_state' });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

