/**
 * Pixel-friendly lighting pass. The world is drawn on an offscreen 2D
 * canvas and the move VFX glow on a second one; this WebGL pass composes
 * them onto the visible canvas with:
 *   - a flat time-of-day tint (warm midday to cold dusk)
 *   - the darkness: a hard-edged deep purple overlay outside the safe
 *     radius, its edge dithered with a Bayer matrix on the 3 px pixel grid
 *   - the additive glow from move VFX, stronger inside the dark
 * No blur, no vignette. Without WebGL the same look is approximated in
 * Canvas 2D (the dither becomes a plain hard edge).
 */
import type { View } from './view';

export interface LightingParams {
  /** 0 = warm midday, 1 = cold dusk. */
  cold: number;
  /** Darkness ring in screen pixels; amount 0 disables it. */
  darkCx: number;
  darkCy: number;
  darkRadius: number;
  darkFeather: number;
  darkAmount: number;
  /** A Crystal Shard's clearing: a circle the darkness leaves alone (radius 0 = none). */
  clearCx: number;
  clearCy: number;
  clearRadius: number;
  time: number;
}

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uLight;
uniform vec2 uRes;
uniform float uCold;
uniform vec2 uDarkCenter;
uniform float uDarkRadius;
uniform float uDarkFeather;
uniform float uDarkAmount;
uniform vec2 uClearCenter;
uniform float uClearRadius;
uniform float uPixel;

// 4x4 Bayer threshold for the dithered darkness edge.
float bayer(vec2 p) {
  int x = int(mod(p.x, 4.0));
  int y = int(mod(p.y, 4.0));
  int i = x + y * 4;
  float m = 0.0;
  if (i == 0) m = 0.0; else if (i == 1) m = 8.0; else if (i == 2) m = 2.0; else if (i == 3) m = 10.0;
  else if (i == 4) m = 12.0; else if (i == 5) m = 4.0; else if (i == 6) m = 14.0; else if (i == 7) m = 6.0;
  else if (i == 8) m = 3.0; else if (i == 9) m = 11.0; else if (i == 10) m = 1.0; else if (i == 11) m = 9.0;
  else if (i == 12) m = 15.0; else if (i == 13) m = 7.0; else if (i == 14) m = 13.0; else m = 5.0;
  return (m + 0.5) / 16.0;
}

void main() {
  vec3 col = texture2D(uScene, vUv).rgb;
  // Flat time-of-day tint.
  vec3 warm = vec3(1.04, 1.0, 0.94);
  vec3 cold = vec3(0.78, 0.86, 1.08);
  col *= mix(warm, cold, uCold);
  // Darkness: hard edge, dithered over the feather band on the pixel grid.
  vec2 frag = vec2(vUv.x, 1.0 - vUv.y) * uRes;
  vec2 cell = floor(frag / uPixel);
  float d = distance(frag, uDarkCenter);
  float t = clamp((d - uDarkRadius) / max(uDarkFeather, 1.0), 0.0, 1.0);
  float dark = (t > bayer(cell) ? 1.0 : 0.0) * uDarkAmount;
  // A shard's clearing: dithered hole in the darkness.
  float dc = distance(frag, uClearCenter);
  float tc = clamp((uClearRadius - dc) / max(uDarkFeather, 1.0), 0.0, 1.0);
  if (uClearRadius > 0.0 && tc > bayer(cell)) dark = 0.0;
  vec3 darkCol = mix(col * 0.12, vec3(0.11, 0.03, 0.17), 0.55);
  col = mix(col, darkCol, dark);
  // Move VFX glow.
  vec3 light = texture2D(uLight, vUv).rgb;
  col += light * (0.6 + 1.5 * dark);
  gl_FragColor = vec4(col, 1.0);
}`;

export class Lighting {
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private sceneTex: WebGLTexture | null = null;
  private lightTex: WebGLTexture | null = null;
  private uniforms = new Map<string, WebGLUniformLocation | null>();
  private fallback: CanvasRenderingContext2D | null = null;
  readonly mode: 'webgl' | 'canvas';

  constructor(private readonly view: View) {
    const gl = view.outputCanvas.getContext('webgl', { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (gl && this.setup(gl)) {
      this.gl = gl;
      this.mode = 'webgl';
    } else {
      console.warn('[showdown] WebGL unavailable; lighting falls back to Canvas 2D');
      this.fallback = view.outputCanvas.getContext('2d')!;
      this.mode = 'canvas';
    }
  }

  private setup(gl: WebGLRenderingContext): boolean {
    const compile = (type: number, src: string): WebGLShader | null => {
      const sh = gl.createShader(type);
      if (!sh) return null;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error('[showdown] shader error', gl.getShaderInfoLog(sh));
        return null;
      }
      return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    if (!vs || !fs || !prog) return false;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('[showdown] program link error', gl.getProgramInfoLog(prog));
      return false;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    for (const u of ['uScene', 'uLight', 'uRes', 'uCold', 'uDarkCenter', 'uDarkRadius', 'uDarkFeather', 'uDarkAmount', 'uClearCenter', 'uClearRadius', 'uPixel']) {
      this.uniforms.set(u, gl.getUniformLocation(prog, u));
    }
    this.sceneTex = this.makeTexture(gl);
    this.lightTex = this.makeTexture(gl);
    gl.uniform1i(this.uniforms.get('uScene') ?? null, 0);
    gl.uniform1i(this.uniforms.get('uLight') ?? null, 1);
    this.program = prog;
    return true;
  }

  private makeTexture(gl: WebGLRenderingContext): WebGLTexture {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return t;
  }

  render(p: LightingParams): void {
    const v = this.view;
    if (this.gl && this.program) {
      const gl = this.gl;
      gl.viewport(0, 0, v.width, v.height);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v.sceneCanvas);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.lightTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v.lightCanvas);
      gl.uniform2f(this.uniforms.get('uRes') ?? null, v.width, v.height);
      gl.uniform1f(this.uniforms.get('uCold') ?? null, p.cold);
      gl.uniform2f(this.uniforms.get('uDarkCenter') ?? null, p.darkCx, p.darkCy);
      gl.uniform1f(this.uniforms.get('uDarkRadius') ?? null, p.darkRadius);
      gl.uniform1f(this.uniforms.get('uDarkFeather') ?? null, p.darkFeather);
      gl.uniform1f(this.uniforms.get('uDarkAmount') ?? null, p.darkAmount);
      gl.uniform2f(this.uniforms.get('uClearCenter') ?? null, p.clearCx, p.clearCy);
      gl.uniform1f(this.uniforms.get('uClearRadius') ?? null, p.clearRadius);
      gl.uniform1f(this.uniforms.get('uPixel') ?? null, v.spriteScale);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return;
    }
    const ctx = this.fallback!;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(v.sceneCanvas, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgb(${Math.round(255 * (1.04 - 0.26 * p.cold))},${Math.round(255 * (1 - 0.14 * p.cold))},${Math.round(255 * (0.94 + 0.1 * p.cold))})`;
    ctx.fillRect(0, 0, v.width, v.height);
    ctx.globalCompositeOperation = 'source-over';
    if (p.darkAmount > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, v.width, v.height);
      ctx.arc(p.darkCx, p.darkCy, Math.max(0, p.darkRadius + p.darkFeather * 0.5), 0, Math.PI * 2, true);
      if (p.clearRadius > 0) ctx.arc(p.clearCx, p.clearCy, p.clearRadius, 0, Math.PI * 2, true);
      ctx.fillStyle = `rgba(20,6,32,${0.88 * p.darkAmount})`;
      ctx.fill('evenodd');
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(v.lightCanvas, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }
}
