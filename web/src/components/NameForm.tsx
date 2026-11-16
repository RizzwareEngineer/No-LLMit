"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { nameForms } from "@/lib/names";

// A model's name inside a box capped by max-width (a phone's Profiles name, a phone's Matchups row label): the longest of
// its forms (lib/names) that fits the cap whole, so a row reads "Nemotron Super", not "Nemotron 3...." (an ellipsis after
// the version's point). The box keeps the full name as its title; uncapped, the name shows whole.
export default function NameForm({ name }: { name: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [form, setForm] = useState(name);
  useLayoutEffect(() => {
    const host = ref.current?.parentElement;
    if (!host) return;
    // Each form is tried in place (the host's own font, tabular figures and all) and the text put back: React renders
    // the chosen one.
    const fit = () => {
      const el = ref.current;
      if (!el || !(parseFloat(getComputedStyle(host).maxWidth) > 0)) { setForm(name); return; }
      const was = el.textContent, forms = nameForms(name);
      let pick = forms.at(-1)!;
      for (const f of forms) { el.textContent = f; if (host.scrollWidth <= host.clientWidth) { pick = f; break; } }
      el.textContent = was;
      setForm(pick);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(host.closest(".card-chrome") ?? document.documentElement);
    return () => ro.disconnect();
  }, [name]);
  return <span ref={ref}>{form}</span>;
}
