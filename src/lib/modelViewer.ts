import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  Group,
  MathUtils,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Sphere,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** The one place Nodus draws a 3D model.
 *
 *  Imported dynamically by the viewer component, so a conversation with no model in it
 *  never loads any of this. Everything it needs arrives as bytes: the loader is handed an
 *  in-memory buffer and a resource path that resolves nowhere, so a glTF asking for an
 *  external file finds nothing instead of reaching the network. The asset was already
 *  checked for self-containment before it was stored, and again before it was read; this
 *  is the third place that assumption is enforced rather than trusted. */

export interface ViewerRequest {
  container: HTMLElement;
  bytes: Uint8Array;
  mimeType: string;
  maxPixelRatio: number;
  label: string;
}

export interface ViewerHandle {
  dispose: () => void;
  reset: () => void;
  fit: () => void;
}

/** A resource path no fetch can resolve. `GLTFLoader` joins relative URIs onto this, and
 *  the result is a scheme the browser refuses, which is the point: a model that reaches
 *  outside itself fails visibly rather than silently loading something. */
const NOWHERE = 'nodus-model-has-no-external-resources:/';

export default async function buildModelViewer(request: ViewerRequest): Promise<ViewerHandle> {
  const { container } = request;
  const scene = new Scene();
  scene.background = null;

  // Two lights and no environment map: enough to read a shape, and nothing that needs a
  // file from anywhere.
  scene.add(new AmbientLight(0xffffff, 1.6));
  const key = new DirectionalLight(0xffffff, 2.2);
  key.position.set(3, 5, 4);
  scene.add(key);
  const fill = new DirectionalLight(0xffffff, 0.8);
  fill.position.set(-4, -2, -3);
  scene.add(fill);

  const camera = new PerspectiveCamera(45, aspectOf(container), 0.01, 5_000);
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'default' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, request.maxPixelRatio));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.setClearColor(new Color(0x000000), 0);
  resize(renderer, camera, container);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = true;
  // Panning with the right button, zoom with the wheel, rotation with the left: the
  // arrangement every 3D tool a researcher already uses agrees on.
  controls.enablePan = true;

  let parsed: Object3D;
  try {
    parsed = await parse(request);
  } catch (error) {
    // The renderer and its controls exist already; a model that fails to parse must not
    // leave a WebGL context behind for every attempt to open it.
    controls.dispose();
    renderer.dispose();
    renderer.domElement.remove();
    throw error;
  }
  const model = new Group();
  model.add(parsed);
  scene.add(model);

  const home = frame(model, camera, controls);

  let stopped = false;
  const tick = () => {
    if (stopped) return;
    controls.update();
    renderer.render(scene, camera);
    frameHandle = requestAnimationFrame(tick);
  };
  let frameHandle = requestAnimationFrame(tick);

  const observer = new ResizeObserver(() => resize(renderer, camera, container));
  observer.observe(container);

  return {
    reset: () => {
      camera.position.copy(home.position);
      controls.target.copy(home.target);
      controls.update();
    },
    fit: () => {
      const next = frame(model, camera, controls);
      home.position.copy(next.position);
      home.target.copy(next.target);
    },
    dispose: () => {
      stopped = true;
      cancelAnimationFrame(frameHandle);
      observer.disconnect();
      controls.dispose();
      disposeTree(scene);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

async function parse(request: ViewerRequest): Promise<Object3D> {
  const loader = new GLTFLoader();
  // `.gltf` is JSON and `.glb` is binary; `parse` takes either, and takes neither from a
  // URL. Nothing here can issue a request the user did not cause.
  const payload: ArrayBuffer | string = request.mimeType === 'model/gltf+json'
    ? new TextDecoder().decode(request.bytes)
    : toArrayBuffer(request.bytes);

  const gltf = await new Promise<{ scene: Object3D }>((resolve, reject) => {
    loader.parse(payload, NOWHERE, resolve, error => reject(new Error(readableError(error))));
  });
  return gltf.scene;
}

/** three.js reports a parse failure as an ErrorEvent or an Error depending on where it
 *  happened; neither is worth showing raw. */
function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String((error as { message: unknown }).message) : String(error);
  return message.slice(0, 200);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

const aspectOf = (container: HTMLElement) => Math.max(container.clientWidth, 1) / Math.max(container.clientHeight, 1);

function resize(renderer: WebGLRenderer, camera: PerspectiveCamera, container: HTMLElement): void {
  const width = Math.max(container.clientWidth, 1);
  const height = Math.max(container.clientHeight, 1);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

/** Puts the whole model on screen whatever units it was authored in — a millimetre-scale
 *  scan and a metre-scale building both arrive framed. */
function frame(model: Object3D, camera: PerspectiveCamera, controls: OrbitControls): { position: Vector3; target: Vector3 } {
  const box = new Box3().setFromObject(model);
  if (box.isEmpty()) {
    camera.position.set(0, 0, 3);
    controls.target.set(0, 0, 0);
    controls.update();
    return { position: camera.position.clone(), target: controls.target.clone() };
  }
  const sphere = box.getBoundingSphere(new Sphere());
  const radius = Math.max(sphere.radius, 1e-4);
  const distance = radius / Math.sin(MathUtils.degToRad(camera.fov) / 2);

  camera.near = Math.max(distance / 1_000, 1e-4);
  camera.far = distance * 1_000;
  camera.updateProjectionMatrix();
  camera.position.copy(sphere.center).add(new Vector3(1, 0.7, 1).normalize().multiplyScalar(distance * 1.15));
  controls.target.copy(sphere.center);
  controls.minDistance = radius * 0.05;
  controls.maxDistance = distance * 8;
  controls.update();
  return { position: camera.position.clone(), target: controls.target.clone() };
}

/** Every geometry, material and texture the loader created. Left alone, reopening a
 *  conversation a few times would keep them all on the GPU. */
function disposeTree(root: Object3D): void {
  root.traverse(object => {
    const mesh = object as Object3D & { geometry?: { dispose?: () => void }; material?: unknown };
    mesh.geometry?.dispose?.();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials as Array<Record<string, unknown> & { dispose?: () => void }>) {
      for (const value of Object.values(material)) {
        const texture = value as { isTexture?: boolean; dispose?: () => void } | null;
        if (texture?.isTexture) texture.dispose?.();
      }
      material.dispose?.();
    }
  });
}
