import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ModelPicker, ModelWithReasoning, primeCodexReasoningCatalog } from '../../../src/components/ModelPicker';
import { EmbeddingModelControl } from '../../../src/components/EmbeddingModelControl';
import { SearchableModelSelect } from '../../../src/components/SearchableModelSelect';
import { ScriptorSearchSelect } from '../../../src/components/editor/ScriptorAiPanel';
import { VAULT_TYPE_COLORS } from '../../../shared/vaultColors';
import type { AppSettings, ModelRef } from '../../../shared/types';

const fixture = window as unknown as { config: { value?: ModelRef; disabled?: boolean; allowEmpty?: boolean; requireExtraction?: boolean; reasoning?: boolean; onboarding?: boolean; bottom?: boolean; embedding?: boolean; native?: boolean; scriptor?: 'style' | 'image' }; actions: (ModelRef | null)[]; selections: string[]; setDisabled: (value: boolean) => void; colors: typeof VAULT_TYPE_COLORS; escaped: number };
fixture.actions = [];
fixture.selections = [];
fixture.colors = VAULT_TYPE_COLORS;
fixture.escaped = 0;
window.nodus = { listEmbeddingModels: async () => Array.from({ length: 350 }, (_, i) => ({ id: `text-embedding-${i}`, name: `Semantic vector ${i}` })) } as unknown as typeof window.nodus;
primeCodexReasoningCatalog({ 'gpt-test': { fallback: 'medium', supported: [{ reasoningEffort: 'low', description: '' }, { reasoningEffort: 'medium', description: '' }, { reasoningEffort: 'high', description: '' }] } });
const favorites: ModelRef[] = [
  { provider: 'gemini', model: 'gemini-flash-lite' },
  { provider: 'gemini', model: 'gemini-2.5-pro' },
  { provider: 'openai', model: 'gpt-4.1-mini' },
  { provider: 'codex', model: 'gpt-test' },
  { provider: 'nodus', model: 'qwen3.5-0.8b-q4' },
  ...Array.from({ length: 40 }, (_, i): ModelRef => ({ provider: 'ollama', model: `local-model-${i}` })),
];
function Fixture() {
  const [selection, setSelection] = useState('z');
  const choices = fixture.config.scriptor === 'image'
    ? [{ id: 'z', label: 'Ollama · Zeta' }, { id: 'c', label: 'Google · Óleo' }, { id: 'a', label: 'codex · acuarela' }, { id: 'b', label: 'Google · boceto' }]
    : [{ id: 'z', label: 'Zeta' }, { id: 'c', label: 'Claro' }, { id: 'a', label: 'Ágil' }, { id: 'b', label: 'breve' }];
  const [value, setValue] = useState<ModelRef | null>(fixture.config.value ?? null);
  const [disabled, setDisabled] = useState(fixture.config.disabled ?? false);
  fixture.setDisabled = setDisabled;
  const [embedding, setEmbedding] = useState({ embeddingProvider: 'openai', embeddingModel: 'saved-embedding' });
  const settings = { favorites, codexReasoningEfforts: {}, ...embedding } as AppSettings;
  const onChange = (next: ModelRef | null) => { fixture.actions.push(next); setValue(next); };
  const props = { settings, value, onChange, allowEmpty: fixture.config.allowEmpty ?? true, requireExtraction: fixture.config.requireExtraction };
  return <div style={{ '--vault-accent': VAULT_TYPE_COLORS.academic } as React.CSSProperties} id="shell">
    <div role="dialog" aria-label="Fixture dialog" onKeyDown={(e) => { if (e.key === 'Escape') fixture.escaped++; }} style={{ position: 'fixed', left: 20, right: 20, ...(fixture.config.bottom ? { bottom: 20 } : { top: 20 }), height: fixture.config.embedding ? 190 : 90, overflow: 'hidden', transform: 'translateZ(0)' }}>
      <div style={{ width: 300, maxWidth: '100%' }}>
        {fixture.config.scriptor ? <ScriptorSearchSelect testId="scriptor-choice" label={fixture.config.scriptor === 'style' ? 'Estilo' : 'Modelo de imagen'} choices={choices} value={selection} onChange={id => { fixture.selections.push(id); setSelection(id); }} /> : fixture.config.embedding ? <EmbeddingModelControl settings={settings} onEmbeddingChange={(provider, model) => { fixture.actions.push({ provider, model }); setEmbedding({ embeddingProvider: provider, embeddingModel: model }); }} /> : fixture.config.onboarding ? <SearchableModelSelect testId="discovery" label="Models" value={value} choices={favorites.map((m) => ({ ...m, label: m.model, providerLabel: m.provider, local: false }))} onChange={onChange} emptyLabel="Empty" />
          : fixture.config.reasoning ? <ModelWithReasoning {...props} /> : <ModelPicker {...props} disabled={disabled} menu={!fixture.config.native} />}
      </div>
    </div>
    <button style={{ position: 'fixed', left: 0, top: '50%' }} id="outside">Outside</button>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
