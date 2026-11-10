'use client';

import { memo } from 'react';
import SpecSheet from '@/components/about/SpecSheet';

// The About content: the /about page, and the home page's last screen (where the page's own h1 is the table's title, so
// About's first heading is an h2). Its parent sets the width (the stats overview's block on the home page). Memoized: the
// stats re-render as each hand lands and as screens change, and nothing About shows depends on them.
export default memo(function About({ heading = 'h1' }: { heading?: 'h1' | 'h2' }) {
  return <SpecSheet heading={heading} />;
});
