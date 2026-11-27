// The model drawer's code (its chart, its tables), not in the first load: it loads with the stats (StatsSections starts
// it), or as a pointer or a touch comes to a model's link, so it opens at once; a link opened before then waits for it.
// Every route loads it through here, so the page learns it is in however it came (onDrawerLoaded): a line that said a
// load failed goes once a later one succeeds. A failed load is forgotten, so the next one tries again.
type Drawer = typeof import('@/components/ModelDrawer');
let chunk: Promise<Drawer> | null = null;
export let ModelDrawer: Drawer['default'] | null = null; // once loaded (a live binding)
const loaded = new Set<() => void>();
export const loadDrawer = () => chunk ??= import('@/components/ModelDrawer').catch(() => import('@/components/ModelDrawer'))
  .then(m => { ModelDrawer = m.default; loaded.forEach(f => f()); return m; }, e => { chunk = null; throw e; });
export const onDrawerLoaded = (f: () => void) => { loaded.add(f); return () => { loaded.delete(f); }; };
