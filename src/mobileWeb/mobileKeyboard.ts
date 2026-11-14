/** Keep a completed button click from dismissing a newly focused editor. */
export function installMobileKeyboard(doc: Document): () => void {
  const completedClick = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    // Opening the keyboard during pointerdown can resize and move a modal
    // before WebKit dispatches mousedown to the original touch coordinates.
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      target.focus({ preventScroll: true });
      return;
    }
    if (!target?.closest('input,textarea,[contenteditable],.bn-toolbar,[role="toolbar"]')) {
      const editing = doc.activeElement;
      queueMicrotask(() => {
        if (editing instanceof HTMLElement && doc.activeElement === editing && editing.matches('input,textarea,[contenteditable]')) editing.blur();
      });
    }
  };
  // Capture the previous editor before React can open and focus a new one.
  // Dismiss only after the completed click, preserving the touch coordinates.
  doc.addEventListener('click', completedClick, { capture: true });
  return () => {
    doc.removeEventListener('click', completedClick, { capture: true });
  };
}
