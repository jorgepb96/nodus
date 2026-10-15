export const EMBEDDING_GEMMA_PROCESS_FIXTURES = Object.freeze([
  Object.freeze({ role: 'document', title: 'QLoRA memory method', text: 'Paged optimizers transfer optimizer state between GPU and CPU memory and page it back during training.' }),
  Object.freeze({ role: 'document', title: 'Método de memoria QLoRA', text: 'Los optimizadores paginados trasladan el estado del optimizador entre la GPU y la CPU y lo recuperan durante el entrenamiento.' }),
  Object.freeze({ role: 'document', title: 'Méthode mémoire QLoRA', text: 'Les optimiseurs paginés déplacent les états de l’optimiseur entre le GPU et le CPU, puis les récupèrent pendant l’entraînement.' }),
  Object.freeze({ role: 'document', title: 'Metodo di memoria QLoRA', text: 'Gli ottimizzatori paginati spostano lo stato dell’ottimizzatore tra GPU e CPU e lo ripristinano durante l’addestramento.' }),
  Object.freeze({ role: 'document', title: 'Método de memória QLoRA', text: 'Otimizadores paginados movem o estado do otimizador entre GPU e CPU e o recuperam durante o treinamento.' }),
  Object.freeze({ role: 'query', text: '¿Cómo se pagina el estado del optimizador entre la GPU y la CPU durante el entrenamiento?' }),
  Object.freeze({ role: 'query', text: 'How does the optimizer state move between GPU and CPU memory during training?' }),
]);
export const EMBEDDING_GEMMA_PROCESS_PROFILES = Object.freeze([
  'embeddinggemma-2-text-q8-512-v1', 'embeddinggemma-2-text-q8-256-v1',
]);
