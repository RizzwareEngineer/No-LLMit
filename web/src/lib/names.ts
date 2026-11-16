// A model's name in shorter forms, for a room too narrow for it whole (FitName): without its version numbers
// ("Nemotron 3.5 Super" → "Nemotron Super", "DeepSeek V4 Flash" → "DeepSeek Flash"), then without the maker's word as
// well ("Cohere Command R7B" → "Command R7B", "Claude Haiku 5.5" → "Haiku"). Longest first, each once.
export const shortName = (name: string) => name.split(' ').filter((w, i) => i === 0 || !/^V?\d+(\.\d+)*$/.test(w)).join(' ');
export const shorterName = (name: string) => { const w = shortName(name).split(' '); return w.length > 1 ? w.slice(1).join(' ') : w[0]; };
export const nameForms = (name: string) => [...new Set([name, shortName(name), shorterName(name)])];
