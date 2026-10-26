/** load() already reconciles the device checkpoint with the durable Mac ledger.
 * Only a still unfinished, matching request resumes. Definite source conflicts
 * need an explicit new generation, while their paid response remains readable. */
export function resumeAcademicGeneration(previous:{id:string;request:unknown;state:string}|null,request:unknown):boolean {
  const stable=(value:unknown):unknown=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'
    ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,stable(item)])) : value;
  return !!previous && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(previous.id)
    && ['accepted','running','saved'].includes(previous.state)
    && JSON.stringify(stable(previous.request))===JSON.stringify(stable(request));
}
