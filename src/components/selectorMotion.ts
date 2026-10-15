/** Shared unfolding effect for the vault and interface selectors. */
export function selectorPanelMotion(reduced: boolean) {
  return {
    initial: { opacity: reduced ? 1 : 0, scaleY: reduced ? 1 : 0.8, y: reduced ? 0 : -8 },
    animate: { opacity: 1, scaleY: 1, y: 0 },
    exit: { opacity: 0, scaleY: reduced ? 1 : 0.85, y: reduced ? 0 : -8 },
    transition: { duration: reduced ? 0 : 0.16, ease: 'easeOut' as const },
  };
}
