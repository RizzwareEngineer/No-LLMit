import { GameController } from '@phosphor-icons/react';

// The disabled "play against the LLMs" button: the home page's action row and About's "What's next" show the same one.
export default function PlaySoonButton() {
  return (
    <button disabled className="btn-brutal-disabled px-3 py-1 text-[14px] flex items-center gap-2">
      <GameController size={14} weight="bold" />
      Play vs. LLMs — (coming soon)!
    </button>
  );
}
