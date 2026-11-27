"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useReducedMotion } from "motion/react";
import Player, { LOGO_RIM } from "@/components/Player";
import TableFelt, { BetStack, FeltBet, GRID } from "@/components/TableFelt";
import TableMotion, { CARD_FLIGHT, DeckPhase, dealStart } from "@/components/TableMotion";
import { PlayerState, TableNoticePayload } from "@/lib/api";
import { ModelStats } from "@/lib/stats";
import { formatAmount, useBigBlind } from "@/lib/amounts";
import { FELT, LOGO, MIDDLE, POT_TOP, type Spot, css, seatPlace, seatSpots } from "@/lib/phoneTable";
import { useLayout, useTallTable } from "@/lib/tableSwitches";
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
  // Level of detail (the tables overview's semantic zoom): the table seen from far away, its seats and felt drawn for a
  // scale of 1/k (TableFar); `morph`: the full table with the far one over it, for the zoom between them (page.tsx fades
  // one into the other through --lod-t, globals.css).
  lod?: { k: number; morph?: boolean } | null;
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
  lod = null,
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

  const draftA = useSyncExternalStore(noSub, isDraftA, () => false);
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
  const seat = (idx: number, spot?: Spot) => blank ? <div data-seat={idx} className="h-full w-full rounded bg-white" style={cardStyle} /> : players[idx] && (
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
      far={spot ? undefined : lod?.k}
      morph={!!lod?.morph}
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
  // Draft A's tall table (?table=tall): each seat's slot (tallSlots) and its bet on the felt in front of it (TALL_BET).
  const tallSeats = tallSlots(players.length || 9);

  const felt = (compact = false, tallFelt = false) => (
    <TableFelt
      cards={communityCards}
      pot={pot}
      betsOut={betsOut}
      bets={compact || tallFelt ? undefined : feltBets}
      compact={compact}
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
      far={compact || tallFelt ? undefined : lod?.k}
      morph={!!lod?.morph}
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
        data-lod={lod ? (lod.morph ? 'morph' : 'far') : undefined}
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
      {/* Phones: one table and nothing else: the felt a tall oval on the page drawn as the desktop's grid, each seat a round logo on its edge
          with its position, stack, label and cards (Player's compact seat; phoneTable's geometry), each bet between its seat
          and the pot, the pot and the board in the middle, the deck over the pot between hands. A logo taps open its model's
          basic stats (SeatStats). data-oval: what the page watches for the bar. */}
      {mounted !== 'desk' && draftA && !tall && <Fit w={tableWidth} data-a-table className="md:hidden">{deskTable('block')}</Fit>}
      {/* Draft A's tall table (?table=tall): a vertical table seen at an angle that fills the screen, the odd seat on top
          (at the foot it would read as the viewer's own): the desktop's own seat cards (200x128, never resized), felt and pot, laid out TALL.w x TALL.h and drawn
          as one picture (Fit) in the first screen's room over the caption (globals.css). Seat 0 on top, three down each side,
          two at the foot. The felt is a 2D trapezoid with a
          converging grid (TALL_FELT), not a 3D transform: the rotateX felt inside Fit's scale drew leaning right in Safari
          (Chrome drew it straight), so the outline is computed and symmetric by construction.
          data-a-table: draft A's card sizes and bets (globals.css), and the page's watch for the bar. */}
      {mounted !== 'desk' && tall && <div data-tall-room className="md:hidden flex flex-col justify-center">
        <Fit w={TALL.w} contain data-a-table data-tall-table>
          <div className="relative" style={{ height: TALL.h }}>
            <svg data-tall-felt aria-hidden className="absolute inset-0" width={TALL.w} height={TALL.h} viewBox={`0 0 ${TALL.w} ${TALL.h}`} style={{ filter: 'drop-shadow(rgba(15, 15, 15, 0.1) 0px 2px 4px)' }}>
              <clipPath id="tall-felt"><path d={TALL_FELT.edge} /></clipPath>
              <path d={TALL_FELT.edge} fill="white" stroke="rgba(15, 15, 15, 0.1)" />
              <path d={TALL_FELT.grid} clipPath="url(#tall-felt)" stroke="rgba(0, 0, 0, 0.03)" fill="none" />
            </svg>
            <div className="absolute" style={TALL_MID}>{felt(false, true)}</div>
            {!blank && tallSeats.map((s, idx) => <BetStack key={idx} seat={idx} amount={players[idx]?.currentBet ?? 0} style={TALL_BET(s)} />)}
            {tallSeats.map((s, idx) => (
              // White under the card, as the desktop table is: a folded seat fades on white, not on the felt's edge.
              <div key={idx} className="absolute rounded bg-white" style={{ left: TALL_SLOTS[s][0], top: TALL_SLOTS[s][1], width: 200, height: 128 }}>{seat(idx)}</div>
            ))}
          </div>
        </Fit>
      </div>}
      {mounted !== 'desk' && !draftA && <div ref={oval} data-oval className="md:hidden relative w-full" style={{ height: 'var(--oval-h)', marginTop: 'calc(var(--phone-slack, 0px) / 2)' }}>
        <div data-felt-oval aria-hidden className="absolute bg-white" style={{ left: FELT.side, right: FELT.side, top: FELT.top, bottom: FELT.bottom, borderRadius: '50%', ...GRID, boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.06) 0px 6px 24px' }} />
        <div className="absolute left-1/2 -translate-x-1/2 w-[180px] h-[116px]" style={{ top: css([MIDDLE[0], MIDDLE[1] + POT_TOP]) }}>{felt(true)}</div>
        {!blank && seatSpots(players.length).map((spot, idx) => (
          <BetStack key={idx} seat={idx} amount={players[idx]?.currentBet ?? 0} compact
            style={{ left: css([spot.x[0], spot.x[1] + spot.bet[0]]), top: css([spot.y[0], spot.y[1] + spot.bet[1]]), transform: 'translate(-50%, -50%)' }} />
        ))}
        {seatSpots(players.length || 9).map((spot, idx) => blank ? (
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

// Draft A's tall table (PokerTable), in layout px of its picture. Every x pairs with its mirror (TALL.w - x - 200), so the
// table is symmetric about its middle. The felt: top and bottom edges at the top and foot seats' middles, half as wide as
// a and b (the far end about two thirds of the near one, a table seen from its foot); r its near corners' radius.
const TALL = { w: 760, h: 960, top: 64, bottom: 896, a: 170, b: 250, r: 40 };
// Each seat card's top left, clockwise from the top: down the right side, the foot (each centred in its half of the
// felt's bottom edge as drawn, round corners and all), up the left. Side rows evenly spaced, each moved in with the
// rail so it overlaps the felt by 50.
const TALL_SLOTS = [[280, 0], [520, 208], [540, 416], [560, 624], [403, 832], [157, 832], [0, 624], [20, 416], [40, 208]];
// Which slots a short table fills, in seat order: the side rows' middles go first, as pairs where they can.
const TALL_FILL: Record<number, number[]> = { 6: [0, 1, 3, 4, 6, 8], 7: [0, 1, 3, 4, 5, 6, 8], 8: [0, 1, 2, 3, 4, 5, 6, 8] };
const tallSlots = (count: number) => TALL_FILL[count] ?? TALL_SLOTS.map((_, i) => i).slice(0, count);
// The pot and board: across the felt between the middle row's seats, a little over its middle so the middle row's bets
// (TALL_BET, under each seat's middle) stay clear of the board; the button draw wraps to two rows in it.
const TALL_MID = { left: 220, top: 290, width: 320, height: 280 };
// A bet on the felt in front of its seat: under the top seat, over a foot seat, beside a side seat's lower half.
const TALL_BET = (slot: number) => {
  const [x, y] = TALL_SLOTS[slot];
  return slot === 0 ? { left: x + 100, top: y + 150, transform: 'translate(-50%, -50%)' }
    : slot === 4 || slot === 5 ? { left: x + 100, top: y - 24, transform: 'translate(-50%, -50%)' }
    : slot < 4 ? { right: TALL.w - x + 12, top: y + 104, transform: 'translateY(-50%)' }
    : { left: x + 212, top: y + 104, transform: 'translateY(-50%)' };
};
// The felt's outline (its corners rounded, the far ones smaller) and the desktop's 20px grid seen in perspective: lines
// that run up the table meet where the rails do; lines across it close up toward the far end.
const TALL_FELT = (() => {
  const { w, top, bottom, a, b, r } = TALL, c = w / 2, far = bottom - b * (bottom - top) / (b - a);
  const pts = [[c - b, bottom], [c - a, top], [c + a, top], [c + b, bottom]], radii = [r, r * a / b, r * a / b, r];
  const at = (p: number[], q: number[], d: number) => { const l = Math.hypot(q[0] - p[0], q[1] - p[1]); return [p[0] + (q[0] - p[0]) * d / l, p[1] + (q[1] - p[1]) * d / l]; };
  const f = (n: number) => +n.toFixed(2);
  const edge = pts.map((p, i) => {
    const s = at(p, pts[(i + 3) % 4], radii[i]), e = at(p, pts[(i + 1) % 4], radii[i]);
    return `${i ? 'L' : 'M'}${f(s[0])} ${f(s[1])}Q${p[0]} ${p[1]} ${f(e[0])} ${f(e[1])}`;
  }).join('') + 'Z';
  let grid = '';
  for (let k = -Math.ceil(b / 20); k <= Math.ceil(b / 20); k++) {
    const x = (y: number) => f(c + 20 * k * (y - far) / (bottom - far));
    grid += `M${x(top)} ${top}L${x(bottom)} ${bottom}`;
  }
  for (let y = bottom; y > top; y -= 15 * (y - far) / (bottom - far)) grid += `M0 ${f(y)}H${w}`;
  return { edge, grid };
})();

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

