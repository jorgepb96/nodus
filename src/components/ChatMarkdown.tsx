import { memo, type ComponentProps } from 'react';
import { splitChatVisuals } from '@shared/chatSkills';
import { Markdown } from './Markdown';
import { ChatVisual } from './ChatVisual';
import { ChatCapabilityResult } from './ChatCapabilityResult';
import { ChatCapabilityArtifact } from './ChatCapabilityArtifact';
import { ChatCapabilityView } from './CapabilityView';
import { ChatLegacyResult } from './ChatLegacyResult';
import { RouteFixPrompt } from './RouteFixPrompt';
import { Icon } from './ui';
import { localizeRuntimeError } from '@shared/uiLanguage';
import { t, getActiveLang } from '../i18n';
import { useCapabilityFences } from '../lib/capabilityFences';

/** Name an in-flight capability as soon as its streamed invocation identifies itself.
 * Partial JSON is intentional here: waiting for JSON.parse would leave the visible work
 * card saying only "Capability" for the whole generation. */
function capabilityIdentifierTitle(identifier: string): string {
  const specific = identifier.replace(/^nodus[:.]/i, '').split(/[:.]/).at(-1) ?? identifier;
  return specific.replace(/[-_]+/g, ' ').replace(/\b\p{L}/gu, letter => letter.toLocaleUpperCase());
}

export function capabilityActivityTitle(source: string): string {
  const field = (name: string) => new RegExp(`"${name}"\\s*:\\s*"([^"\\n]+)"`, 'i').exec(source)?.[1];
  const identifier = field('capabilityId') ?? field('skillId') ?? field('pluginId');
  if (!identifier) return 'Preparing tool…';
  return capabilityIdentifierTitle(identifier);
}

/** A stored artifact and the view that travelled with it are one result, emitted as two
 *  blocks. Rendering both paints the same drawing twice, so a reference is skipped when its
 *  own inline view follows it. A reference with no inline view still renders as the card. */
function hasInlineView(parts: ReturnType<typeof splitChatVisuals>, index: number): boolean {
  for (let next = index + 1; next < parts.length; next++) {
    const candidate = parts[next];
    if (candidate.kind === 'markdown' && !candidate.content.trim()) continue;
    return candidate.kind === 'capability-view';
  }
  return false;
}

// Memoised: every streamed delta re-renders the whole timeline, and an earlier answer's props do
// not change, so its blocks (capability views, route-fix chips) are not re-split and re-parsed.
export const ChatMarkdown = memo(function ChatMarkdown({ content, streaming = false, ...props }: ComponentProps<typeof Markdown> & { streaming?: boolean }) {
  const claims = useCapabilityFences();
  const parts = splitChatVisuals(content, claims.fences, claims.legacyFences);
  return <div className="chat-rich-answer">{parts.map((part, index) => {
    if (part.kind === 'capability-artifact' && hasInlineView(parts, index)) return null;
    // A block an earlier release already finished. It is rendered by whoever owns that
    // fence now, never shown as work in progress.
    if (part.kind === 'capability-legacy' && part.complete) return <ChatLegacyResult key={index} fence={part.fence!} source={part.content} />;
    if (part.kind === 'capability-pending' || part.kind === 'capability-legacy') {
      // A package that is still producing its answer names itself, in its own words.
      const label = part.fence ? claims.label(part.fence) : undefined;
      return <div key={index} role="status" className="chat-visual-pending"><Icon name="sparkles" size={22} /><div><b>{label?.title ? capabilityIdentifierTitle(label.title) : part.fence ? capabilityIdentifierTitle(part.fence) : 'Preparing tool…'}</b><span>{streaming ? (label?.pending ?? t('Cargando…')) : t('La generación se interrumpió. Vuelve a intentarlo.')}</span></div>{streaming && <span className="chat-visual-pulse" />}</div>;
    }
    if (part.kind === 'image-error') {
      let message = 'Image generation failed. Please retry.';
      try { message = JSON.parse(part.content).message || message; } catch { /* incomplete failure record */ }
      return <div key={index} className="chat-visual-error" role="alert">{localizeRuntimeError(message, getActiveLang())}</div>;
    }
    if (part.kind === 'markdown') return <Markdown key={index} {...props} content={part.content} chatVisuals />;
    if (part.kind === 'route-fix' && part.complete && !streaming) return <RouteFixPrompt key={index} content={part.content} />;
    if (part.kind === 'route-fix') return null;
    if (part.kind === 'capability-artifact' && part.complete && !streaming) return <ChatCapabilityArtifact key={index} source={part.content} />;
    if (part.kind === 'capability-view' && part.complete && !streaming) return <ChatCapabilityView key={index} source={part.content} />;
    if (part.kind === 'capability-artifact' || part.kind === 'capability-view') return <div key={index} role="status" className="chat-visual-pending"><Icon name="sparkles" size={22} /><div><b>{capabilityActivityTitle(part.content)}</b><span>{streaming ? t('Cargando…') : t('La generación se interrumpió. Vuelve a intentarlo.')}</span></div></div>;
    if (part.kind === 'capability-result' && part.complete && !streaming) return <ChatCapabilityResult key={index} source={part.content} />;
    if (part.kind === 'capability-request' || part.kind === 'capability-result') return <div key={index} role="status" className="chat-visual-pending"><Icon name="sparkles" size={22} /><div><b>{capabilityActivityTitle(part.content)}</b><span>{streaming ? t('Cargando…') : t('La generación se interrumpió. Vuelve a intentarlo.')}</span></div></div>;
    if (part.kind === 'svg' && part.complete && !streaming) return <ChatVisual key={index} svg={part.content} />;
    return <div className="chat-visual-pending" role="status" key={index}><Icon name={part.kind === 'image-request' ? 'image' : 'code'} size={22} /><div><b>{part.kind === 'svg' ? 'SVG Studio' : 'Image Atelier'}</b><span>{streaming ? (part.kind === 'svg' ? t('Dibujando tu visual…') : t('Creando tu imagen…')) : t('La generación se interrumpió. Vuelve a intentarlo.')}</span></div>{streaming && <span className="chat-visual-pulse" />}</div>;
  })}</div>;
});
