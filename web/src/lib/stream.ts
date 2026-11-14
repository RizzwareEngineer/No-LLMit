// What the stream's messages do to the page's state (docs/stream.md). Pure, so the stream test runs it under plain Node.
import type { ButtonCardPayload, ButtonWinnerPayload, GameState, HandCompletePayload, ServerMessage, TableNoticePayload } from './api';
import type { ModelStats, StatsResponse } from './stats';

// Display phases for each LLM turn
export type DisplayPhase = 'idle' | 'waiting' | 'thinking' | 'reasoning' | 'revealed';

// What's currently being displayed to the user
export interface DisplayState {
  phase: DisplayPhase;
  playerIdx: number;
  playerName: string;
  reason: string | null;
  action: string | null;
  amount: number;
  turnStartTime: number; // For shot clock countdown
}

// Button determination state
export interface ButtonCard {
  playerIdx: number;
  playerName: string;
  card: string;
}

export interface ButtonDetermination {
  cards: ButtonCard[];
  winnerIdx: number | null;
  winnerName: string | null;
  isComplete: boolean;
}

interface LLMDecision {
  playerIdx: number;
  playerName: string;
  action: string;
  amount: number;
  reason: string;
}

// One table as the page knows it.
export interface TableView {
  gameState: GameState | null;
  notice: TableNoticePayload | null; // table closed, capped, in an outage or saving
  lastHandResult: HandCompletePayload | null;
  display: DisplayState | null;
  clock: { start: number; running: boolean } | null; // the shot clock: llm_thinking starts it, the next game_state stops it
  buttonDetermination: ButtonDetermination | null;
}

export type Tables = Record<string, TableView>;

export const EMPTY_TABLE: TableView = { gameState: null, notice: null, lastHandResult: null, display: null, clock: null, buttonDetermination: null };

type Turn = { type: 'llm_thinking' | 'llm_action'; payload: unknown };

interface SnapshotTable {
  state: GameState;
  turn: Turn | null;
  turnApplied: boolean; // turn is an llm_action the state already shows
  notice: TableNoticePayload | null;
  buttonCards: ButtonCardPayload[];
  buttonWinner: ButtonWinnerPayload | null;
}

// The server owns the clock: it sends llm_thinking, then llm_action, then the
// game_state with the action applied, each at the moment it should appear.
function applyTurn(v: TableView, turn: Turn, now: number): TableView {
  if (turn.type === 'llm_thinking') {
    const p = turn.payload as { playerIdx: number; playerName: string };
    return {
      ...v,
      display: { phase: 'thinking', playerIdx: p.playerIdx, playerName: p.playerName, reason: null, action: null, amount: 0, turnStartTime: now },
      clock: { start: now, running: true },
    };
  }
  const p = turn.payload as LLMDecision;
  const prev = v.display;
  return {
    ...v,
    display: {
      phase: 'reasoning',
      playerIdx: p.playerIdx,
      playerName: p.playerName,
      reason: p.reason,
      action: p.action,
      amount: p.amount,
      turnStartTime: prev?.playerIdx === p.playerIdx ? prev.turnStartTime : now,
    },
  };
}

// The action has been applied to the table: its reasoning is revealed and the shot clock stops.
function reveal(v: TableView): TableView {
  return {
    ...v,
    display: v.display?.phase === 'reasoning' ? { ...v.display, phase: 'revealed' } : v.display,
    clock: v.clock?.running ? { ...v.clock, running: false } : v.clock,
  };
}

function applyTableMessage(v: TableView, m: ServerMessage, now: number): TableView {
  switch (m.type) {
    case 'game_state':
      return reveal({ ...v, gameState: m.payload as GameState });
    case 'hand_complete':
      return { ...v, lastHandResult: m.payload as HandCompletePayload };
    case 'table_notice': {
      const notice = m.payload as TableNoticePayload;
      return { ...v, notice: notice.kind ? notice : null };
    }
    case 'hand_start':
      return { ...v, notice: null, lastHandResult: null, buttonDetermination: null, display: null, clock: null };
    case 'llm_thinking':
    case 'llm_action':
      return applyTurn(v, m as Turn, now);
    case 'button_card': {
      const bc = m.payload as ButtonCardPayload;
      return {
        ...v,
        buttonDetermination: {
          cards: [...(v.buttonDetermination?.cards || []), { playerIdx: bc.playerIdx, playerName: bc.playerName, card: bc.card }],
          winnerIdx: null,
          winnerName: null,
          isComplete: false,
        },
      };
    }
    case 'button_winner': {
      const bw = m.payload as ButtonWinnerPayload;
      const bd = v.buttonDetermination;
      return { ...v, buttonDetermination: bd ? { ...bd, winnerIdx: bw.playerIdx, winnerName: bw.playerName, isComplete: true } : null };
    }
  }
  return v;
}

// A snapshot replaces the table, except that the turn already on screen keeps its display object and shot clock,
// so a reconnect neither retypes the reasoning nor resets the clock; an action on screen as reasoning is revealed once
// the snapshot says it was applied. A thinking seat whose action came while the stream was down keeps its clock, as on
// a live llm_action.
function fromSnapshot(prev: TableView | undefined, s: SnapshotTable, now: number): TableView {
  const sameHand = prev?.gameState?.handNumber === s.state.handNumber;
  const base: TableView = {
    gameState: s.state,
    notice: s.notice,
    lastHandResult: sameHand ? prev!.lastHandResult : null,
    display: null,
    clock: null,
    buttonDetermination: s.buttonCards.length || s.buttonWinner
      ? {
        cards: s.buttonCards.map(c => ({ playerIdx: c.playerIdx, playerName: c.playerName, card: c.card })),
        winnerIdx: s.buttonWinner?.playerIdx ?? null,
        winnerName: s.buttonWinner?.playerName ?? null,
        isComplete: !!s.buttonWinner,
      }
      : null,
  };
  if (!s.turn) return base;
  const p = s.turn.payload as LLMDecision, d = sameHand && prev!.display?.playerIdx === p.playerIdx ? prev!.display : null;
  const kept = { ...base, display: d, clock: d && prev!.clock }; // this seat's turn as it is on screen
  const onScreen = s.turn.type === 'llm_thinking'
    ? d?.phase === 'thinking'
    : (d?.phase === 'reasoning' || d?.phase === 'revealed') && d.action === p.action && d.amount === p.amount && d.reason === p.reason;
  const v = onScreen ? kept : applyTurn(d?.phase === 'thinking' ? kept : base, s.turn, now);
  return s.turnApplied ? reveal(v) : v;
}

// Applies one table message, or a snapshot, which replaces every table (tables absent from it are dropped).
export function applyMessage(tables: Tables, m: ServerMessage, now: number): Tables {
  if (m.type === 'snapshot') {
    const snap = (m.payload as { tables: Record<string, SnapshotTable> }).tables;
    return Object.fromEntries(Object.entries(snap).map(([id, s]) => [id, fromSnapshot(tables[id], s, now)]));
  }
  if (!m.table) return tables;
  return { ...tables, [m.table]: applyTableMessage(tables[m.table] ?? EMPTY_TABLE, m, now) };
}

type ChangedStats = Omit<StatsResponse, 'models'> & { model_names: string[]; changed: ModelStats[] };

// A stats message: the full all-time body replaces the held one; the changed form replaces rows by model name.
export function applyStats(held: StatsResponse | null, payload: StatsResponse | ChangedStats): StatsResponse | null {
  if (!('changed' in payload)) return payload;
  if (!held) return held; // the full body always comes first on a stream
  const { model_names, changed, ...envelope } = payload;
  const byName = new Map(held.models.map(m => [m.name, m]));
  for (const row of changed) byName.set(row.name, row);
  return { ...envelope, models: model_names.flatMap(name => byName.get(name) ?? []) };
}
