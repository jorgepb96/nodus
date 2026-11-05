/** Preserve KaTeX's indivisible structures at their reading size. Only an
 * explicit expanded inspector may pan sideways; the report itself never does. */
export function formulaExpansionControls(host: HTMLElement, onExpand: (value: {latex: string; width: number}) => void) {
  const controls = new Map<HTMLElement, HTMLButtonElement>();
  return () => {
    for (const display of host.querySelectorAll<HTMLElement>('.katex-display')) {
      const math = display.querySelector<HTMLElement>(':scope > .katex');
      const latex = display.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
      const overflow = math && math.scrollWidth > display.clientWidth + 1;
      const existing = controls.get(display);
      if (!math || !overflow || !latex) { existing?.remove(); controls.delete(display); continue; }
      if (existing) continue;
      const button = document.createElement('button');
      button.dataset.proseFormulaExpand = 'true'; button.dataset.readerIgnore = 'true';
      button.className = 'prose-formula-expand'; button.textContent = 'Ver fórmula completa';
      button.setAttribute('aria-label', 'Abrir fórmula completa a su tamaño de lectura');
      button.onclick = () => onExpand({latex, width: math.scrollWidth});
      display.after(button); controls.set(display, button);
    }
  };
}
