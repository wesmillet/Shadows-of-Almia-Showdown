/**
 * HD-2D lighting pass. The world is drawn on an offscreen 2D canvas, lights
 * (move VFX glows, styler lights, the crystal) on a second one; this WebGL
 * pass composes them onto the visible canvas with:
 *   - a warm daylight tint that cools as the match goes on
 *   - the darkness mechanic: outside a safe radius the scene drops to a deep
 *     purple-black, with lights punching through it
 *   - a global vignette
 *   - a slight depth-of-field blur over the top 20% of the screen
 * If WebGL is unavailable the same look is approximated with Canvas 2D.
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
uniform float uTime;

vec3 sceneAt(vec2 uv) { return texture2D(uScene, uv).rgb; }

void main() {
  vec2 uv = vUv;
  // Depth of field: the top 20% of the screen blurs progressively.
  float dof = smoothstep(0.80, 1.0, uv.y);
  vec3 col;
  if (dof > 0.001) {
    vec2 px = (1.0 / uRes) * (1.0 + 4.0 * dof);
    col = sceneAt(uv) * 0.2
        + (sceneAt(uv + vec2(px.x, 0.0)) + sceneAt(uv - vec2(px.x, 0.0)) + sceneAt(uv + vec2(0.0, px.y)) + sceneAt(uv - vec2(0.0, px.y))) * 0.12
        + (sceneAt(uv + px) + sceneAt(uv - px) + sceneAt(uv + vec2(px.x, -px.y)) + sceneAt(uv + vec2(-px.x, px.y))) * 0.08;
  } else {
    col = sceneAt(uv);
  }
  // Daylight tint: warm gold toward a cold blue dusk.
  vec3 warm = vec3(1.06, 1.0, 0.90);
  vec3 cold = vec3(0.80, 0.88, 1.10);
  col *= mix(warm, cold, uCold);
  col = mix(col, col * vec3(0.9, 0.92, 1.0) - 0.04, uCold * 0.5);
  // Darkness outside the safe radius.
  vec2 frag = vec2(uv.x, 1.0 - uv.y) * uRes;
  float d = distance(frag, uDarkCenter);
  float wobble = sin(uTime * 1.7 + frag.x * 0.01) * 0.5 + sin(uTime * 2.3 + frag.y * 0.013) * 0.5;
  float dark = smoothstep(uDarkRadius + wobble * uDarkFeather * 0.15, uDarkRadius + uDarkFeather, d) * uDarkAmount;
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  vec3 darkCol = mix(col * 0.10, vec3(0.10, 0.03, 0.16) * (0.6 + lum * 0.8), 0.6);
  col = mix(col, darkCol, dark);
  // Lights: additive, stronger where it is dark so moves glow in the night.
  vec3 light = texture2D(uLight, uv).rgb;
  col += light * (0.55 + 1.6 * dark);
  // Vignette.
  vec2 q = (uv - 0.5) * vec2(1.0, 1.15);
  float v = 1.0 - smoothstep(0.40, 0.98, length(q));
  col *= mix(0.55, 1.0, v);
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
    for (const u of ['uScene', 'uLight', 'uRes', 'uCold', 'uDarkCenter', 'uDarkRadius', 'uDarkFeather', 'uDarkAmount', 'uTime']) {
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
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
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
      gl.uniform1f(this.uniforms.get('uTime') ?? null, p.time);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return;
    }
    const ctx = this.fallback!;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(v.sceneCanvas, 0, 0);
    if (p.darkAmount > 0) {
      const g = ctx.createRadialGradient(p.darkCx, p.darkCy, Math.max(0, p.darkRadius), p.darkCx, p.darkCy, p.darkRadius + p.darkFeather);
      g.addColorStop(0, 'rgba(12,4,20,0)');
      g.addColorStop(1, `rgba(12,4,20,${0.9 * p.darkAmount})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, v.width, v.height);
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(v.lightCanvas, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgb(${Math.round(255 * (1.0 - 0.2 * p.cold))},${Math.round(255 * (1 - 0.1 * p.cold))},${Math.round(255 * (0.9 + 0.1 * p.cold))})`;
    ctx.fillRect(0, 0, v.width, v.height);
    ctx.globalCompositeOperation = 'source-over';
    const vg = ctx.createRadialGradient(v.width / 2, v.height / 2, v.height * 0.4, v.width / 2, v.height / 2, v.height * 0.95);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, v.width, v.height);
  }
}
