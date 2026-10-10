import { skillHasCapability } from '@shared/chatSkills';
import { sanitizeChatSvg } from '@shared/chatSvg';
import { serializeChatVisualPart, splitChatVisuals, type ChatSkill } from '@shared/chatSkills';
import type { ModelRef } from '@shared/types';
import { completeText, resolveModelRef } from './aiClient';
import { withinModelOutput } from '@shared/researchRetrievalBudget';
import { evaluateInSvgSandbox } from './svgSandboxWindow';

/** Output tokens for one SVG repair. The model is asked to return the WHOLE drawing, so the
 *  budget has to hold the drawing: a flat 10,000 could not, and a chemistry scheme runs to
 *  126,837 characters — roughly 32,000 tokens on SVG's dense punctuation. The repair then came
 *  back truncated, failed the completeness check, and was dropped without a word, so a drawing
 *  too big to repair looked like one that needed no repair.
 *
 *  Sized from the drawing itself at a conservative 2.5 characters per token, with headroom for a
 *  repair that legitimately grows, and held under the model's own output ceiling. */
function svgRepairTokens(svg: string, model: ModelRef): number {
  const needed = Math.ceil(svg.length / 2.5) + 2_000;
  const budget = Math.max(10_000, needed);
  return withinModelOutput(budget, model.provider, model.model, 10_000);
}

/** Inspect actual font metrics in an isolated, offscreen document whose CSP blocks page scripts. */
export async function inspectChatSvg(svg: string): Promise<string[]> {
  if (svg.length > 300_000) return ['SVG exceeds the 300 KB preview limit.'];
  return evaluateInSvgSandbox<string[]>(`(() => {
      const clean = (${sanitizeChatSvg.toString()})(${JSON.stringify(svg)});
      if (!clean) return ['Invalid or incomplete SVG XML. Return one complete valid SVG.'];
      const parsed = new DOMParser().parseFromString(clean.svg, 'image/svg+xml');
      const root = document.importNode(parsed.documentElement, true);
      document.body.append(root);
      const view = root.viewBox.baseVal;
      if (view.width <= 0 || view.height <= 0) return ['Add a positive viewBox with enough space for all labels.'];
      root.setAttribute('width', String(view.width)); root.setAttribute('height', String(view.height));
      const bounds = root.getBoundingClientRect();
      const labels = Array.from(root.querySelectorAll('text')).filter(node => !node.closest('defs, clipPath, mask')).map(node => ({ text: (node.textContent || '').trim(), rect: node.getBoundingClientRect() })).filter(item => item.text && item.rect.width && item.rect.height).slice(0, 300);
      const cards = Array.from(root.querySelectorAll('rect')).filter(node => !node.closest('defs, clipPath, mask') && !['none', 'transparent'].includes(getComputedStyle(node).fill)).map(node => node.getBoundingClientRect()).filter(rect => rect.width > 60 && rect.height > 24 && rect.width * rect.height < bounds.width * bounds.height * .85).sort((a,b) => a.width*a.height - b.width*b.height).slice(0, 200);
      const circles = Array.from(root.querySelectorAll('circle,ellipse')).filter(node => !node.closest('defs, clipPath, mask') && !['none', 'transparent'].includes(getComputedStyle(node).fill)).map(node => node.getBoundingClientRect()).filter(rect => rect.width > 60 && rect.height > 24 && rect.width * rect.height < bounds.width * bounds.height * .85).sort((a,b) => a.width*a.height - b.width*b.height).slice(0, 100);
      const insideEllipse = (shape, x, y) => Math.pow((x - (shape.left+shape.right)/2)/(shape.width/2),2) + Math.pow((y - (shape.top+shape.bottom)/2)/(shape.height/2),2) <= 1;
      const issues = [];
      const box = rect => '(' + [rect.left - bounds.left, rect.top - bounds.top, rect.width, rect.height].map(Math.round).join(', ') + ')';
      for (const label of labels) {
        const b = label.rect;
        if (b.left < bounds.left - 1 || b.top < bounds.top - 1 || b.right > bounds.right + 1 || b.bottom > bounds.bottom + 1) issues.push('Clipped label: ' + label.text.slice(0, 100) + ' at x,y,width,height ' + box(b) + '. Canvas ' + view.width + ' x ' + view.height + '.');
        const card = cards.find(a => Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1);
        if (card && (b.left < card.left - 1 || b.right > card.right + 1 || b.top < card.top - 1 || b.bottom > card.bottom + 1)) issues.push('Label crosses its box boundary: ' + label.text.slice(0,100) + '. Text x,y,width,height ' + box(b) + ', box ' + box(card) + '. Enlarge the containing box or wrap/move the label fully inside it, with padding.');
        const circle = circles.find(a => insideEllipse(a, (b.left+b.right)/2, (b.top+b.bottom)/2));
        if (circle && [[b.left,b.top],[b.right,b.top],[b.left,b.bottom],[b.right,b.bottom]].some(([x,y]) => !insideEllipse(circle,x,y))) issues.push('Label overflows a circular node: ' + label.text.slice(0,100) + '. Text x,y,width,height ' + box(b) + ', node ' + box(circle) + '. Replace crowded circular nodes with spacious rectangular cards or enlarge and reflow the layout. Preserve the complete connections and arrow directions.');
      }
      for (let i=0; i<labels.length; i++) for (let j=i+1; j<labels.length; j++) {
        const a=labels[i].rect, b=labels[j].rect;
        if (Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1) issues.push('Overlapping labels: ' + labels[i].text.slice(0,70) + ' / ' + labels[j].text.slice(0,70) + '. Measured x,y,width,height: ' + box(a) + ' / ' + box(b) + '. Move labels apart with at least 12 units of clear space.');
      }
      return issues.slice(0, 16);
    })()`);
}

export async function refineChatSvg(answer: string, options: { question: string; skills: ChatSkill[]; model?: ModelRef | null; signal?: AbortSignal; beforeRepair?: () => void; maxRepairs?: number }): Promise<string> {
  const skill = options.skills.find(item => skillHasCapability(item, 'svg'));
  if (!skill) return answer;
  const parts = splitChatVisuals(answer);
  // Bound both browser work and model calls even if a weak model emits many blocks.
  let count = 0;
  for (const part of parts) {
    if (part.kind !== 'svg' || count++ >= 3) continue;
    options.signal?.throwIfAborted();
    try {
      let issues = await inspectChatSvg(part.content);
      for (let attempt = 0; issues.length && attempt < (options.maxRepairs ?? 2); attempt++) {
        options.signal?.throwIfAborted();
        // Freeze the effective model for both sizing and dispatch, including the
        // configured synthesis default when no complete override was supplied.
        const model = resolveModelRef(options.model);
        const maxTokens = svgRepairTokens(part.content, model);
        options.beforeRepair?.();
        const repaired = await completeText({
          system: `You are the visual quality editor for SVG Studio. Repair the supplied SVG, preserving the user's intended content and all correct relationships. Return only one complete fenced svg block.\n${skill.instructions}\nActual SVG checks found the issues listed below. Fix every listed issue with a simpler, more spacious layout. Prefer a vertical legend with one short explanation per row over a crowded horizontal legend. Increase canvas height or wrap text with tspan when needed; never hide, truncate, shrink to unreadable type, or delete required labels. Use explicit Arial, sans-serif typography. Preserve factual content. No external resources or scripts.`,
          user: JSON.stringify({ request: options.question, issues, svg: part.content }),
          maxTokens, temperature: 0.2, reasoning: 'off', plainContext: true, signal: options.signal, noRetry: Boolean(options.beforeRepair),
        }, model);
        const replacement = splitChatVisuals(repaired).find(item => item.kind === 'svg' && item.complete);
        if (!replacement) {
          // A repair that came back truncated or unparseable leaves the original drawing in
          // place, which is right — but it used to do so without a word, so a drawing that could
          // never be repaired looked like a drawing that needed no repair.
          console.warn(`[svgQuality] repair discarded: ${repaired.length} chars back for a ${part.content.length}-char drawing`
            + ` (budget ${maxTokens} tokens); keeping the original`);
          break;
        }
        const nextIssues = await inspectChatSvg(replacement.content);
        // Never replace a drawing with a measurably worse repair.
        if (nextIssues.length <= issues.length) { part.content = replacement.content; part.complete = true; issues = nextIssues; }
      }
    } catch (error) {
      if (options.signal?.aborted) throw error;
      // A failed optional refinement must not discard a usable answer. Rendering
      // still sanitizes the result and exposes invalid markup as readable code.
    }
  }
  return parts.map(serializeChatVisualPart).join('');
}
