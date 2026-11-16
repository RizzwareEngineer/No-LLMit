// A model's name in shorter forms, for a room too narrow for it whole (FitName): without its version numbers
// ("Nemotron 3.5 Super" → "Nemotron Super", "DeepSeek V4 Flash" → "DeepSeek Flash"), then without the maker's word as
// well ("Cohere Command R7B" → "Command R7B", "Claude Haiku 5.5" → "Haiku"). Longest first, each once.
export const shortName = (name: string) => name.split(' ').filter((w, i) => i === 0 || !/^V?\d+(\.\d+)*$/.test(w)).join(' ');
// Without the maker's word only where a name word is left ("Command R7B", "Haiku"), never a bare size ("GPT-OSS 120B"
// is not "120B").
const SIZE = /^\d+(\.\d+)?[BMK]$/i;
export const shorterName = (name: string) => { const w = shortName(name).split(' '), rest = w.slice(1); return rest.length && !rest.every(x => SIZE.test(x)) ? rest.join(' ') : w.join(' '); };
export const nameForms = (name: string) => [...new Set([name, shortName(name), shorterName(name)])];
