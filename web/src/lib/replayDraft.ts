'use client';

import { useSyncExternalStore } from 'react';

// The replay drafts (owner, 2026-11-28: "the replay happens for all three stats modules"): where the Stats screen's Replay
// lives. ?replay=a, one bar at the Stats screen's head that turns into a transport; ?replay=b, a Live | Replay switch there
// with the transport docked at the screen's foot. Without the switch (null) the page is as it was: Replay in Trends.
export type ReplayDraft = 'a' | 'b' | null;
let draft: ReplayDraft | undefined;
export const replayDraft = (): ReplayDraft => {
  if (typeof window === 'undefined') return null;
  if (draft === undefined) { const v = new URLSearchParams(location.search).get('replay'); draft = v === 'a' || v === 'b' ? v : null; }
  return draft;
};
const noSub = () => () => {};
export const useReplayDraft = () => useSyncExternalStore(noSub, replayDraft, () => null);
