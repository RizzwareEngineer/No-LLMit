# UI Skin Configurations

Reference for the two approved skin options.

---

## Option 15: Japanese Minimalism ✓ (Really Liked)

**CornerBorders.tsx:**
```tsx
export default function CornerBorders() {
  return null;
}
```

**Layout.tsx:**
```tsx
import { Plus_Jakarta_Sans } from "next/font/google";
const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
});
// html: bg-neutral-50
// body: style={{ fontFamily: "var(--font-plus-jakarta)" }}
```

**Panel styles (inline):**
```tsx
style={{ border: '0.5px solid #e0e0e0', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}
```

**Internal borders:**
```
border-neutral-200
```

**Player component:**
```tsx
// Outer: bg-white (or bg-green-50 for winner), NO p-px padding
// Inner: bg-white hover:bg-neutral-50
```

**Page header:**
```tsx
<h1 className="text-2xl font-light tracking-[0.2em] text-neutral-700">NO-LLMIT</h1>
<p className="text-[10px] text-neutral-400 mt-2 font-light tracking-[0.15em]">...</p>
```

**Description:** Ultra-clean, zen-like aesthetic. Plus Jakarta Sans with light weights, wide letter-spacing, hair-thin 0.5px borders, subtle shadows, off-white background with pure white panels. No corner accents.

---

## Option 16: Notion SaaS ✓ (Really Liked) — CURRENT

**CornerBorders.tsx:**
```tsx
export default function CornerBorders() {
  return null;
}
```

**Layout.tsx:**
```tsx
// html: style={{ background: '#FFFFFF' }}
// body: 
style={{ 
  fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, 'Apple Color Emoji', Arial, sans-serif",
  color: 'rgb(55, 53, 47)',
  WebkitFontSmoothing: 'auto'
}}
```

**Panel styles:**
```tsx
className="bg-white rounded overflow-hidden"
style={{ boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px' }}
```

**Divider borders:**
```css
.border-notion { border-color: rgba(55, 53, 47, 0.09); }
```

**Card styles:**
```tsx
className="bg-white rounded"
style={{ boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px' }}
```

**Page header:**
```tsx
<h1 className="text-[28px] font-bold" style={{ color: 'rgb(55, 53, 47)', lineHeight: 1.2 }}>No-LLMit</h1>
<p className="text-[14px] mt-1" style={{ color: 'rgba(55, 53, 47, 0.65)' }}>...</p>
```

**Colors:**
- Text: `rgb(55, 53, 47)`
- Secondary text: `rgba(55, 53, 47, 0.65)`
- Blue accent: `rgb(35, 131, 226)`
- Success: `rgb(15, 123, 108)`
- Danger: `rgb(235, 87, 87)`

**Button styles:**
```css
.btn-brutal {
  background: rgb(35, 131, 226);
  color: #ffffff;
  border: none;
  font-weight: 500;
  border-radius: 4px;
  box-shadow: rgba(15, 15, 15, 0.1) 0px 0px 0px 1px inset;
}
```

**Description:** Authentic Notion aesthetic with system font stack, signature brown-gray text, blue accent buttons, subtle card shadows, and clean minimalist design.
