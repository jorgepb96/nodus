/** Vite embeds this worker in the local WKWebView bundle. */
declare module '*?worker&inline' {
  const WorkerConstructor: new (options?: WorkerOptions) => Worker;
  export default WorkerConstructor;
}
