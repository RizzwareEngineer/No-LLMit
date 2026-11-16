// A model's name in shorter forms, for a room too narrow for it whole (FitName): without its version numbers
// ("Nemotron 3.5 Super" → "Nemotron Super", "DeepSeek V4 Flash" → "DeepSeek Flash"), then without the maker's word as
// well ("Cohere Command R7B" → "Command R7B", "Claude Haiku 5.5" → "Haiku"). Longest first, each once.
export const shortName = (name: string) => name.split(' ').filter((w, i) => i === 0 || !/^V?\d+(\.\d+)*$/.test(w)).join(' ');
// Without the maker's word only where two words are left that are not all sizes ("Command R7B"): a lone "Flash" or
// "Super" could be several models, and "120B" or "235B A22B" is no name.
const SIZE = /^[A-Z]?\d+(\.\d+)?[BMK]$/i;
export const shorterName = (name: string) => { const w = shortName(name).split(' '), rest = w.slice(1); return rest.length >= 2 && !rest.every(x => SIZE.test(x)) ? rest.join(' ') : w.join(' '); };
// Without a size that follows another size ("Qwen3 235B A22B" → "Qwen3 235B": the active-parameter count after the
// total), so it keeps its first, non-size word and is never a bare size.
export const fewerSizes = (name: string) => { const w = shortName(name).split(' '); return w.length >= 3 && SIZE.test(w.at(-1)!) && SIZE.test(w.at(-2)!) ? w.slice(0, -1).join(' ') : w.join(' '); };
export const nameForms = (name: string) => [...new Set([name, shortName(name), shorterName(name), fewerSizes(name)])].sort((a, b) => b.length - a.length);
