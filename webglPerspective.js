/**
 * WebGL-accelerated 4-point perspective transform.
 * Falls back gracefully — call isWebGLSupported() before use.
 */

let _webglSupported = null;

export function isWebGLSupported() {
    if (_webglSupported !== null) return _webglSupported;
    try {
        const c = document.createElement('canvas');
        _webglSupported = !!(c.getContext('webgl') || c.getContext('experimental-webgl'));
    } catch {
        _webglSupported = false;
    }
    return _webglSupported;
}

function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error('Shader compile error: ' + info);
    }
    return shader;
}

function createProgram(gl, vs, fs) {
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const info = gl.getProgramInfoLog(program);
        gl.deleteProgram(program);
        throw new Error('Program link error: ' + info);
    }
    return program;
}

const VERTEX_SHADER = `
attribute vec2 a_position;
void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision highp float;
uniform mat3 u_invMatrix;
uniform sampler2D u_texture;
uniform vec2 u_texSize;
uniform vec2 u_destSize;

void main() {
    // gl_FragCoord is in pixel coords (0.5 to destSize-0.5)
    vec2 destCoord = gl_FragCoord.xy;
    // Flip Y since gl_FragCoord origin is bottom-left
    destCoord.y = u_destSize.y - destCoord.y;

    vec3 srcCoord = u_invMatrix * vec3(destCoord, 1.0);
    vec2 src = srcCoord.xy / srcCoord.z;

    if (src.x < -0.5 || src.x >= u_texSize.x || src.y < -0.5 || src.y >= u_texSize.y) {
        gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
    } else {
        // Convert to UV coordinates for texture sampling (0..1 range)
        vec2 uv = src / u_texSize;
        gl_FragColor = texture2D(u_texture, uv);
    }
}
`;

/**
 * Compute the 3x3 homography matrix from 4 source points to 4 destination points.
 * Points are {x,y} objects. Returns a Float32Array in column-major order for WebGL.
 */
function computeHomographyMatrix(srcPoints, dstPoints) {
    // Build the 8x8 system: for each point pair (sx,sy) -> (dx,dy)
    // [sx sy 1  0  0 0 -dx*sx -dx*sy] [h0]   [dx]
    // [ 0  0 0 sx sy 1 -dy*sx -dy*sy] [h1] = [dy]
    const A = [];
    const b = [];
    for (let i = 0; i < 4; i++) {
        const sx = srcPoints[i].x, sy = srcPoints[i].y;
        const dx = dstPoints[i].x, dy = dstPoints[i].y;
        A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]);
        A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]);
        b.push(dx, dy);
    }

    // Gaussian elimination with partial pivoting
    const n = 8;
    const aug = A.map((row, i) => [...row, b[i]]);
    for (let i = 0; i < n; i++) {
        let maxRow = i;
        for (let k = i + 1; k < n; k++) {
            if (Math.abs(aug[k][i]) > Math.abs(aug[maxRow][i])) maxRow = k;
        }
        [aug[i], aug[maxRow]] = [aug[maxRow], aug[i]];
        for (let k = i + 1; k < n; k++) {
            const f = aug[k][i] / aug[i][i];
            for (let j = i; j < n + 1; j++) aug[k][j] -= f * aug[i][j];
        }
    }
    const h = new Array(n);
    for (let i = n - 1; i >= 0; i--) {
        h[i] = aug[i][n];
        for (let j = i + 1; j < n; j++) h[i] -= aug[i][j] * h[j];
        h[i] /= aug[i][i];
    }

    // h = [h0..h7], h8 = 1
    // Row-major: [[h0 h1 h2], [h3 h4 h5], [h6 h7 1]]
    // WebGL uniform mat3 is column-major
    return new Float32Array([
        h[0], h[3], h[6],
        h[1], h[4], h[7],
        h[2], h[5], 1
    ]);
}

/**
 * Apply a 4-point perspective transform using WebGL.
 *
 * @param {HTMLCanvasElement} sourceCanvas - source image canvas
 * @param {Array<{x:number, y:number}>} orderedPoints - 4 source points (TL, TR, BR, BL)
 * @param {number} destWidth - output width in pixels
 * @param {number} destHeight - output height in pixels
 * @returns {{canvas: HTMLCanvasElement, width: number, height: number}} result
 */
export function applyWebGLPerspective(sourceCanvas, orderedPoints, destWidth, destHeight) {
    const canvas = document.createElement('canvas');
    canvas.width = destWidth;
    canvas.height = destHeight;

    const gl = canvas.getContext('webgl', {
        antialias: false,
        preserveDrawingBuffer: true,
        alpha: false
    });

    if (!gl) throw new Error('WebGL context creation failed');

    try {
        // Compile shaders
        const vs = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
        const fs = createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
        const program = createProgram(gl, vs, fs);
        gl.useProgram(program);

        // Full-screen quad (two triangles in clip space)
        const posBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1, 1, -1, -1, 1,
            -1, 1, 1, -1, 1, 1
        ]), gl.STATIC_DRAW);

        const aPos = gl.getAttribLocation(program, 'a_position');
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

        // Upload source image as texture
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);

        // Compute the inverse homography: maps destination pixels to source pixels
        // Source points map to the destination rectangle corners
        const dstPoints = [
            { x: 0, y: 0 },
            { x: destWidth, y: 0 },
            { x: destWidth, y: destHeight },
            { x: 0, y: destHeight }
        ];
        // We need: for each dest pixel, find where it came from in source
        // So the matrix maps dest -> source: homography(dstPoints -> orderedPoints)
        const invMatrix = computeHomographyMatrix(dstPoints, orderedPoints);

        // Set uniforms
        gl.uniformMatrix3fv(gl.getUniformLocation(program, 'u_invMatrix'), false, invMatrix);
        gl.uniform2f(gl.getUniformLocation(program, 'u_texSize'), sourceCanvas.width, sourceCanvas.height);
        gl.uniform2f(gl.getUniformLocation(program, 'u_destSize'), destWidth, destHeight);
        gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);

        // Render
        gl.viewport(0, 0, destWidth, destHeight);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // Cleanup GPU resources
        gl.deleteTexture(texture);
        gl.deleteBuffer(posBuffer);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        gl.deleteProgram(program);

        return { canvas, width: destWidth, height: destHeight };
    } catch (e) {
        // Lose the context to free resources
        const ext = gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
        throw e;
    }
}
