/**
 * Parser for SpriteCollab `AnimData.xml`, written for this project.
 *
 * The file lists one <Anim> per action. Each has a Name, FrameWidth,
 * FrameHeight and a <Durations> list (one <Duration> per frame, in 60 fps
 * ticks). Attacks may carry RushFrame, HitFrame and ReturnFrame (the frame
 * where the pose returns to idle; a few files spell it ReturnPoint). An
 * <Anim> with <CopyOf> has no sheet of its own and reuses another action's
 * PNGs and timing.
 *
 * The parser is a small hand-rolled XML walker, so it runs in the browser and
 * under Node tests alike without a DOM.
 */

export interface AnimDef {
  name: string;
  index: number | undefined;
  /** Action whose `<sheet>-Anim.png` / `-Shadow.png` / `-Offsets.png` this action draws from. */
  sheet: string;
  frameWidth: number;
  frameHeight: number;
  /** Per-frame durations in 60 fps ticks; its length is the frame count. */
  durations: number[];
  rushFrame: number | undefined;
  hitFrame: number | undefined;
  returnFrame: number | undefined;
}

export interface AnimData {
  shadowSize: number;
  anims: Map<string, AnimDef>;
}

export const TICK_SECONDS = 1 / 60;

export function animSeconds(def: AnimDef): number {
  let t = 0;
  for (const d of def.durations) t += d;
  return t * TICK_SECONDS;
}

function tagText(block: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`).exec(block);
  return m ? m[1] : undefined;
}

function tagInt(block: string, tag: string, ctx: string): number | undefined {
  const text = tagText(block, tag);
  if (text === undefined) return undefined;
  const n = Number(text);
  if (!Number.isInteger(n)) throw new Error(`AnimData: <${tag}> in ${ctx} is not an integer ("${text}")`);
  return n;
}

interface RawAnim {
  name: string;
  index: number | undefined;
  copyOf: string | undefined;
  own: Omit<AnimDef, 'name' | 'index' | 'sheet'> | undefined;
}

export function parseAnimData(xml: string): AnimData {
  if (!/<AnimData[\s>]/.test(xml)) throw new Error('AnimData: no <AnimData> root');
  const shadowSize = tagInt(xml, 'ShadowSize', 'AnimData') ?? 0;
  const raws = new Map<string, RawAnim>();
  const re = /<Anim>([\s\S]*?)<\/Anim>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1] ?? '';
    const name = tagText(block, 'Name');
    if (!name) throw new Error('AnimData: <Anim> without <Name>');
    const index = tagInt(block, 'Index', name);
    const copyOf = tagText(block, 'CopyOf');
    if (copyOf) {
      raws.set(name, { name, index, copyOf, own: undefined });
      continue;
    }
    const frameWidth = tagInt(block, 'FrameWidth', name);
    const frameHeight = tagInt(block, 'FrameHeight', name);
    if (frameWidth === undefined || frameHeight === undefined) {
      throw new Error(`AnimData: ${name} lacks FrameWidth/FrameHeight`);
    }
    const durations: number[] = [];
    const dre = /<Duration>\s*(\d+)\s*<\/Duration>/g;
    let d: RegExpExecArray | null;
    while ((d = dre.exec(block)) !== null) durations.push(Math.max(1, Number(d[1])));
    if (durations.length === 0) throw new Error(`AnimData: ${name} has no <Duration> entries`);
    raws.set(name, {
      name,
      index,
      copyOf: undefined,
      own: {
        frameWidth,
        frameHeight,
        durations,
        rushFrame: tagInt(block, 'RushFrame', name),
        hitFrame: tagInt(block, 'HitFrame', name),
        returnFrame: tagInt(block, 'ReturnFrame', name) ?? tagInt(block, 'ReturnPoint', name),
      },
    });
  }

  const anims = new Map<string, AnimDef>();
  for (const raw of raws.values()) {
    let target = raw;
    const seen = new Set([raw.name]);
    while (target.copyOf !== undefined) {
      const next = raws.get(target.copyOf);
      if (!next) throw new Error(`AnimData: ${target.name} copies unknown action ${target.copyOf}`);
      if (seen.has(next.name)) throw new Error(`AnimData: CopyOf cycle through ${next.name}`);
      seen.add(next.name);
      target = next;
    }
    const own = target.own;
    if (!own) continue;
    anims.set(raw.name, {
      name: raw.name,
      index: raw.index,
      sheet: target.name,
      frameWidth: own.frameWidth,
      frameHeight: own.frameHeight,
      durations: [...own.durations],
      rushFrame: own.rushFrame,
      hitFrame: own.hitFrame,
      returnFrame: own.returnFrame,
    });
  }
  return { shadowSize, anims };
}
