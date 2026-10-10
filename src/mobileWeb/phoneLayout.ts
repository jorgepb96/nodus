/** The host chooses the device idiom, independently of orientation or pane width. */
export function isPhoneSurface(): boolean {
  return (window as unknown as { nodusMobileConfig?: { device?: string } }).nodusMobileConfig?.device === 'phone';
}
