import { t } from '../i18n';
/** One small GPU program for star sprites and colored relationship paths. */
export class StellarGPU {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  buffer: WebGLBuffer;
  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
    });
    if (!gl)
      throw new Error(
        t("WebGL2 no está disponible. Activa la aceleración gráfica y vuelve a abrir el canvas."),
      );
    this.gl = gl;
    const shader = (type: number, source: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(s) || t("Error del sombreador"));
      return s;
    };
    const vs = shader(
      gl.VERTEX_SHADER,
      `#version 300 es
    in vec2 position; in vec4 color; in float size; uniform vec2 resolution; out vec4 tint;
    void main(){gl_Position=vec4(position/resolution*vec2(2.,-2.)+vec2(-1.,1.),0.,1.);gl_PointSize=size;tint=color;}`,
    );
    const fs = shader(
      gl.FRAGMENT_SHADER,
      `#version 300 es
    precision mediump float; in vec4 tint; uniform bool stars; out vec4 outputColor;
    void main(){float a=1.;if(stars){float r=length(gl_PointCoord-.5)*2.;a=exp(-r*r*5.)*.42+exp(-r*r*36.)*.7+step(r,.09);if(r>1.)discard;}outputColor=vec4(tint.rgb,tint.a*a);}`,
    );
    this.program = gl.createProgram()!;
    gl.attachShader(this.program, vs);
    gl.attachShader(this.program, fs);
    gl.linkProgram(this.program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS))
      throw new Error(t("No se pudo iniciar el canvas"));
    this.buffer = gl.createBuffer()!;
  }
  draw(
    width: number,
    height: number,
    lines: number[],
    stars: number[],
    simple = false,
  ) {
    const gl = this.gl;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniform2f(
      gl.getUniformLocation(this.program, "resolution"),
      width,
      height,
    );
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const stride = 7 * 4;
    for (const [name, size, offset] of [
      ["position", 2, 0],
      ["color", 4, 8],
      ["size", 1, 24],
    ] as const) {
      const loc = gl.getAttribLocation(this.program, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
    }
    gl.enable(gl.BLEND);
    // The transparent buffer contains premultiplied RGB. Preserve source alpha
    // rather than multiplying it by itself: squaring alpha makes thin paths
    // and small stars almost invisible over a light background in WebKit.
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const thick: number[] = [];
    for (let i = 0; i < (simple ? 0 : lines.length); i += 14) {
      const ax = lines[i],
        ay = lines[i + 1],
        bx = lines[i + 7],
        by = lines[i + 8],
        dx = bx - ax,
        dy = by - ay,
        len = Math.hypot(dx, dy) || 1,
        r = 0.65 * lines[i + 6],
        nx = (-dy / len) * r,
        ny = (dx / len) * r;
      const color = lines.slice(i + 2, i + 7);
      for (const [x, y] of [
        [ax + nx, ay + ny],
        [ax - nx, ay - ny],
        [bx + nx, by + ny],
        [bx + nx, by + ny],
        [ax - nx, ay - ny],
        [bx - nx, by - ny],
      ])
        thick.push(x, y, ...color);
    }
    for (const [data, mode, star] of [
      [simple ? lines : thick, simple ? gl.LINES : gl.TRIANGLES, 0],
      [stars, gl.POINTS, 1],
    ] as const) {
      gl.uniform1i(gl.getUniformLocation(this.program, "stars"), star);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW);
      gl.drawArrays(mode, 0, data.length / 7);
    }
  }
  dispose() {
    this.gl.deleteBuffer(this.buffer);
    this.gl.deleteProgram(this.program);
  }
}
