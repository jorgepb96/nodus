// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Built-in voices shipped inside the Ming-3.0-tts-0.5B checkpoint (task `IP`, empty speaker
 * slot). Names are model inputs and stay untranslated; descriptions come from the upstream
 * voice catalogue (inclusionAI/Ming-3.0-tts cookbooks/instruction_en.md @ e999c39f).
 * A voice with emotion variants must be invoked by a full variant id, never its base name.
 *
 * Upstream also lists voices that imitate characters from films, series and cartoons; Nodus
 * leaves those out because they reproduce third-party characters and performers.
 */

export type MingVoiceEmotion = 'neutral' | 'happy' | 'sad' | 'angry' | 'fearful' | 'disgusted' | 'surprised';

export interface MingBuiltinVoice {
  id: string;
  language: 'en' | 'zh';
  gender: 'male' | 'female';
  age?: 'child' | 'teen' | 'young' | 'middle';
  description: string;
  /** Present when the base name is not itself invocable. */
  emotions?: Partial<Record<MingVoiceEmotion, string>>;
}

/** Upstream's recommended starting points, shown first. */
export const MING_RECOMMENDED_VOICES: readonly string[] = ['US_James', 'US_Stella', '灵小柔', '灵楷'];

export const MING_BUILTIN_VOICES: readonly MingBuiltinVoice[] = [
  { id: "US_Emma", language: 'en', gender: 'female', description: "American · assistants, narration, conversational product voice" },
  { id: "US_James", language: 'en', gender: 'male', description: "American · narration, explainer and documentary reads" },
  { id: "US_Stella", language: 'en', gender: 'female', description: "American · narration, conversational, warm, youthful" },
  { id: "UK_George", language: 'en', gender: 'male', description: "British · audiobooks, formal announcements" },
  { id: "UK_Charlotte", language: 'en', gender: 'female', description: "British · audiobooks, measured narration" },
  { id: "灵小安", language: 'zh', gender: 'female', age: 'teen', description: "Sweet, crisp and energetic, with an approachable, cute anime-style delivery." },
  { id: "灵语汐", language: 'zh', gender: 'female', age: 'teen', description: "Clear, bright and youthful, with a sunny, energetic delivery." },
  { id: "灵小萌", language: 'zh', gender: 'female', age: 'young', description: "Bright, crisp and brisk, with an energetic yet dependable delivery." },
  { id: "灵小柔", language: 'zh', gender: 'female', age: 'young', description: "Clear, sweet and articulate, with polite, patient and professional intonation." },
  { id: "灵小雅", language: 'zh', gender: 'female', age: 'young', description: "Sweet, bright and youthful, with an energetic delivery." },
  { id: "花小呗", language: 'zh', gender: 'female', age: 'teen', description: "Crisp and sweet, with a distinctly childlike, lively delivery." },
  { id: "灵韵", language: 'zh', gender: 'female', age: 'young', description: "Bright and crisp, with brisk, dependable delivery." },
  { id: "妩媚妲己", language: 'zh', gender: 'female', age: 'young', description: "Sweet and crisp, with light, rising intonation and an alluring delivery." },
  { id: "灵婉", language: 'zh', gender: 'female', age: 'teen', description: "Clear and sweet, with a youthful, intimate and soothing delivery." },
  { id: "灵小月", language: 'zh', gender: 'female', age: 'young', description: "Sweet, clear and energetic, with cheerful, welcoming intonation." },
  { id: "灵朵儿", language: 'zh', gender: 'female', age: 'young', description: "Warm, thoughtful and approachable, with an unhurried, soothing storytelling style." },
  { id: "灵岩", language: 'zh', gender: 'male', age: 'young', description: "Clear, formal and professional." },
  { id: "灵小锋", language: 'zh', gender: 'male', age: 'young', description: "Warm and resonant, with natural confidence and a balance of friendliness and maturity." },
  { id: "灵小川", language: 'zh', gender: 'male', age: 'young', description: "Warm, mellow and resonant, with sensitive, expressive delivery." },
  { id: "灵小甄", language: 'zh', gender: 'female', age: 'young', description: "Bright, crisp and lively, with a friendly, persuasive recommendation style." },
  { id: "灵小知", language: 'zh', gender: 'female', age: 'young', description: "Bright and confident, with strong, articulate and persuasive delivery." },
  { id: "灵小惠", language: 'zh', gender: 'female', age: 'young', description: "Very fast and penetrating, conveying urgency, enthusiasm and professional confidence." },
  { id: "灵小晴", language: 'zh', gender: 'female', age: 'young', description: "Very fast yet clear, with a powerful, bright delivery that conveys urgency." },
  { id: "灵小琪", language: 'zh', gender: 'male', age: 'young', description: "Sunny, friendly and natural, with an enthusiastic recommendation style." },
  { id: "灵梦", language: 'zh', gender: 'female', age: 'young', description: "Very sweet and youthful, with playful, affectionate delivery." },
  { id: "灵恬", language: 'zh', gender: 'female', age: 'young', description: "Honey-sweet, with a gently playful yet assured romantic delivery." },
  { id: "灵小汐", language: 'zh', gender: 'female', age: 'young', description: "Clear and sweet, with relaxed, natural and endearingly innocent delivery." },
  { id: "灵小棠", language: 'zh', gender: 'female', age: 'young', description: "Clear and warm, with calm pacing and a gentle, experienced storytelling style." },
  { id: "灵小梨", language: 'zh', gender: 'female', age: 'young', description: "Sweet and clear, combining youthful playfulness with gentle, expressive narration." },
  { id: "灵舒", language: 'zh', gender: 'female', age: 'young', description: "Gentle and thoughtful, with natural pauses and conversational fillers that evoke everyday life." },
  { id: "灵娇", language: 'zh', gender: 'female', age: 'young', description: "Sweet, bright and lively, with vivid, youthful storytelling." },
  { id: "灵小芸", language: 'zh', gender: 'female', age: 'young', description: "Warm and thoughtful, with sincere, calm and sensitive delivery." },
  { id: "灵锐", language: 'zh', gender: 'male', age: 'young', description: "Standard pronunciation and natural delivery, with pauses and self-corrections conveying difficult choices and determination." },
  { id: "灵空", language: 'zh', gender: 'male', age: 'young', description: "Low and resonant, with close, breathy delivery that conveys affection and reassurance." },
  { id: "灵宇", language: 'zh', gender: 'male', age: 'young', description: "Youthful and resonant, with a confident smile and gentle teasing." },
  { id: "灵朗", language: 'zh', gender: 'male', age: 'young', description: "Low and resonant, combining confident warmth with affectionate reassurance." },
  { id: "灵楷", language: 'zh', gender: 'male', age: 'young', description: "Warm and resonant, with slow, soothing late-night-radio narration." },
  { id: "灵旭", language: 'zh', gender: 'male', age: 'young', description: "Clear, youthful and scholarly, with calm, gentle storytelling." },
  { id: "灵骁", language: 'zh', gender: 'male', age: 'young', description: "Gentle and sincere, with natural hesitation and repetition conveying fond memories." },
  { id: "灵江", language: 'zh', gender: 'male', age: 'young', description: "Warm and resonant, with relaxed, heartfelt reflections on youth and enthusiasm." },
  { id: "悲伤女声", language: 'zh', gender: 'female', age: 'young', description: "Gentle yet determined, with a thoughtful, intimate storytelling style." },
  { id: "皮六", language: 'zh', gender: 'male', age: 'young', description: "Bright, youthful and confident, with strong contrast and dramatic emphasis." },
  { id: "说唱小哥", language: 'zh', gender: 'male', age: 'young', description: "Clear and rhythmic, with rap-like pacing and a relaxed, independent delivery." },
  { id: "蜡笔小新", language: 'zh', gender: 'male', age: 'child', description: "Low and full, with slow, innocent and distinctly cartoon-like delivery." },
  { id: "悟空", language: 'zh', gender: 'male', age: 'young', description: "Highly expressive and theatrical, with vivid but measured exaggeration." },
  { id: "灵信远", language: 'zh', gender: 'male', age: 'young', description: "Clear and warm, with a slight smile and audible breath, balancing youthful freshness and mature affection.", emotions: {angry: "灵信远_生气", disgusted: "灵信远_厌恶", surprised: "灵信远_惊讶", happy: "灵信远_高兴", fearful: "灵信远_恐惧", neutral: "灵信远_中性", sad: "灵信远_悲伤"} },
  { id: "灵思齐", language: 'zh', gender: 'male', age: 'young', description: "Sunny, bright and engaging, with sincere praise and approachable warmth.", emotions: {happy: "灵思齐_高兴", fearful: "灵思齐_恐惧", angry: "灵思齐_生气", disgusted: "灵思齐_厌恶", neutral: "灵思齐_中性", surprised: "灵思齐_惊讶", sad: "灵思齐_悲伤"} },
  { id: "灵叙柔", language: 'zh', gender: 'female', age: 'young', description: "Composed and dignified, with clear articulation and a balance of authority and gentle narration.", emotions: {happy: "灵叙柔_高兴", fearful: "灵叙柔_恐惧", surprised: "灵叙柔_惊讶", sad: "灵叙柔_悲伤", angry: "灵叙柔_生气", neutral: "灵叙柔_中性", disgusted: "灵叙柔_厌恶"} },
  { id: "灵绮木", language: 'zh', gender: 'female', age: 'young', description: "Professional yet approachable, with gentle, assured delivery.", emotions: {sad: "灵绮木_悲伤", disgusted: "灵绮木_厌恶", neutral: "灵绮木_中性", fearful: "灵绮木_恐惧", surprised: "灵绮木_惊讶", happy: "灵绮木_高兴", angry: "灵绮木_生气"} },
  { id: "灵书悦", language: 'zh', gender: 'female', age: 'young', description: "Crisp and pleasant, balancing objective narration with lively, humorous commentary.", emotions: {fearful: "灵书悦_恐惧", disgusted: "灵书悦_厌恶", happy: "灵书悦_高兴", surprised: "灵书悦_惊讶", sad: "灵书悦_悲伤", angry: "灵书悦_生气", neutral: "灵书悦_中性"} },
  { id: "灵渊霆", language: 'zh', gender: 'male', age: 'middle', description: "Youthful, natural and relaxed, like a familiar friend making a casual invitation.", emotions: {disgusted: "灵渊霆_厌恶", neutral: "灵渊霆_中性", fearful: "灵渊霆_恐惧", surprised: "灵渊霆_惊讶", sad: "灵渊霆_悲伤", angry: "灵渊霆_生气", happy: "灵渊霆_高兴"} },
  { id: "灵素心", language: 'zh', gender: 'female', age: 'teen', description: "Sweet, crisp and energetic, with lively, curious intonation.", emotions: {happy: "灵素心_高兴", surprised: "灵素心_惊讶", fearful: "灵素心_恐惧", neutral: "灵素心_中性", angry: "灵素心_生气", sad: "灵素心_悲伤", disgusted: "灵素心_厌恶"} },
  { id: "灵晓声", language: 'zh', gender: 'male', age: 'young', description: "Youthful and resonant, with calm confidence and an assertive, charismatic delivery.", emotions: {surprised: "灵晓声_惊讶", disgusted: "灵晓声_厌恶", happy: "灵晓声_高兴", angry: "灵晓声_生气", neutral: "灵晓声_中性", sad: "灵晓声_悲伤"} },
  { id: "灵风信", language: 'zh', gender: 'female', age: 'young', description: "Sweet and clear, with warm, concerned and reassuring delivery.", emotions: {angry: "灵风信_生气", neutral: "灵风信_中性", disgusted: "灵风信_厌恶", happy: "灵风信_高兴", surprised: "灵风信_惊讶", sad: "灵风信_悲伤", fearful: "灵风信_恐惧"} },
  { id: "灵采薇", language: 'zh', gender: 'female', age: 'young', description: "Warm and thoughtful, with clear articulation and calm, trustworthy delivery.", emotions: {surprised: "灵采薇_惊讶", disgusted: "灵采薇_厌恶", fearful: "灵采薇_恐惧", angry: "灵采薇_生气", sad: "灵采薇_悲伤", neutral: "灵采薇_中性", happy: "灵采薇_高兴"} },
  { id: "灵卓然", language: 'zh', gender: 'male', age: 'young', description: "Full and resonant, with precise pronunciation and calm, objective delivery.", emotions: {disgusted: "灵卓然_厌恶", neutral: "灵卓然_中性", fearful: "灵卓然_恐惧", surprised: "灵卓然_惊讶", happy: "灵卓然_高兴", sad: "灵卓然_悲伤", angry: "灵卓然_生气"} },
  { id: "灵惜梦", language: 'zh', gender: 'female', age: 'young', description: "Bright and crisp, combining approachable warmth with independence and decisiveness.", emotions: {neutral: "灵惜梦_中性", disgusted: "灵惜梦_厌恶", happy: "灵惜梦_高兴", sad: "灵惜梦_悲伤", fearful: "灵惜梦_恐惧", surprised: "灵惜梦_惊讶", angry: "灵惜梦_生气"} },
  { id: "灵昭野", language: 'zh', gender: 'male', age: 'young', description: "Clear and youthful, with sincere admiration and a warm, captivated delivery.", emotions: {angry: "灵昭野_生气", happy: "灵昭野_高兴", sad: "灵昭野_悲伤", neutral: "灵昭野_中性", disgusted: "灵昭野_厌恶", fearful: "灵昭野_恐惧", surprised: "灵昭野_惊讶"} },
  { id: "灵心澜", language: 'zh', gender: 'female', age: 'middle', description: "Mature and composed, with assured, discerning and dignified delivery.", emotions: {disgusted: "灵心澜_厌恶", surprised: "灵心澜_惊讶", angry: "灵心澜_生气", neutral: "灵心澜_中性", happy: "灵心澜_高兴", sad: "灵心澜_悲伤", fearful: "灵心澜_恐惧"} },
  { id: "灵犀言", language: 'zh', gender: 'male', age: 'middle', description: "Deep and full, with mature composure, firm articulation and an authoritative delivery.", emotions: {sad: "灵犀言_悲伤", disgusted: "灵犀言_厌恶", fearful: "灵犀言_恐惧", neutral: "灵犀言_中性", surprised: "灵犀言_惊讶", happy: "灵犀言_高兴", angry: "灵犀言_生气"} },
  { id: "灵语冰", language: 'zh', gender: 'female', age: 'young', description: "Thoughtful and efficient, with precise articulation and objective, trustworthy delivery.", emotions: {sad: "灵语冰_悲伤", disgusted: "灵语冰_厌恶", happy: "灵语冰_高兴", fearful: "灵语冰_恐惧", surprised: "灵语冰_惊讶", neutral: "灵语冰_中性", angry: "灵语冰_生气"} },
  { id: "灵逸风", language: 'zh', gender: 'male', age: 'young', description: "Fresh and youthful, with relaxed, casual and slightly evasive delivery.", emotions: {angry: "灵逸风_生气", sad: "灵逸风_悲伤", surprised: "灵逸风_惊讶", neutral: "灵逸风_中性", fearful: "灵逸风_恐惧", happy: "灵逸风_高兴", disgusted: "灵逸风_厌恶"} },
  { id: "灵悦澜", language: 'zh', gender: 'female', age: 'teen', description: "Sweet and crisp, with a smiling, approachable and lively delivery.", emotions: {neutral: "灵悦澜_中性", happy: "灵悦澜_高兴", disgusted: "灵悦澜_厌恶", fearful: "灵悦澜_恐惧", angry: "灵悦澜_生气", sad: "灵悦澜_悲伤", surprised: "灵悦澜_惊讶"} },
  { id: "灵惊鸿", language: 'zh', gender: 'male', age: 'young', description: "Brisk and direct, with natural, easygoing business confidence.", emotions: {disgusted: "灵惊鸿_厌恶", happy: "灵惊鸿_高兴", neutral: "灵惊鸿_中性", surprised: "灵惊鸿_惊讶", fearful: "灵惊鸿_恐惧", angry: "灵惊鸿_生气", sad: "灵惊鸿_悲伤"} },
  { id: "灵御心", language: 'zh', gender: 'female', age: 'young', description: "Bright, crisp and direct, with efficient, youthful energy.", emotions: {happy: "灵御心_高兴", neutral: "灵御心_中性", angry: "灵御心_生气", fearful: "灵御心_恐惧", disgusted: "灵御心_厌恶", surprised: "灵御心_惊讶", sad: "灵御心_悲伤"} },
  { id: "灵语恬", language: 'zh', gender: 'female', age: 'young', description: "Clear and gentle, with attentive, earnest delivery.", emotions: {disgusted: "灵语恬_厌恶", happy: "灵语恬_高兴", fearful: "灵语恬_恐惧", sad: "灵语恬_悲伤", surprised: "灵语恬_惊讶", angry: "灵语恬_生气", neutral: "灵语恬_中性"} },
  { id: "灵心恬", language: 'zh', gender: 'female', age: 'young', description: "Crisp and composed, with objective delivery and vivid storytelling.", emotions: {disgusted: "灵心恬_厌恶", surprised: "灵心恬_惊讶", sad: "灵心恬_悲伤", neutral: "灵心恬_中性", fearful: "灵心恬_恐惧", happy: "灵心恬_高兴", angry: "灵心恬_生气"} },
  { id: "灵惜蕊", language: 'zh', gender: 'female', age: 'young', description: "Clear and pleasant, with standard pronunciation and patient, professional warmth.", emotions: {surprised: "灵惜蕊_惊讶", disgusted: "灵惜蕊_厌恶", fearful: "灵惜蕊_恐惧", happy: "灵惜蕊_高兴", neutral: "灵惜蕊_中性", sad: "灵惜蕊_悲伤", angry: "灵惜蕊_生气"} },
  { id: "灵语萱", language: 'zh', gender: 'female', age: 'young', description: "Clear and sweet, with gentle yet firm affection, trust and reassurance.", emotions: {disgusted: "灵语萱_厌恶", happy: "灵语萱_高兴", surprised: "灵语萱_惊讶", fearful: "灵语萱_恐惧", angry: "灵语萱_生气", sad: "灵语萱_悲伤", neutral: "灵语萱_中性"} },
  { id: "灵语烟", language: 'zh', gender: 'female', age: 'teen', description: "Bright, crisp and lively, expressing surprise and everyday banter.", emotions: {angry: "灵语烟_生气", fearful: "灵语烟_恐惧", neutral: "灵语烟_中性", disgusted: "灵语烟_厌恶", surprised: "灵语烟_惊讶", happy: "灵语烟_高兴", sad: "灵语烟_悲伤"} },
  { id: "灵律雅", language: 'zh', gender: 'female', age: 'middle', description: "Efficient and grounded in urban life, with restrained, authentic frustration.", emotions: {fearful: "灵律雅_恐惧", angry: "灵律雅_生气", surprised: "灵律雅_惊讶", happy: "灵律雅_高兴", disgusted: "灵律雅_厌恶", neutral: "灵律雅_中性", sad: "灵律雅_悲伤"} },
  { id: "灵惊涛", language: 'zh', gender: 'male', age: 'young', description: "Young male delivery with a distinctive Nanning accent, conveying humorous frustration at an overly cold internet cafe.", emotions: {disgusted: "灵惊涛_厌恶", fearful: "灵惊涛_恐惧", happy: "灵惊涛_高兴", sad: "灵惊涛_悲伤", neutral: "灵惊涛_中性", surprised: "灵惊涛_惊讶", angry: "灵惊涛_生气"} },
  { id: "灵寒陌", language: 'zh', gender: 'male', age: 'young', description: "Clear and youthful, with urgent, innocent attempts to clear up a misunderstanding.", emotions: {angry: "灵寒陌_生气", disgusted: "灵寒陌_厌恶", fearful: "灵寒陌_恐惧", happy: "灵寒陌_高兴", neutral: "灵寒陌_中性", surprised: "灵寒陌_惊讶", sad: "灵寒陌_悲伤"} },
  { id: "灵决冥", language: 'zh', gender: 'male', age: 'young', description: "Resonant and precise, with calm, objective and engaging documentary-style delivery.", emotions: {sad: "灵决冥_悲伤", disgusted: "灵决冥_厌恶", angry: "灵决冥_生气", neutral: "灵决冥_中性", surprised: "灵决冥_惊讶", fearful: "灵决冥_恐惧", happy: "灵决冥_高兴"} },
  { id: "灵亦尘", language: 'zh', gender: 'male', age: 'young', description: "Warm and resonant, with natural, gentle concern and reassuring delivery.", emotions: {neutral: "灵亦尘_中性", disgusted: "灵亦尘_厌恶", happy: "灵亦尘_高兴", fearful: "灵亦尘_恐惧", angry: "灵亦尘_生气", sad: "灵亦尘_悲伤", surprised: "灵亦尘_惊讶"} },
  { id: "灵语尘", language: 'zh', gender: 'male', age: 'young', description: "Low, husky and world-weary, conveying helplessness and resignation.", emotions: {angry: "灵语尘_生气", happy: "灵语尘_高兴", disgusted: "灵语尘_厌恶", surprised: "灵语尘_惊讶", neutral: "灵语尘_中性", sad: "灵语尘_悲伤", fearful: "灵语尘_恐惧"} },
  { id: "灵慈萱", language: 'zh', gender: 'female', age: 'young', description: "Crisp, youthful and natural, with a familiar, slightly urgent delivery.", emotions: {happy: "灵慈萱_高兴", disgusted: "灵慈萱_厌恶", surprised: "灵慈萱_惊讶", angry: "灵慈萱_生气", neutral: "灵慈萱_中性", sad: "灵慈萱_悲伤", fearful: "灵慈萱_恐惧"} },
  { id: "灵妙音", language: 'zh', gender: 'female', age: 'young', description: "Resonant and forceful, with efficient delivery and an unquestionable sense of authority.", emotions: {neutral: "灵妙音_中性", sad: "灵妙音_悲伤", surprised: "灵妙音_惊讶", disgusted: "灵妙音_厌恶", angry: "灵妙音_生气", happy: "灵妙音_高兴", fearful: "灵妙音_恐惧"} },
  { id: "灵断尘", language: 'zh', gender: 'male', age: 'young', description: "Youthful and conversational, with light questions and decisive refusals.", emotions: {sad: "灵断尘_悲伤", happy: "灵断尘_高兴", surprised: "灵断尘_惊讶", fearful: "灵断尘_恐惧", neutral: "灵断尘_中性", angry: "灵断尘_生气", disgusted: "灵断尘_厌恶"} },
  { id: "灵悦兮", language: 'zh', gender: 'female', age: 'young', description: "Bright and crisp, with lively, confident and action-oriented delivery.", emotions: {happy: "灵悦兮_高兴", neutral: "灵悦兮_中性", angry: "灵悦兮_生气", surprised: "灵悦兮_惊讶", disgusted: "灵悦兮_厌恶", sad: "灵悦兮_悲伤", fearful: "灵悦兮_恐惧"} },
  { id: "灵若虚", language: 'zh', gender: 'female', age: 'middle', description: "Clean and efficient, with thoughtful, objective yet warm delivery.", emotions: {fearful: "灵若虚_恐惧", surprised: "灵若虚_惊讶", neutral: "灵若虚_中性", sad: "灵若虚_悲伤", happy: "灵若虚_高兴", disgusted: "灵若虚_厌恶", angry: "灵若虚_生气"} },
  { id: "灵熙婉", language: 'zh', gender: 'female', age: 'middle', description: "Sweet and clear, with a smiling, approachable and lively storytelling style.", emotions: {disgusted: "灵熙婉_厌恶", angry: "灵熙婉_生气", surprised: "灵熙婉_惊讶", happy: "灵熙婉_高兴", neutral: "灵熙婉_中性", fearful: "灵熙婉_恐惧", sad: "灵熙婉_悲伤"} },
  { id: "灵旭扬", language: 'zh', gender: 'male', age: 'young', description: "Warm and resonant, with affectionate delivery and a hint of illness-related weakness and desire for attention.", emotions: {neutral: "灵旭扬_中性", angry: "灵旭扬_生气", fearful: "灵旭扬_恐惧", happy: "灵旭扬_高兴", surprised: "灵旭扬_惊讶", sad: "灵旭扬_悲伤", disgusted: "灵旭扬_厌恶"} },
  { id: "灵阅川", language: 'zh', gender: 'male', age: 'young', description: "Deep and resonant, with experienced, composed and dignified storytelling.", emotions: {angry: "灵阅川_生气", sad: "灵阅川_悲伤", happy: "灵阅川_高兴", disgusted: "灵阅川_厌恶", surprised: "灵阅川_惊讶", neutral: "灵阅川_中性", fearful: "灵阅川_恐惧"} },
  { id: "灵未央", language: 'zh', gender: 'female', age: 'young', description: "Sweet and crisp, with playful, rising intonation and confident explanations.", emotions: {happy: "灵未央_高兴", neutral: "灵未央_中性", surprised: "灵未央_惊讶", sad: "灵未央_悲伤", disgusted: "灵未央_厌恶", fearful: "灵未央_恐惧", angry: "灵未央_生气"} },
  { id: "灵妩月", language: 'zh', gender: 'female', age: 'young', description: "Gentle and thoughtful, combining caring, rational advice with quiet strength.", emotions: {disgusted: "灵妩月_厌恶", angry: "灵妩月_生气", neutral: "灵妩月_中性", surprised: "灵妩月_惊讶", fearful: "灵妩月_恐惧", happy: "灵妩月_高兴", sad: "灵妩月_悲伤"} },
  { id: "灵梦瑶", language: 'zh', gender: 'female', age: 'child', description: "Soft and sweet, with a friendly, earnest and soothing explanatory style.", emotions: {neutral: "灵梦瑶_中性", fearful: "灵梦瑶_恐惧", happy: "灵梦瑶_高兴", sad: "灵梦瑶_悲伤", surprised: "灵梦瑶_惊讶", angry: "灵梦瑶_生气"} },
  { id: "灵妙声", language: 'zh', gender: 'male', age: 'teen', description: "Sweet and crisp, with standard pronunciation and a fresh, approachable, professional delivery.", emotions: {neutral: "灵妙声_中性", fearful: "灵妙声_恐惧", happy: "灵妙声_高兴", sad: "灵妙声_悲伤", surprised: "灵妙声_惊讶", angry: "灵妙声_生气"} },
  { id: "灵烈瑶", language: 'zh', gender: 'female', age: 'young', description: "Bright and efficient, with clear articulation and objective, logical delivery.", emotions: {neutral: "灵烈瑶_中性", disgusted: "灵烈瑶_厌恶", fearful: "灵烈瑶_恐惧", sad: "灵烈瑶_悲伤", surprised: "灵烈瑶_惊讶", angry: "灵烈瑶_生气", happy: "灵烈瑶_高兴"} },
  { id: "灵幽月", language: 'zh', gender: 'female', age: 'young', description: "Clear and thoughtfully warm, with precise articulation and an appreciative, open-minded delivery.", emotions: {neutral: "灵幽月_中性", disgusted: "灵幽月_厌恶", fearful: "灵幽月_恐惧", sad: "灵幽月_悲伤", surprised: "灵幽月_惊讶", angry: "灵幽月_生气", happy: "灵幽月_高兴"} },
  { id: "灵悦心", language: 'zh', gender: 'female', age: 'young', description: "Warm and thoughtful, with rounded articulation and gentle, uplifting delivery.", emotions: {neutral: "灵悦心_中性", disgusted: "灵悦心_厌恶", fearful: "灵悦心_恐惧", sad: "灵悦心_悲伤", surprised: "灵悦心_惊讶", angry: "灵悦心_生气", happy: "灵悦心_高兴"} },
  { id: "灵汐月", language: 'zh', gender: 'female', age: 'young', description: "Sweet and soothing, with relaxed, heartfelt delivery conveying intimacy and trust.", emotions: {neutral: "灵汐月_中性", disgusted: "灵汐月_厌恶", fearful: "灵汐月_恐惧", sad: "灵汐月_悲伤", surprised: "灵汐月_惊讶", angry: "灵汐月_生气", happy: "灵汐月_高兴"} },
  { id: "灵书意", language: 'zh', gender: 'male', age: 'young', description: "Warm and resonant, with steady, engaging delivery and a comforting late-night-radio feel.", emotions: {neutral: "灵书意_中性", disgusted: "灵书意_厌恶", fearful: "灵书意_恐惧", sad: "灵书意_悲伤", surprised: "灵书意_惊讶", angry: "灵书意_生气", happy: "灵书意_高兴"} },
  { id: "灵知远", language: 'zh', gender: 'male', age: 'young', description: "Clear and warm, balancing composure and youthful energy with an optimistic delivery.", emotions: {neutral: "灵知远_中性", disgusted: "灵知远_厌恶", fearful: "灵知远_恐惧", sad: "灵知远_悲伤", surprised: "灵知远_惊讶", angry: "灵知远_生气", happy: "灵知远_高兴"} },
  { id: "灵温言", language: 'zh', gender: 'male', age: 'young', description: "Youthful and resonant, with rational, gentle and persuasive narration.", emotions: {neutral: "灵温言_中性", disgusted: "灵温言_厌恶", fearful: "灵温言_恐惧", sad: "灵温言_悲伤", surprised: "灵温言_惊讶", angry: "灵温言_生气", happy: "灵温言_高兴"} },
  { id: "灵傲尘", language: 'zh', gender: 'male', age: 'young', description: "Warm, mellow and resonant, with steady, objective and mature reflection.", emotions: {neutral: "灵傲尘_中性", disgusted: "灵傲尘_厌恶", fearful: "灵傲尘_恐惧", sad: "灵傲尘_悲伤", angry: "灵傲尘_生气", happy: "灵傲尘_高兴"} },
  { id: "灵佑安", language: 'zh', gender: 'male', age: 'young', description: "Mellow and resonant, with calm, persuasive and professional delivery.", emotions: {neutral: "灵佑安_中性", disgusted: "灵佑安_厌恶", fearful: "灵佑安_恐惧", sad: "灵佑安_悲伤", surprised: "灵佑安_惊讶", angry: "灵佑安_生气", happy: "灵佑安_高兴"} },
  { id: "灵惜晨", language: 'zh', gender: 'female', age: 'young', description: "Sweet and crisp, with lively, thoughtful and enthusiastic delivery.", emotions: {neutral: "灵惜晨_中性", disgusted: "灵惜晨_厌恶", fearful: "灵惜晨_恐惧", sad: "灵惜晨_悲伤", surprised: "灵惜晨_惊讶", angry: "灵惜晨_生气", happy: "灵惜晨_高兴"} },
  { id: "灵宛溪", language: 'zh', gender: 'female', age: 'young', description: "Gentle and dignified, with relaxed, heartfelt and soothing resonance.", emotions: {neutral: "灵宛溪_中性", disgusted: "灵宛溪_厌恶", fearful: "灵宛溪_恐惧", sad: "灵宛溪_悲伤", surprised: "灵宛溪_惊讶", angry: "灵宛溪_生气", happy: "灵宛溪_高兴"} },
  { id: "灵言澈", language: 'zh', gender: 'male', age: 'young', description: "Warm, resonant and reassuring, with gentle, affectionate concern.", emotions: {neutral: "灵言澈_中性", disgusted: "灵言澈_厌恶", fearful: "灵言澈_恐惧", sad: "灵言澈_悲伤", surprised: "灵言澈_惊讶", angry: "灵言澈_生气", happy: "灵言澈_高兴"} },
  { id: "灵溯光", language: 'zh', gender: 'male', age: 'young', description: "Approachable and youthful, with warm interest and an affirmative recommendation style.", emotions: {neutral: "灵溯光_中性", disgusted: "灵溯光_厌恶", fearful: "灵溯光_恐惧", sad: "灵溯光_悲伤", surprised: "灵溯光_惊讶", angry: "灵溯光_生气", happy: "灵溯光_高兴"} },
  { id: "灵惊弦", language: 'zh', gender: 'female', age: 'young', description: "Bright and textured, with precise pronunciation and thoughtful, authoritative yet objective delivery.", emotions: {neutral: "灵惊弦_中性", disgusted: "灵惊弦_厌恶", fearful: "灵惊弦_恐惧", sad: "灵惊弦_悲伤", surprised: "灵惊弦_惊讶", angry: "灵惊弦_生气", happy: "灵惊弦_高兴"} },
  { id: "灵嘉肴", language: 'zh', gender: 'male', age: 'young', description: "Bright and energetic, with precise articulation and rational, approachable confidence.", emotions: {neutral: "灵嘉肴_中性", disgusted: "灵嘉肴_厌恶", fearful: "灵嘉肴_恐惧", sad: "灵嘉肴_悲伤", surprised: "灵嘉肴_惊讶", angry: "灵嘉肴_生气", happy: "灵嘉肴_高兴"} },
  { id: "灵黛嗔", language: 'zh', gender: 'female', age: 'young', description: "Warm, thoughtful and engaging, with sincere, confident recommendations.", emotions: {neutral: "灵黛嗔_中性", disgusted: "灵黛嗔_厌恶", fearful: "灵黛嗔_恐惧", sad: "灵黛嗔_悲伤", surprised: "灵黛嗔_惊讶", angry: "灵黛嗔_生气", happy: "灵黛嗔_高兴"} },
  { id: "灵孤影", language: 'zh', gender: 'male', age: 'young', description: "Warm and resonant, with composed, sincere appreciation and natural satisfaction.", emotions: {neutral: "灵孤影_中性", disgusted: "灵孤影_厌恶", fearful: "灵孤影_恐惧", sad: "灵孤影_悲伤", surprised: "灵孤影_惊讶", angry: "灵孤影_生气", happy: "灵孤影_高兴"} },
  { id: "灵雨汐", language: 'zh', gender: 'female', age: 'young', description: "Soft and sweet, with natural breathiness and an affectionate, relaxed youthful delivery.", emotions: {neutral: "灵雨汐_中性", fearful: "灵雨汐_恐惧", happy: "灵雨汐_高兴", sad: "灵雨汐_悲伤", surprised: "灵雨汐_惊讶", angry: "灵雨汐_生气"} },
];

/** The id Ming expects for a built-in voice: its neutral variant when it has variants. */
export function mingBuiltinInvocation(voice: MingBuiltinVoice, emotion: MingVoiceEmotion = 'neutral'): string {
  if (!voice.emotions) return voice.id;
  return voice.emotions[emotion] ?? voice.emotions.neutral ?? Object.values(voice.emotions)[0] ?? voice.id;
}
