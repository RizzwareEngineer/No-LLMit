"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useReducedMotion } from "motion/react";
import Player, { LOGO_RIM } from "@/components/Player";
import TableFelt, { BetStack, FeltBet, GRID } from "@/components/TableFelt";
import TableMotion, { CARD_FLIGHT, DeckPhase, dealStart } from "@/components/TableMotion";
import { PlayerState, TableNoticePayload } from "@/lib/api";
import { ModelStats } from "@/lib/stats";
import { formatAmount, useBigBlind } from "@/lib/amounts";
import { FELT, LOGO, MIDDLE, POT_TOP, RADIUS, type Spot, css, seatPlace, seatSpots } from "@/lib/phoneTable";
import { useLayout, usePhoneShape, useSeatDraft, usePhoneDraft, useTallTable } from "@/lib/tableSwitches";
import SeatStats from "@/components/SeatStats";
import { isDraftA } from "@/lib/layout";
import Fit from "@/components/Fit";
const noSub = () => () => {};
import type { ButtonDetermination, Clock, DisplayState } from "@/lib/stream";

interface PlayerLayout {
  top: number[];
  left: number[];
  right: number[];
  bottom: number[];
}

interface WinnerInfo {
  amount: number;
  handDesc: string;
}

interface PokerTableProps {
  players: PlayerState[];
  currentPlayerIdx: number;
  communityCards: string[];
  pot: number;
  winnersByIdx?: Record<number, WinnerInfo>;
  nextDealAt?: number | null; // Date.now() of the next deal while the next-hand countdown shows (page.tsx); null: none
  thinkingPlayerIdx?: number;
  buttonDetermination?: ButtonDetermination | null;
  notice?: TableNoticePayload | null;
  street: string;
  handNumber: number;
  stats?: Record<string, ModelStats>; // by model name, for the phone seat's stats popup (SeatStats)
  display?: DisplayState | null; // the turn on screen: the phone shows each action over its seat for a moment
  clock?: Clock | null; // the shot clock while its turn is on screen (null: no clock): the phone's ring round the seat on the clock
  still?: boolean; // a small copy (the tables overview, the stage's edges): no flights, no deal and no sounds, which find the page's one felt
}

// The phone's action bubble: "Raise 79", "Call 10", "Fold".
const SAY: Record<string, string> = { FOLD: 'Fold', CHECK: 'Check', CALL: 'Call', RAISE: 'Raise', BET: 'Bet', ALL_IN: 'All-in' };

export default function PokerTable({
  players,
  currentPlayerIdx,
  communityCards,
  pot,
  winnersByIdx = {},
  nextDealAt = null,
  thinkingPlayerIdx,
  buttonDetermination,
  notice,
  street,
  handNumber,
  stats,
  display = null,
  clock = null,
  still = false,
}: PokerTableProps) {
  const layout = getPlayerLayout(players.length || 9);
  const hidePositions = !!buttonDetermination; // the position badges wait for the button draw
  // The engine keeps each seat's last action until the hand ends; it shows only once taken on this street (the engine's
  // `acted`). Before that the seat says WAITING, then THINKING on its turn, never an earlier street's action.
  const shown = (p: PlayerState) => !!p.acted;

  // The deal: a late joiner sees the hand already dealt; a hand dealt while watching shows each card as its flight
  // lands (TableMotion), unless motion is reduced. The deck is shuffled on the felt between hands.
  const reduce = useReducedMotion();
  const [firstHand, setFirstHand] = useState(0);
  if (!firstHand && handNumber && players.length) setFirstHand(handNumber);
  // A layout switch (lib/layout: a rotated tablet, a resize or zoom across it) mounts the other layout's seats: they show
  // the hand as it stands, not dealt again (no fade from nothing, no face down then turned over again). The hand on screen
  // when the shown layout last changed is that hand; the next one is dealt as usual.
  const mounted = useLayout(); // only the shown layout's table, once hydrated (null: both, CSS shows one)
  const [shownAt, setShownAt] = useState({ mounted, hand: 0 });
  if (mounted !== shownAt.mounted) setShownAt({ mounted, hand: handNumber });
  const switched = shownAt.hand > 0 && handNumber === shownAt.hand;
  const dealt = !reduce && !still && firstHand > 0 && handNumber !== firstHand && !switched;
  const [deck, setDeck] = useState<DeckPhase | null>(null);

  // Phones: a turn's action shows over its seat for 2 s once the table applies it (reasoning, then revealed), not for one
  // already applied when the page joined. The shot clock's ring is the share of the turn's budget left, the desktop clock's time.
  const bb = useBigBlind();
  const turnKey = display ? `${handNumber}:${display.turn}` : '';
  const [turn, setTurn] = useState({ key: '', phase: '', bubble: null as { seat: number; text: string } | null });
  if (turnKey !== turn.key || (display?.phase ?? '') !== turn.phase) {
    const said = display?.phase === 'revealed' && turn.key === turnKey && turn.phase === 'reasoning' && display.action;
    setTurn({
      key: turnKey,
      phase: display?.phase ?? '',
      bubble: said ? { seat: display.playerIdx, text: `${SAY[display.action!] ?? display.action}${display.amount > 0 && display.action !== 'FOLD' && display.action !== 'CHECK' ? ` ${formatAmount(display.amount, bb)}` : ''}` } : turn.bubble,
    });
  }
  useEffect(() => {
    if (!turn.bubble) return;
    const t = setTimeout(() => setTurn(v => ({ ...v, bubble: null })), 2000);
    return () => clearTimeout(t);
  }, [turn.bubble]);

  const shape = usePhoneShape(), draft = useSeatDraft(), phoneDraft = usePhoneDraft(), draftA = useSyncExternalStore(noSub, isDraftA, () => false);
  const tall = useTallTable() && draftA;
  // The phone seat whose stats are open (SeatStats), and the table's middle in the window then, where they show. The
  // popup is the phone table's: when the desktop table replaces it, it closes, and does not come back on the next switch.
  const [open, setOpen] = useState<{ seat: number; at: { x: number; y: number } } | null>(null);
  if (mounted === 'desk' && open) setOpen(null);
  const oval = useRef<HTMLDivElement>(null);
  const openStats = (seat: number) => {
    const b = oval.current?.getBoundingClientRect();
    if (b) setOpen({ seat, at: { x: b.left + b.width / 2, y: b.top + b.height / 2 } });
  };
  const closeStats = useCallback(() => setOpen(null), []);

  const cardStyle = { boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px' };
  // Until the first state arrives (`players` empty) the table stands in blank: the same grid, a blank seat box in every
  // seat of the default lineup (the page's layout for 9) and the felt with nothing on it, so nothing moves when it fills.
  const blank = players.length === 0;
  const seat = (idx: number, spot?: Spot, narrow = false) => blank ? <div data-seat={idx} className="h-full w-full rounded bg-white" style={cardStyle} /> : players[idx] && (
    <Player
      player={players[idx]}
      active={idx === currentPlayerIdx && street !== 'complete'} // between hands nobody is on the clock
      position={hidePositions ? '' : players[idx].position}
      winAmount={winnersByIdx[idx]?.amount}
      winDesc={winnersByIdx[idx]?.handDesc}
      isThinking={idx === thinkingPlayerIdx}
      showAction={shown(players[idx])}
      seatIdx={idx}
      handNumber={handNumber}
      fillIn={!switched}
      dealDelays={dealt ? [0, 1].map(round => dealStart(players, idx, round) + CARD_FLIGHT) : undefined}
      compact={!!spot}
      spot={spot}
      ring={spot && idx === currentPlayerIdx ? clock : undefined}
      onOpen={spot ? () => openStats(idx) : undefined}
      bubble={spot && turn.bubble?.seat === idx ? turn.bubble.text : undefined}
      narrow={narrow}
    />
  );

  // Each seat's bet sits on the felt edge it faces, centred on the seat's column or row.
  const rows = Math.max(layout.left.length, layout.right.length); // left/right seats per side
  const betsOut = players.reduce((sum, p) => sum + p.currentBet, 0);
  const edge = (side: FeltBet['side'], seats: number[], n: number) =>
    seats.map((seat, i) => ({ seat, side, at: (i + 0.5) / n, amount: players[seat]?.currentBet ?? 0 }));
  const feltBets: FeltBet[] = [
    ...edge('top', layout.top, layout.top.length),
    ...edge('bottom', layout.bottom, layout.bottom.length),
    ...edge('left', layout.left, rows),
    ...edge('right', layout.right, rows),
  ];
  // Draft B (?phone=b): the desktop table turned a quarter clockwise for a phone held upright, seats in the same order. The
  // desktop's top row runs down the right side, its right side along the bottom, its bottom row up the left side, its left
  // side along the top. The side with fewer seats splits its length between them, as the desktop's bottom row does.
  const up = { top: [...layout.left].reverse(), right: layout.top, bottom: [...layout.right].reverse(), left: layout.bottom };
  const upRows = Math.max(up.left.length, up.right.length, 1);
  const upBets: FeltBet[] = [
    ...edge('top', up.top, up.top.length),
    ...edge('bottom', up.bottom, up.bottom.length),
    ...edge('left', up.left, up.left.length),
    ...edge('right', up.right, up.right.length),
  ];

  // Draft A's tall table (?table=tall): the top seat's bet on the middle's top edge, each side seat's beside it on its row.
  const tallSeats = tallLayout(players.length || 9);
  const tallBets: FeltBet[] = [
    { seat: 0, side: 'top', at: 0.5, amount: players[0]?.currentBet ?? 0 },
    ...tallSeats.right.map((seat, i) => ({ seat, side: 'right' as const, at: (TALL_ROWS[i] + 64 - TALL_MID.top) / TALL_MID.h, amount: players[seat]?.currentBet ?? 0 })),
    ...tallSeats.left.map((seat, i) => ({ seat, side: 'left' as const, at: (TALL_ROWS[i] + 64 - TALL_MID.top) / TALL_MID.h, amount: players[seat]?.currentBet ?? 0 })),
  ];

  const felt = (compact = false, upright = false, tallFelt = false) => (
    <TableFelt
      cards={communityCards}
      pot={pot}
      betsOut={betsOut}
      bets={compact ? undefined : tallFelt ? tallBets : upright ? upBets : feltBets}
      compact={compact}
      upright={upright}
      plain={tallFelt}
      winners={Object.entries(winnersByIdx).map(([idx, info]) => ({
        name: players[Number(idx)]?.name || `Player ${idx}`,
        amount: info.amount,
        handDesc: info.handDesc,
      }))}
      nextDealAt={nextDealAt}
      buttonDetermination={buttonDetermination}
      notice={notice}
      deck={deck}
      blank={blank}
      fillIn={!switched}
    />
  );

  // Calculate fixed width based on layout
  const numCols = layout.top.length + (layout.left.length > 0 ? 1 : 0) + (layout.right.length > 0 ? 1 : 0);
  const tableWidth = numCols * 200;
  const line = '1px solid rgba(55, 53, 47, 0.09)';

  // The desktop table: seats round the felt; the table is only for layout. Phone draft A (app/a) draws it on a phone too,
  // at its own proportions (200x128 cells), scaled as one picture to the page's width (Fit).
  const deskTable = (cls: string) => (
      <div
        data-desk-table
        className={`${cls} relative bg-white shrink-0 self-stretch rounded`}
        style={{ width: tableWidth, ...cardStyle }}
      >
        <table role="presentation" className="table-fixed w-full h-full" style={{ borderCollapse: 'collapse', borderSpacing: 0 }}>
          <tbody>
            {/* TOP ROW */}
            <tr>
              {layout.left.length > 0 && (
                <td className="w-[200px] h-[128px]" style={{ borderRight: line, borderBottom: line }} />
              )}
              {layout.top.map((idx, i) => (
                <td
                  key={`top-${idx}`}
                  className="w-[200px] h-[128px]"
                  style={{ borderBottom: line, borderRight: i < layout.top.length - 1 ? line : undefined }}
                >
                  {seat(idx)}
                </td>
              ))}
              {layout.right.length > 0 && (
                <td className="w-[200px] h-[128px]" style={{ borderLeft: line, borderBottom: line }} />
              )}
            </tr>

            {/* MIDDLE ROWS */}
            {Array.from({ length: rows }).map((_, rowIdx) => (
              <tr key={`middle-${rowIdx}`}>
                {layout.left.length > 0 && (
                  <td className="w-[200px] h-[128px]" style={{ borderRight: line, borderBottom: line }}>
                    <div className="flex justify-end h-full">
                      {layout.left[rowIdx] !== undefined && seat(layout.left[rowIdx])}
                    </div>
                  </td>
                )}

                {rowIdx === 0 && (
                  <td colSpan={layout.top.length} rowSpan={rows} style={{ borderBottom: line }}>
                    <div className="flex items-center justify-center h-full">{felt()}</div>
                  </td>
                )}

                {layout.right.length > 0 && (
                  <td className="w-[200px] h-[128px]" style={{ borderLeft: line, borderBottom: line }}>
                    <div className="flex justify-start h-full">
                      {layout.right[rowIdx] !== undefined && seat(layout.right[rowIdx])}
                    </div>
                  </td>
                )}
              </tr>
            ))}

            {/* BOTTOM ROW */}
            <tr>
              {layout.left.length > 0 && (
                <td className="w-[200px] h-[128px]" style={{ borderRight: line }} />
              )}
              <td colSpan={layout.top.length} className="h-[128px] p-0">
                <div className="flex h-full">
                  {layout.bottom.map((playerIdx, i) => (
                    <div
                      key={`bottom-${playerIdx}`}
                      className="flex-1"
                      style={{ borderRight: i < layout.bottom.length - 1 ? line : undefined }}
                    >
                      {seat(playerIdx)}
                    </div>
                  ))}
                </div>
              </td>
              {layout.right.length > 0 && (
                <td className="w-[200px] h-[128px]" style={{ borderLeft: line }} />
              )}
            </tr>
          </tbody>
        </table>
      </div>
  );

  return (
    <>
      {!blank && !still && <TableMotion
        players={players}
        handNumber={handNumber}
        boardCount={communityCards.length}
        winnerIdxs={Object.keys(winnersByIdx).map(Number)}
        nextDealAt={street === 'complete' ? nextDealAt : null}
        onDeck={setDeck}
        notice={!!notice}
      />}
      {/* Phones: one table and nothing else (owner 2026-11-14: "just do logos with positions and stack sizes and cards then pot
          in the middle"): the felt a tall oval on the page (or a draft shape, ?shape=rect or ?shape=stadium) drawn as the
          desktop's grid (owner 2026-11-15: "the felt, I think, should still be a grid"), each seat a round logo on its edge
          with its position, stack, label and cards (Player's compact seat; phoneTable's geometry), each bet between its seat
          and the pot, the pot and the board in the middle, the deck over the pot between hands. A logo taps open its model's
          basic stats (SeatStats). data-oval: what the page watches for the bar. */}
      {mounted !== 'desk' && draftA && !tall && <Fit w={tableWidth} data-a-table className="md:hidden">{deskTable('block')}</Fit>}
      {/* Draft A's tall table (?table=tall; owner, 2026-11-26: "turn our table into a vertical table with an angle that will
          fill the screen", "i want the extra player to be on the top ... otherwise it might make people think they're
          player"): the desktop's own seat cards (200x128, never resized), felt and pot, laid out 720x960 and drawn as one
          picture (Fit) in the first screen's room over the caption (globals.css). Only the felt is drawn tilted away, its far
          end about 84% of its near end; it is laid out taller than it is drawn, so its drawn top is at 64, under the top
          seat's middle. The seats straddle its rail, the upper rows moved in as it narrows (TALL_IN), and nothing sits at the
          foot. data-a-table: draft A's card sizes and bets (globals.css), and the page's watch for the bar. */}
      {mounted !== 'desk' && tall && <div data-tall-room className="md:hidden flex flex-col justify-center">
        <Fit w={720} contain data-a-table data-tall-table>
          <div className="relative" style={{ height: 960 }}>
            <div data-tall-felt aria-hidden className="absolute bg-white" style={{ left: 90, width: 540, top: -131, height: 1091, borderRadius: 48, ...GRID, ...cardStyle, transform: 'perspective(1200px) rotateX(12.1deg)', transformOrigin: '50% 100%' }} />
            <div className="absolute" style={{ left: TALL_MID.left, top: TALL_MID.top, width: TALL_MID.w, height: TALL_MID.h }}>{felt(false, false, true)}</div>
            {[[0, 260, 0], ...tallSeats.right.map((idx, i) => [idx, 520 - TALL_IN[i], TALL_ROWS[i]]), ...tallSeats.left.map((idx, i) => [idx, TALL_IN[i], TALL_ROWS[i]])].map(([idx, x, y]) => (
              // White under the card, as the desktop table is: a folded seat fades on white, not on the felt's edge.
              <div key={idx} className="absolute rounded bg-white" style={{ left: x, top: y, width: 200, height: 128 }}>{seat(idx)}</div>
            ))}
          </div>
        </Fit>
      </div>}
      {mounted !== 'desk' && !draftA && phoneDraft && <div data-upright className="md:hidden w-full bg-white rounded overflow-hidden" style={{ ...cardStyle, marginTop: 'calc(var(--phone-slack, 0px) / 2)' }}>
        <div className="grid" style={{ gridTemplateColumns: '1fr 2fr 1fr', gridTemplateRows: `112px ${upRows * 112}px 112px` }}>
          <div style={{ borderRight: line, borderBottom: line }} />
          <div className="flex min-w-0" style={{ borderBottom: line }}>
            {up.top.map((idx, i) => <div key={idx} className="flex-1 min-w-0" style={{ borderRight: i < up.top.length - 1 ? line : undefined }}>{seat(idx, undefined, true)}</div>)}
          </div>
          <div style={{ borderLeft: line, borderBottom: line }} />
          <div className="flex flex-col min-w-0" style={{ borderRight: line, borderBottom: line }}>
            {up.left.map((idx, i) => <div key={idx} className="flex-1 min-h-0" style={{ borderBottom: i < up.left.length - 1 ? line : undefined }}>{seat(idx, undefined, true)}</div>)}
          </div>
          <div className="min-w-0" style={{ borderBottom: line }}>{felt(false, true)}</div>
          <div className="flex flex-col min-w-0" style={{ borderLeft: line, borderBottom: line }}>
            {up.right.map((idx, i) => <div key={idx} className="flex-1 min-h-0" style={{ borderBottom: i < up.right.length - 1 ? line : undefined }}>{seat(idx, undefined, true)}</div>)}
          </div>
          <div style={{ borderRight: line }} />
          <div className="flex min-w-0">
            {up.bottom.map((idx, i) => <div key={idx} className="flex-1 min-w-0" style={{ borderRight: i < up.bottom.length - 1 ? line : undefined }}>{seat(idx, undefined, true)}</div>)}
          </div>
          <div style={{ borderLeft: line }} />
        </div>
      </div>}
      {mounted !== 'desk' && !draftA && !phoneDraft && <div ref={oval} data-oval data-shape={shape} data-seat-draft={draft} className="md:hidden relative w-full" style={{ height: 'var(--oval-h)', marginTop: 'calc(var(--phone-slack, 0px) / 2)' }}>
        <div data-felt-oval aria-hidden className="absolute bg-white" style={{ left: FELT.side, right: FELT.side, top: FELT.top, bottom: FELT.bottom, borderRadius: RADIUS[shape], ...GRID, boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.06) 0px 6px 24px' }} />
        <div className="absolute left-1/2 -translate-x-1/2 w-[180px] h-[116px]" style={{ top: css([MIDDLE[0], MIDDLE[1] + POT_TOP]) }}>{felt(true)}</div>
        {!blank && seatSpots(players.length, shape, draft).map((spot, idx) => (
          <BetStack key={idx} seat={idx} amount={players[idx]?.currentBet ?? 0} compact
            style={{ left: css([spot.x[0], spot.x[1] + spot.bet[0]]), top: css([spot.y[0], spot.y[1] + spot.bet[1]]), transform: 'translate(-50%, -50%)' }} />
        ))}
        {seatSpots(players.length || 9, shape, draft).map((spot, idx) => blank ? (
          // Until the first state: each seat's logo, blank, where it will be.
          <div key={idx} data-seat={idx} className="absolute pointer-events-none" style={seatPlace(spot).style}>
            <div className="absolute rounded-full bg-white" style={{ left: seatPlace(spot).logo[0] - LOGO / 2, top: seatPlace(spot).logo[1] - LOGO / 2, width: LOGO, height: LOGO, ...LOGO_RIM }} />
          </div>
        ) : <span key={players[idx]?.id ?? idx} className="contents">{seat(idx, spot)}</span>)}
        {open && players[open.seat] && <SeatStats name={players[open.seat].name} stats={stats?.[players[open.seat].name]} at={open.at} onClose={closeStats} />}
      </div>}

      {mounted !== 'phone' && deskTable('hidden md:block')}
    </>
  );
}

// Draft A's tall table (PokerTable, layout px of its 720x960 picture): each side row's top, how far each row moves in from
// the picture's edge to stay over the narrowing rail, and the pot and board's box, between the side columns across their rows.
const TALL_ROWS = [190, 387, 584, 781], TALL_IN = [24, 16, 8, 0];
const TALL_MID = { left: 224, top: 190, w: 272, h: 719 };
// Seat 0 at the top, then clockwise: down the right side, up the left.
// shortcut: 6-8 seats fill each side's rows from the top (the lower rows left empty); spread them if short tables come back.
function tallLayout(count: number) {
  const r = Math.ceil((count - 1) / 2);
  return { right: Array.from({ length: r }, (_, i) => i + 1), left: Array.from({ length: count - 1 - r }, (_, i) => count - 1 - i) };
}

// Helper function to get player layout based on count (6-9 players)
function getPlayerLayout(count: number): PlayerLayout {
  switch (count) {
    case 6:
      return { top: [0, 1], left: [5], right: [2], bottom: [4, 3] };
    case 7:
      return { top: [0, 1, 2], left: [6], right: [3], bottom: [5, 4] };
    case 8:
      return { top: [0, 1], left: [7, 6], right: [2, 3], bottom: [5, 4] };
    case 9:
      return { top: [0, 1, 2], left: [8, 7], right: [3, 4], bottom: [6, 5] };
    default:
      return { top: [], left: [], right: [], bottom: [] };
  }
}

