import { describe, expect, it } from 'vitest';
import { animSeconds, parseAnimData } from './animData';

const XML = `<?xml version="1.0" ?>
<AnimData>
  <ShadowSize>1</ShadowSize>
  <Anims>
    <Anim><Name>Walk</Name><Index>0</Index><FrameWidth>32</FrameWidth><FrameHeight>40</FrameHeight>
      <Durations><Duration>8</Duration><Duration>10</Duration><Duration>8</Duration><Duration>10</Duration></Durations></Anim>
    <Anim><Name>Attack</Name><Index>1</Index><FrameWidth>80</FrameWidth><FrameHeight>80</FrameHeight>
      <RushFrame>1</RushFrame><HitFrame>3</HitFrame><ReturnFrame>6</ReturnFrame>
      <Durations><Duration>2</Duration><Duration>4</Duration><Duration>1</Duration></Durations></Anim>
    <Anim><Name>Strike</Name><Index>2</Index><CopyOf>Attack</CopyOf></Anim>
    <Anim><Name>Shoot</Name><Index>3</Index><FrameWidth>40</FrameWidth><FrameHeight>56</FrameHeight>
      <HitFrame>2</HitFrame><ReturnPoint>4</ReturnPoint>
      <Durations><Duration>6</Duration></Durations></Anim>
  </Anims>
</AnimData>`;

describe('parseAnimData', () => {
  it('reads frame sizes, durations and attack frames', () => {
    const data = parseAnimData(XML);
    expect(data.shadowSize).toBe(1);
    const walk = data.anims.get('Walk');
    expect(walk?.frameWidth).toBe(32);
    expect(walk?.frameHeight).toBe(40);
    expect(walk?.durations).toEqual([8, 10, 8, 10]);
    expect(animSeconds(walk!)).toBeCloseTo(36 / 60);
    const atk = data.anims.get('Attack');
    expect(atk?.rushFrame).toBe(1);
    expect(atk?.hitFrame).toBe(3);
    expect(atk?.returnFrame).toBe(6);
  });

  it('resolves CopyOf aliases to the target sheet', () => {
    const strike = parseAnimData(XML).anims.get('Strike');
    expect(strike?.sheet).toBe('Attack');
    expect(strike?.durations).toEqual([2, 4, 1]);
    expect(strike?.index).toBe(2);
  });

  it('accepts ReturnPoint as a spelling of ReturnFrame', () => {
    expect(parseAnimData(XML).anims.get('Shoot')?.returnFrame).toBe(4);
  });

  it('rejects files without a root or with dangling aliases', () => {
    expect(() => parseAnimData('<Anims></Anims>')).toThrow();
    expect(() => parseAnimData('<AnimData><Anims><Anim><Name>A</Name><CopyOf>B</CopyOf></Anim></Anims></AnimData>')).toThrow();
  });
});
