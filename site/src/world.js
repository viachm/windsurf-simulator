// 3D world: sea, sky, wind visualisation, board + rig + sailor, camera.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { isKostia, applyKostiaSail } from './kostia.js?b=100';

const DEG = Math.PI / 180;

// Shared wave parameters (used by the sea shader AND by JS for board bobbing).
const WAVES = [
  { dir: [0.9, 0.42], amp: 0.14, len: 11.0, speed: 1.1 },
  { dir: [0.2, -0.97], amp: 0.09, len: 6.5, speed: 1.6 },
  { dir: [-0.65, 0.75], amp: 0.05, len: 3.2, speed: 2.3 },
];

export function waveHeight(x, z, t) {
  let y = 0;
  for (const w of WAVES) {
    const k = (2 * Math.PI) / w.len;
    y += w.amp * Math.sin(k * (w.dir[0] * x + w.dir[1] * z) + t * w.speed);
  }
  return y;
}

function cylinderBetween(mesh, a, b, radius) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  mesh.scale.set(radius, Math.max(len, 0.001), radius);
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
}

// Like cylinderBetween but for a pre-tapered geometry (baked height 1, centred):
// scales radius (X/Z) uniformly and stretches length along Y from a -> b so the
// baked taper is preserved. -Y end sits at `a` (proximal), +Y end at `b`.
const _BONE_UP = new THREE.Vector3(0, 1, 0);
function boneBetween(mesh, a, b, radScale = 1) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  mesh.scale.set(radScale, Math.max(len, 0.001), radScale);
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(_BONE_UP, dir.normalize());
}

export class World {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xbfdcec, 0.0032);

    this.camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 2000);
    // Default view: a 3/4 rear angle. We sit ~45° off dead-astern toward the
    // rider's (windward/starboard) side, looking forward along the board's start
    // heading — so we watch the rider from behind his back AND peek at the
    // concave "inside" face of the sail beyond him. Start heading matches
    // WindsurfSim.reset() (~100°); phones pull back a touch more.
    const mobileZoom = matchMedia('(max-width: 768px)').matches ? 1.28 : 1;
    const startHeading = 100 * DEG;
    const nx = Math.sin(startHeading), nz = Math.cos(startHeading);   // nose direction
    const dist = 24 * mobileZoom, lift = 8.7 * mobileZoom;            // horizontal distance, height
    const az = 45 * DEG;             // swing off dead-astern toward starboard (the rider's side)
    const cb = Math.cos(az), sb = Math.sin(az);
    // behind unit = (-nx,-nz); starboard unit = (-nz, nx)
    this.camera.position.set(
      dist * (cb * -nx + sb * -nz),
      1.4 + lift,
      dist * (cb * -nz + sb * nx),
    );

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enablePan = false;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 55;   // allow zooming out a bit further than before (was 40)
    this.controls.maxPolarAngle = 85 * DEG;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.zoomSpeed = 4.5;            // gentler zoom step (was 7.0 — too aggressive)
    this.controls.target.set(0, 1.4, 0);

    // "Kostia" easter-egg sail (see kostia.js): a red IQFoil race sail with a
    // Ukraine flag and "UKR 5", on only when opened at /kostia or ?kostia.
    this.kostia = isKostia();

    this.#lightsAndSky();
    this.#sea();
    this.#windArrows();
    this.#boardAndRig();
    this.#sailor();
    this.#buoys();
    this.#splash();
    this.#wake();
    this.#trail();
    this.#routePreview();

    this.sailorSide = 1;       // +1 = port (local +X); animated on tack/gybe
    this.prevBoardPos = new THREE.Vector3();
    this.cameraMode = 'free';  // 'free' = static world-locked (player controls); 'chase' = follows heading

    // When the mobile control sheet covers the lower part of the screen, we
    // lens-shift the projection upward so the rider stays framed in the strip
    // of scene that's still visible above the sheet (instead of behind it).
    this._framingLift = 0;     // desired upward framing shift (fraction of height)
    this._lensY = 0;           // eased vertical projection offset (NDC)
    this._framingShiftX = 0;   // desired leftward framing shift (fraction of width) — clears the wind fader
    this._lensX = 0;           // eased horizontal projection offset (NDC)

    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });
  }

  #lightsAndSky() {
    const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x2a5d7c, 0.9);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2df, 1.6);
    sun.position.set(-60, 80, 40);
    this.scene.add(sun);
    this.sunDir = sun.position.clone().normalize();

    const skyGeo = new THREE.SphereGeometry(1500, 24, 12);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { sunDir: { value: this.sunDir } },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vDir;
        uniform vec3 sunDir;
        void main() {
          float h = clamp(vDir.y, 0.0, 1.0);
          vec3 horizon = vec3(0.78, 0.88, 0.94);
          vec3 zenith  = vec3(0.25, 0.55, 0.85);
          vec3 col = mix(horizon, zenith, pow(h, 0.6));
          float sun = pow(max(dot(vDir, sunDir), 0.0), 600.0);
          col += vec3(1.0, 0.9, 0.7) * sun * 1.4;
          col += vec3(1.0, 0.85, 0.6) * pow(max(dot(vDir, sunDir), 0.0), 8.0) * 0.12;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(this.sky);
  }

  #sea() {
    const geo = new THREE.PlaneGeometry(700, 700, 140, 140);
    geo.rotateX(-Math.PI / 2);
    const waveData = WAVES.map(w => ({
      dir: new THREE.Vector2(w.dir[0], w.dir[1]).normalize(),
      amp: w.amp, k: (2 * Math.PI) / w.len, speed: w.speed,
    }));
    this.seaUniforms = {
      uTime: { value: 0 },
      sunDir: { value: this.sunDir },
      camPos: { value: this.camera.position },
      fogColor: { value: new THREE.Color(0xbfdcec) },
      fogDensity: { value: 0.0032 },
    };
    // Improved water (per-pixel normals + flattened horizon) is the default now;
    // ?water=1 falls back to the original look for comparison.
    const improved = new URLSearchParams(location.search).get('water') !== '1';

    // Per-pixel slope (∂y/∂x, ∂y/∂z) of one wave, evaluated from the world
    // position — used to rebuild the surface normal in the fragment shader.
    // `wgt` scales this wave's contribution to the normal (not its geometry), so
    // the short, sharp chop can be damped while the long swell stays gentle.
    const slopeGLSL = (w, wgt) => `
          {
            float ph = ${w.k.toFixed(4)} * (${w.dir.x.toFixed(4)} * vWorld.x + ${w.dir.y.toFixed(4)} * vWorld.z) + uTime * ${w.speed.toFixed(3)};
            float c = cos(ph);
            dydx += ${(w.amp * wgt).toFixed(5)} * c * ${w.k.toFixed(4)} * ${w.dir.x.toFixed(4)};
            dydz += ${(w.amp * wgt).toFixed(5)} * c * ${w.k.toFixed(4)} * ${w.dir.y.toFixed(4)};
          }`;

    const legacyFrag = `
        varying vec3 vWorld;
        varying float vCrest;
        uniform vec3 sunDir;
        uniform vec3 camPos;
        uniform vec3 fogColor;
        uniform float fogDensity;
        uniform float uTime;
        void main() {
          vec3 deep = vec3(0.03, 0.22, 0.35);
          vec3 shallow = vec3(0.10, 0.45, 0.55);
          vec3 viewDir = normalize(camPos - vWorld);
          // fake normal from analytic crest derivative
          vec3 n = normalize(vec3(-vCrest * 0.9, 1.0, -vCrest * 0.6));
          float fres = pow(1.0 - max(dot(viewDir, n), 0.0), 3.0);
          vec3 skyRef = vec3(0.62, 0.78, 0.88);
          vec3 col = mix(deep, shallow, clamp(vWorld.y * 2.2 + 0.4, 0.0, 1.0));
          col = mix(col, skyRef, fres * 0.75);
          // exp2 fog
          float dist = length(camPos - vWorld);
          float f = 1.0 - exp(-fogDensity * fogDensity * dist * dist);
          col = mix(col, fogColor, f);
          gl_FragColor = vec4(col, 1.0);
        }`;

    // ?water=2 — same colours as the default, but (a) the normal is rebuilt PER
    // PIXEL so the highlight can't sparkle across the coarse 5m grid, and (b) the
    // surface is FLATTENED toward the horizon: the crest normal, the sky highlight
    // and the crest colour-banding all fade to a calm uniform band with distance,
    // so far water stops reading as a busy grid of crossing wave lines.
    const improvedFrag = `
        varying vec3 vWorld;
        varying float vCrest;
        uniform vec3 sunDir;
        uniform vec3 camPos;
        uniform vec3 fogColor;
        uniform float fogDensity;
        uniform float uTime;
        void main() {
          vec3 deep = vec3(0.03, 0.22, 0.35);
          vec3 shallow = vec3(0.10, 0.45, 0.55);
          float dist = length(camPos - vWorld);
          float dydx = 0.0;
          float dydz = 0.0;
          // per-wave normal strength (long swell -> short chop): keep the gentle
          // big swell, strongly damp the short waves that looked sharp near the board
          ${waveData.map((w, i) => slopeGLSL(w, [0.6, 0.45, 0.15][i] ?? 0.3)).join('')}
          // 0 near the rider -> 1 by mid-distance: how far to calm the surface
          float farFade = smoothstep(14.0, 82.0, dist);
          vec3 n = normalize(mix(vec3(-dydx, 1.0, -dydz), vec3(0.0, 1.0, 0.0), farFade));
          vec3 viewDir = normalize(camPos - vWorld);
          // crest colour banding near, easing to one flat mid tone far off
          vec3 col = mix(deep, shallow, clamp(vWorld.y * 2.2 + 0.4, 0.0, 1.0));
          col = mix(col, mix(deep, shallow, 0.5), farFade);
          // sky sheen only where the water isn't flattened -> no horizon lines
          float fres = pow(1.0 - max(dot(viewDir, n), 0.0), 3.0) * (1.0 - farFade);
          vec3 skyRef = vec3(0.62, 0.78, 0.88);
          col = mix(col, skyRef, fres * 0.55);
          float f = 1.0 - exp(-fogDensity * fogDensity * dist * dist);
          col = mix(col, fogColor, f);
          gl_FragColor = vec4(col, 1.0);
        }`;

    const mat = new THREE.ShaderMaterial({
      uniforms: this.seaUniforms,
      vertexShader: `
        uniform float uTime;
        varying vec3 vWorld;
        varying float vCrest;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          float y = 0.0;
          float crest = 0.0;
          ${waveData.map(w => `
          {
            float ph = ${w.k.toFixed(4)} * (${w.dir.x.toFixed(4)} * wp.x + ${w.dir.y.toFixed(4)} * wp.z) + uTime * ${w.speed.toFixed(3)};
            y += ${w.amp.toFixed(3)} * sin(ph);
            crest += ${w.amp.toFixed(3)} * cos(ph);
          }`).join('')}
          ${improved ? `
          // Flatten the wave GEOMETRY toward the plane edge. The sea is a finite
          // 700m plane at 5m vertex spacing; that spacing undersamples the 3-11m
          // waves out at the horizon, so the far vertices displace unevenly and
          // the silhouette against the sky breaks into jagged peaks. Fading the
          // displacement to zero by the edge gives a clean, smooth horizon line
          // (waves are invisible at that range anyway). This is the geometry
          // companion to the fragment shader's farFade, which only calms shading.
          float edgeFade = 1.0 - smoothstep(140.0, 320.0, length(position.xz));
          y *= edgeFade;
          crest *= edgeFade;` : ''}
          wp.y += y;
          vCrest = crest;
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: improved ? improvedFrag : legacyFrag,
    });
    console.log(`[windsurf-sim] water mode ${improved ? 2 : 1}`);
    this.sea = new THREE.Mesh(geo, mat);
    this.scene.add(this.sea);

    // Horizon backdrop: a big FLAT disc under the wave plane that carries the sea
    // out to where fog fully saturates. Without it the horizon was the edge of
    // the finite 700m wave plane — a square whose corner read as a hard KINK, and
    // whose only-71%-fogged edge showed as a line. This disc reaches ~1000m, so
    // its rim dissolves into fog long before it's seen: the horizon becomes a
    // clean fog line, not a geometry edge (round disc => no corner to break it).
    // It sits below the wave troughs (y=-0.5) so the detailed waves always draw
    // on top where they overlap; far off only the disc shows. Its far-water tone
    // (mid sea colour + exp2 fog) is identical to the wave shader's fully-faded
    // output, so the two blend seamlessly at the ~350m seam. (improved mode only.)
    if (improved) {
      const backdropGeo = new THREE.CircleGeometry(1000, 48);
      backdropGeo.rotateX(-Math.PI / 2);
      const backdropMat = new THREE.ShaderMaterial({
        uniforms: this.seaUniforms,
        vertexShader: `
          varying vec3 vWorld;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorld = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }`,
        fragmentShader: `
          varying vec3 vWorld;
          uniform vec3 camPos;
          uniform vec3 fogColor;
          uniform float fogDensity;
          void main() {
            vec3 deep = vec3(0.03, 0.22, 0.35);
            vec3 shallow = vec3(0.10, 0.45, 0.55);
            vec3 col = mix(deep, shallow, 0.5);   // matches the wave shader's far tone
            float dist = length(camPos - vWorld);
            float f = 1.0 - exp(-fogDensity * fogDensity * dist * dist);
            col = mix(col, fogColor, f);
            gl_FragColor = vec4(col, 1.0);
          }`,
      });
      this.seaBackdrop = new THREE.Mesh(backdropGeo, backdropMat);
      this.seaBackdrop.renderOrder = -1;   // draw before the wave plane
      this.scene.add(this.seaBackdrop);
    }
  }

  #windArrows() {
    // one flat, slim arrow outline (~1.3m tip-to-tail), tip pointing shape +Y.
    const as = new THREE.Shape();
    as.moveTo(0, 0.8);
    as.lineTo(0.05, 0.5);
    as.lineTo(0.0147, 0.5);
    as.lineTo(0.0147, -0.5);
    as.lineTo(-0.0147, -0.5);
    as.lineTo(-0.0147, 0.5);
    as.lineTo(-0.05, 0.5);
    as.lineTo(0, 0.8);
    const geo = new THREE.ShapeGeometry(as);
    geo.rotateX(-Math.PI / 2);   // lay flat: shape +Y (tip) -> local -Z

    const mat = new THREE.MeshBasicMaterial({
      color: 0xeaffff, transparent: true, opacity: 0.7,
      depthWrite: false, side: THREE.DoubleSide,
    });
    // Field is a square region that stays centred on the board (see
    // #updateWindArrows): arrows wrap toroidally so there are always arrows
    // ahead of, behind, and beside the rider no matter which way they sail.
    this.windArrowHalf = 70;     // half-size of the field, metres
    this.windArrowCount = 360;
    this.windArrowMesh = new THREE.InstancedMesh(geo, mat, this.windArrowCount);
    this.windArrowMesh.frustumCulled = false;
    this.scene.add(this.windArrowMesh);

    this.windArrowDummy = new THREE.Object3D();
    this.windArrowData = [];
    const R = this.windArrowHalf;
    for (let i = 0; i < this.windArrowCount; i++) {
      this.windArrowData.push({
        // WORLD position on the water. Wrapped into a board-centred [-R, R)
        // window each frame so the field always surrounds the rider, yet each
        // arrow stays put on the sea (you sail PAST it) instead of following.
        wx: (Math.random() * 2 - 1) * R,
        wz: (Math.random() * 2 - 1) * R,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  #boardAndRig() {
    this.board = new THREE.Group();
    this.foilEnabled = false;   // foil mode toggled from settings (setFoil)
    this.foilLift = 0;          // eased hull-lift height while flying
    this.scene.add(this.board);

    // hull: rounded surfboard outline, extruded
    const hs = new THREE.Shape();
    hs.moveTo(0, 1.35);                       // nose (shape y -> board z)
    hs.quadraticCurveTo(0.34, 1.15, 0.37, 0.2);
    hs.quadraticCurveTo(0.38, -0.9, 0.24, -1.25);
    hs.quadraticCurveTo(0.12, -1.34, 0, -1.34);
    hs.quadraticCurveTo(-0.12, -1.34, -0.24, -1.25);
    hs.quadraticCurveTo(-0.38, -0.9, -0.37, 0.2);
    hs.quadraticCurveTo(-0.34, 1.15, 0, 1.35);
    const hullGeo = new THREE.ExtrudeGeometry(hs, { depth: 0.13, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 });
    hullGeo.rotateX(Math.PI / 2);             // shape +y -> world +Z (nose forward), thickness downward
    hullGeo.translate(0, 0.19, 0);
    const hull = new THREE.Mesh(hullGeo, new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.35 })); // icon yellow
    this.board.add(hull);

    // deck pad
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.02, 1.7),
      new THREE.MeshStandardMaterial({ color: 0x14324f, roughness: 0.9 })); // dark grip so the yellow hull reads
    pad.position.set(0, 0.24, -0.45);
    this.board.add(pad);

    // footstraps (rear)
    const strapMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.8 });
    for (const z of [-0.75, -1.05]) {
      const strap = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.02, 6, 10, Math.PI), strapMat);
      strap.position.set(0.14, 0.25, z);
      strap.rotation.z = Math.PI / 2 * 0; strap.rotation.x = 0;
      this.board.add(strap);
      const strap2 = strap.clone(); strap2.position.x = -0.14; this.board.add(strap2);
    }

    // daggerboard
    this.dagger = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.75, 0.34),
      new THREE.MeshStandardMaterial({ color: 0xffa726, roughness: 0.5 }));
    this.dagger.position.set(0, -0.2, -0.1);
    this.board.add(this.dagger);

    // fin
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.35, 0.25),
      new THREE.MeshStandardMaterial({ color: 0x222831 }));
    fin.position.set(0, -0.12, -1.15);
    this.board.add(fin);

    // hydrofoil (foil mode only — hidden unless enabled). A thin mast drops from
    // under the board to a fuselage carrying a wide front wing and a small rear
    // stabiliser. When flying, the hull lifts (see foilLift below) and this stays
    // in the water. It replaces the daggerboard, which setFoil() hides.
    this.foilRig = new THREE.Group();
    const foilMat = new THREE.MeshStandardMaterial({ color: 0x2a2f37, roughness: 0.35, metalness: 0.35 });
    const foilMast = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.95, 0.11), foilMat);
    foilMast.position.set(0, -0.50, -0.20);
    this.foilRig.add(foilMast);
    const foilFuse = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.68), foilMat);
    foilFuse.position.set(0, -0.97, -0.36);
    this.foilRig.add(foilFuse);
    const foilWing = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.03, 0.20), foilMat);
    foilWing.position.set(0, -0.97, -0.06);
    this.foilRig.add(foilWing);
    const foilStab = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.025, 0.10), foilMat);
    foilStab.position.set(0, -0.97, -0.64);
    this.foilRig.add(foilStab);
    this.foilRig.visible = false;
    this.board.add(this.foilRig);

    // nose accent stripe (two-tone deck graphic)
    const nose = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.015, 0.55),
      new THREE.MeshStandardMaterial({ color: 0x1266b5, roughness: 0.55 }));
    nose.position.set(0, 0.255, 0.82);
    this.board.add(nose);

    // mast base fitting where the rig meets the deck
    const mastBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.075, 0.1, 10),
      new THREE.MeshStandardMaterial({ color: 0x2b333b, roughness: 0.6, metalness: 0.3 }));
    mastBase.position.set(0, 0.28, 0.45);
    this.board.add(mastBase);

    // ---- rig (mast + boom + sail) ----
    // Two nested groups so a mast LEAN (rake/tilt) and the sail SPIN (sheet /
    // gybe flip) don't corrupt each other:
    //  - this.rig     : leans the whole rig — rake fore/aft (X), windward tilt
    //                   (Z). Carries the mast. Never yaws, so "rake forward" is
    //                   always forward in the BOARD frame, whatever the sheet.
    //  - this.rigSpin : the boom + sail, spun around the mast axis (Y = sheet
    //                   angle, and the through-the-front rotation of a gybe).
    // (Before, sheet+rake shared one group, so at a gybe's 180° flip the "rake
    // forward" inverted and drove the sail back THROUGH the rider.)
    this.rig = new THREE.Group();
    this.rig.position.set(0, 0.28, 0.45);     // mast foot
    this.rig.rotation.order = 'YXZ';          // rake (X), then windward tilt (Z); no yaw here
    this.board.add(this.rig);

    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.05, 4.5, 8),
      new THREE.MeshStandardMaterial({ color: 0x37474f, roughness: 0.4 }));
    mast.position.y = 2.25;
    this.rig.add(mast);

    // the sail assembly that spins around the mast (child of the leaning rig)
    this.rigSpin = new THREE.Group();
    this.rig.add(this.rigSpin);

    // boom: flattened torus around the sail at chest height
    const boom = new THREE.Mesh(
      new THREE.TorusGeometry(1.0, 0.035, 8, 24),
      new THREE.MeshStandardMaterial({ color: 0x9aa4ad, roughness: 0.4, metalness: 0.4 }));
    boom.rotation.x = Math.PI / 2;
    boom.scale.set(0.32, 1.0, 1);             // narrow across, long fore-aft
    boom.position.set(0, 1.55, -1.0);
    this.rigSpin.add(boom);
    this.boom = boom;

    // sail: mast edge vertical, curved leech. Shape in (x=aft distance? see rotate below, y=up)
    const sailShape = new THREE.Shape();
    sailShape.moveTo(0, 0.55);                // tack, just above deck
    sailShape.lineTo(2.05, 1.5);              // clew (at boom end)
    sailShape.quadraticCurveTo(1.7, 3.1, 0, 4.45); // leech curve to head
    sailShape.lineTo(0, 0.55);
    const sailGeo = new THREE.ShapeGeometry(sailShape, 12);
    sailGeo.rotateY(Math.PI / 2);             // shape +x -> world -z?? R_y(90): +X -> -Z (aft) ✓
    this.sailMat = new THREE.MeshStandardMaterial({
      color: 0xff6b4d, roughness: 0.6, transparent: true, opacity: 0.9,   // icon sail (warm)
      side: THREE.DoubleSide, emissive: 0xff8a5a, emissiveIntensity: 0.2,
    });
    this.sail = new THREE.Mesh(sailGeo, this.sailMat);
    this.rigSpin.add(this.sail);

    if (this.kostia) {
      applyKostiaSail(this.sailMat, sailGeo);
      return;
    }

    // colored panel on sail
    const panelShape = new THREE.Shape();
    panelShape.moveTo(0.15, 1.0);
    panelShape.lineTo(1.75, 1.55);
    panelShape.quadraticCurveTo(1.45, 2.6, 0.15, 3.6);
    panelShape.lineTo(0.15, 1.0);
    const panelGeo = new THREE.ShapeGeometry(panelShape, 8);
    panelGeo.rotateY(Math.PI / 2);
    panelGeo.translate(0.004, 0, 0);
    const panel = new THREE.Mesh(panelGeo, new THREE.MeshStandardMaterial({
      color: 0xff9a52, roughness: 0.6, transparent: true, opacity: 0.72, side: THREE.DoubleSide, // icon inner sail
      emissive: 0xffb36a, emissiveIntensity: 0.2,
    }));
    this.sail.add(panel);

    // battens
    for (const [y0, y1, x1] of [[1.2, 1.35, 1.75], [2.2, 2.3, 1.35], [3.1, 3.15, 0.9]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.03, x1),
        new THREE.MeshStandardMaterial({ color: 0x0a2540 })); // navy battens, like the icon's linework
      b.position.set(0.006, (y0 + y1) / 2, -x1 / 2);
      this.sail.add(b);
    }
  }

  #sailor() {
    const skin = new THREE.MeshStandardMaterial({ color: 0xd9a184, roughness: 0.65 });
    const suit = new THREE.MeshStandardMaterial({ color: 0x1c2e4a, roughness: 0.85 }); // wetsuit navy
    const suit2 = new THREE.MeshStandardMaterial({ color: 0x0fb7c4, roughness: 0.8 });  // teal vest/rash top — contrasts the warm sail
    const dark = new THREE.MeshStandardMaterial({ color: 0x222b36, roughness: 0.9 });   // cap / booties
    const harnessMat = new THREE.MeshStandardMaterial({ color: 0x11161d, roughness: 0.7, metalness: 0.2 });

    // Tapered bone geometries (baked height 1, centred). Radius args: (top, bottom)
    // — bottom is the proximal (-Y) end used by boneBetween.
    const bone = (rTop, rBot) => new THREE.CylinderGeometry(rTop, rBot, 1, 10);
    const ball = new THREE.SphereGeometry(1, 12, 8); // unit sphere, scaled per joint

    const P = this.sailorParts = {};
    // torso: waist -> chest, broader at the shoulders (rash vest)
    P.torso = new THREE.Mesh(bone(0.155, 0.115), suit2);
    // a harness band around the waist for a windsurfing look (horizontal belt)
    P.harness = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.038, 8, 18), harnessMat);
    P.harness.rotation.x = Math.PI / 2;
    P.neck = new THREE.Mesh(bone(0.05, 0.06), skin);
    P.head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 12), skin);
    P.cap = new THREE.Mesh(new THREE.SphereGeometry(0.128, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), dark);

    // limbs: upper + lower segment per arm/leg, with joint caps to hide seams
    P.thighL = new THREE.Mesh(bone(0.062, 0.082), suit);
    P.thighR = new THREE.Mesh(bone(0.062, 0.082), suit);
    P.shinL = new THREE.Mesh(bone(0.045, 0.06), suit);
    P.shinR = new THREE.Mesh(bone(0.045, 0.06), suit);
    P.upperArmF = new THREE.Mesh(bone(0.04, 0.055), suit2);
    P.upperArmB = new THREE.Mesh(bone(0.04, 0.055), suit2);
    P.foreArmF = new THREE.Mesh(bone(0.032, 0.045), skin);
    P.foreArmB = new THREE.Mesh(bone(0.032, 0.045), skin);

    // joint caps (spheres) — pelvis, knees, shoulders, elbows, hands
    P.pelvis = new THREE.Mesh(ball, suit);
    P.kneeL = new THREE.Mesh(ball, suit);
    P.kneeR = new THREE.Mesh(ball, suit);
    P.shoulderF = new THREE.Mesh(ball, suit2);
    P.shoulderB = new THREE.Mesh(ball, suit2);
    P.elbowF = new THREE.Mesh(ball, skin);
    P.elbowB = new THREE.Mesh(ball, skin);
    P.handF = new THREE.Mesh(ball, skin);
    P.handB = new THREE.Mesh(ball, skin);
    // booties (feet)
    P.footL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.26), dark);
    P.footR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.26), dark);

    for (const m of Object.values(P)) this.board.add(m);
  }

  #buoys() {
    this.buoys = [];
    const mkBuoy = (color, x, z, label) => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 1.1, 12),
        new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
      body.position.y = 0.4;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 6),
        new THREE.MeshStandardMaterial({ color: 0x444444 }));
      pole.position.y = 1.6;
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.35),
        new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide }));
      flag.position.set(0.28, 2.2, 0);
      g.add(body, pole, flag);
      g.position.set(x, 0, z);
      this.scene.add(g);
      this.buoys.push(g);
      return g;
    };
    // wind starts blowing FROM +Z: upwind buoy at +Z
    mkBuoy(0xff5722, 0, 220);
    mkBuoy(0xffeb3b, 30, -220);
  }

  #splash() {
    this.splashCount = 140;
    this.splashData = [];
    const pos = new Float32Array(this.splashCount * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.splashMat = new THREE.PointsMaterial({
      color: 0xe8f6fb, size: 0.16, transparent: true, opacity: 0, depthWrite: false,
    });
    this.splashPoints = new THREE.Points(geo, this.splashMat);
    this.splashPoints.frustumCulled = false;
    this.scene.add(this.splashPoints);
    for (let i = 0; i < this.splashCount; i++) this.splashData.push({ vx: 0, vy: 0, vz: 0, life: 0 });
    this.splashLife = 0;
  }

  triggerSplash(x, y, z) {
    const posAttr = this.splashPoints.geometry.attributes.position;
    for (let i = 0; i < this.splashCount; i++) {
      const d = this.splashData[i];
      const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 3.5;
      d.vx = Math.cos(a) * sp; d.vz = Math.sin(a) * sp; d.vy = 2 + Math.random() * 4;
      d.life = 0.7 + Math.random() * 0.7;
      posAttr.setXYZ(i, x + (Math.random() - 0.5), y + Math.random() * 0.4, z + (Math.random() - 0.5));
    }
    posAttr.needsUpdate = true;
    this.splashLife = 1.4;
  }

  #wake() {
    this.wakeCount = 220;
    this.wakeIdx = 0;
    this.wakeData = [];
    const pos = new Float32Array(this.wakeCount * 3);
    for (let i = 0; i < this.wakeCount; i++) { pos[i * 3 + 1] = -10; this.wakeData.push({ life: 0 }); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.wakeMat = new THREE.PointsMaterial({
      color: 0xdfeff5, size: 0.22, transparent: true, opacity: 0.55, depthWrite: false,
    });
    this.wakePoints = new THREE.Points(geo, this.wakeMat);
    this.wakePoints.frustumCulled = false;
    this.wakePoints.visible = false;   // foam wake disabled — the tail line is the only trace
    this.scene.add(this.wakePoints);
  }

  #trail() {
    // trailPts holds the raw samples; the drawn line is a Catmull-Rom spline
    // through them (SUBDIV points per segment) so gentle turns read as a smooth
    // arc instead of a coarse polyline with visible corners.
    this.trailRawMax = 200;    // raw samples kept (200 * 0.6m ~= 120m of trail)
    this.trailSubdiv = 6;      // spline points per raw segment
    this.trailMax = (this.trailRawMax - 1) * this.trailSubdiv + 2; // buffer size (+1 for live head vertex)
    this.trailPts = [];        // {x,z}, oldest -> newest (raw samples)
    this.trailSmooth = [];     // {x,z}, oldest -> newest (spline-subdivided)
    this.trailLast = null;     // THREE.Vector3 of last recorded point
    const positions = new Float32Array(this.trailMax * 3);
    const colors = new Float32Array(this.trailMax * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setDrawRange(0, 0);
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
      // depthTest off: the line is never occluded by wave crests or hidden in
      // troughs — it always draws on top of the water so the path stays readable.
      depthTest: false,
    });
    this.trailLine = new THREE.Line(geo, mat);
    this.trailLine.frustumCulled = false;
    this.trailLine.renderOrder = 999; // draw last, above the sea surface
    this.scene.add(this.trailLine);
  }

  // "Planned route" chevrons laid AHEAD of the board during a demo. They are
  // fixed in WORLD space (not glued to the board): the board sails through them
  // and each one vanishes as it's passed, so you read your motion along them.
  // Fed world-space markers {x,z,angle,scale} by the director via setRoutePreview().
  #routePreview() {
    // one flat, SLIM chevron (thin arms, ~like the tail-trail line behind),
    // tip at shape +Y
    const s = new THREE.Shape();
    s.moveTo(0, 0.5);        // outer tip
    s.lineTo(0.42, -0.22);   // outer right arm
    s.lineTo(0.33, -0.28);   // inner right arm
    s.lineTo(0, 0.22);       // inner tip (close to the tip -> thin stroke)
    s.lineTo(-0.33, -0.28);  // inner left arm
    s.lineTo(-0.42, -0.22);  // outer left arm
    s.lineTo(0, 0.5);
    const geo = new THREE.ShapeGeometry(s);
    geo.rotateX(Math.PI / 2);        // lay flat: shape +Y (tip) -> local +Z
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffd54f, transparent: true, opacity: 0.9,
      depthWrite: false, depthTest: false, side: THREE.DoubleSide,
    });
    this.routeCount = 40;
    this.routeMesh = new THREE.InstancedMesh(geo, mat, this.routeCount);
    this.routeMesh.frustumCulled = false;
    this.routeMesh.renderOrder = 998;
    this.routeMesh.count = 0;
    this.routeMesh.visible = false;
    this.scene.add(this.routeMesh);
    this._routeDummy = new THREE.Object3D();
  }

  // markers: [{x,z,angle,scale}] world-space, board-forward, or null to hide.
  setRoutePreview(markers) {
    const mesh = this.routeMesh;
    if (!markers || !markers.length) { mesh.visible = false; mesh.count = 0; return; }
    const n = Math.min(markers.length, this.routeCount);
    const d = this._routeDummy;
    for (let i = 0; i < n; i++) {
      const m = markers[i];
      const sc = m.scale ?? 1;                 // keep 0 (a chevron ducking under the board), not `|| 1`
      d.position.set(m.x, 0.26, m.z);
      d.rotation.set(0, m.angle, 0);        // tip (local +Z) aims along the route
      d.scale.set(sc, sc, sc);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.visible = true;
  }

  update(state, dt) {
    const t = state.t;
    this.seaUniforms.uTime.value = t;

    // ---- board pose ----
    const bx = state.pos.x, bz = state.pos.z;
    // sample the wave at nose/center/tail so a crest between samples can't
    // wash over the deck — keep the hull riding the highest of the three.
    const noseDir = { x: Math.sin(state.heading), z: Math.cos(state.heading) };
    const hCenter = waveHeight(bx, bz, t);
    const hNose = waveHeight(bx + noseDir.x * 1.1, bz + noseDir.z * 1.1, t);
    const hTail = waveHeight(bx - noseDir.x * 1.1, bz - noseDir.z * 1.1, t);
    // foil flight: ease the whole hull up out of the water while flying (the
    // foil rig, a child of the board, stays down in it).
    const flyTarget = state.foiling ? 0.6 : 0;
    this.foilLift += (flyTarget - this.foilLift) * Math.min(dt * 2.4, 1);
    const bobY = Math.max(hCenter, hNose, hTail) + 0.10 + (state.planing ? 0.10 : 0) + this.foilLift;
    const sink = state.crashed ? -0.12 : 0;
    this.board.position.set(bx, bobY + sink, bz);
    this.board.rotation.order = 'YXZ';
    this.board.rotation.y = state.heading;

    const side = state.beta >= 0 ? 1 : -1;     // +1: wind over port (local +X)
    // pitch: nose up when planing, plus wave rocking
    const pitchWave = (waveHeight(bx, bz + 1.2, t) - waveHeight(bx, bz - 1.2, t)) * 0.25;
    this.board.rotation.x = (state.foiling ? -0.05 : state.planing ? -0.06 : 0.01) + pitchWave
      + (state.inputs.stance === 'front' && state.v > 4 ? 0.05 : 0);
    // roll: heel with power, rock with waves
    const rollWave = (waveHeight(bx + 1, bz, t) - waveHeight(bx - 1, bz, t)) * 0.18;
    // carve bank: the board rolls into the turn, harder the faster you carve
    const bank = THREE.MathUtils.clamp(-(state.yawVel || 0) * Math.max(state.v, 0) * 0.05, -0.28, 0.28);
    this.board.rotation.z = side * (0.02 + 0.10 * (state.heel01 || 0)) * -1 + rollWave
      + bank + (state.crashed ? 0.5 : 0);

    // ---- rig pose ----
    const sheetRad = (state.inputs.sheetDeg || 45) * DEG;
    const m = state.maneuver;
    // Which side the RIDER should be on. Off a maneuver this tracks the wind
    // side; during a maneuver it is driven by the turn so the rider and rig
    // cross together instead of snapping when beta passes through 0/180.
    let riderTargetSide = side;
    let sailYaw = side * sheetRad;
    let maneuverLuff = false;

    if (m) {
      if (m.phase === 'setup') {
        // Setup: still sailing to the entry angle, sheeted on the entry tack.
        riderTargetSide = m.s;
        sailYaw = m.s * sheetRad;
        this.rig.rotation.x = m.type === 'gybe' ? 0.06 : -0.04; // slight rake in the setup sense
      } else {
        // Turn: rig crosses over, luffs through the midpoint, settles on the
        // new side. Rider slides across in lock-step.
        const flip = THREE.MathUtils.smoothstep(m.turn01 || 0, 0.15, 0.85); // 0->1
        const manSide = m.s * (1 - 2 * flip);
        riderTargetSide = manSide;
        if (m.type === 'gybe') {
          // GYBE: the rig FLIPS around the mast. The clew is released and the
          // sail rotates the long way round the mast axis — sweeping FORWARD
          // across the nose (through ~180°) to fill on the new side. It never
          // feathers head-to-wind; it stays powered through the flip. So the
          // yaw runs entry(+m.s·sheet) -> 180° at the crossover -> new side,
          // instead of collapsing through 0° like a tack.
          sailYaw = m.s * (sheetRad + flip * (2 * Math.PI - 2 * sheetRad));
        } else {
          // TACK: the sail feathers head-to-wind — the clew swings across the
          // TAIL, collapsing through ~0° (dead aft) at the crossover, then opens
          // on the new side.
          sailYaw = manSide * sheetRad * (0.35 + 0.65 * Math.abs(1 - 2 * flip));
        }
        // rake swing: a tack throws the rig back over the tail, a gybe throws it
        // forward across the nose. Peaks at the crossover.
        const swing = Math.sin(Math.PI * (m.turn01 || 0));
        this.rig.rotation.x = (m.type === 'tack' ? -0.55 : 0.6) * swing;
        // A tack flogs head-to-wind through the eye; a gybe stays powered and
        // just briefly depowers at the flip, so only the tack gets the flutter.
        maneuverLuff = m.type === 'tack' && Math.abs(1 - 2 * flip) < 0.5;
        if (maneuverLuff) sailYaw += Math.sin(t * 24) * 0.06;
        this.rigSpin.rotation.y = sailYaw;   // spin around the (leaning) mast
        this.rig.rotation.z = -manSide * 0.10;
      }
    }
    if (!m || m.phase === 'setup') {
      if (state.trim === 'luff' && !state.crashed) sailYaw += Math.sin(t * 22) * 0.05; // flutter
      this.rigSpin.rotation.y = sailYaw;
      if (!m) this.rig.rotation.x = (state.inputs.rake || 0) * 0.30;        // fwd = tilt to nose
      this.rig.rotation.z = -side * (0.10 + 0.22 * Math.min(state.eff01 || 0, 1)); // rake to windward
    }
    if (state.crashed) { this.rig.rotation.z = -side * 1.35; this.rig.rotation.x = 0.2; }

    // sail visual power: bulge opacity trick
    const luffing = maneuverLuff || (state.trim === 'luff' && !m);
    this.sailMat.opacity = luffing ? 0.75 + Math.sin(t * 26) * 0.08 : 0.9;

    // daggerboard slides up/down
    const dagTargetY = state.inputs.dagger ? -0.2 : 0.28;
    this.dagger.position.y += (dagTargetY - this.dagger.position.y) * Math.min(dt * 5, 1);

    // ---- sailor ----
    // Cross a touch faster during a maneuver so the rider stays with the rig.
    const crossRate = m && m.phase === 'turn' ? 4.5 : 2.5;
    this.sailorSide += (riderTargetSide - this.sailorSide) * Math.min(dt * crossRate, 1);
    this.#poseSailor(state, t);

    // ---- wind arrows ----
    this.#updateWindArrows(state, dt);

    // ---- splash & wake ----
    this.#updateSplash(dt);
    this.#updateWake(state, dt);

    // ---- board's tail trace ----
    this.#updateTrail(state, dt);

    // ---- sea & sky follow the board ----
    this.sea.position.set(bx, 0, bz);
    if (this.seaBackdrop) this.seaBackdrop.position.set(bx, -0.5, bz);
    this.sky.position.set(bx, 0, bz);

    // ---- camera follows ----
    const boardPos = this.board.position;
    // Two modes (user-selectable in settings, default 'free'):
    //  - 'free'  : the camera keeps a fixed world orientation and only slides
    //              along with the board. It never turns on its own — the rider
    //              rotates under it — and the player owns the angle via orbit.
    //  - 'chase' : the camera swings around the board to track heading, so the
    //              over-the-shoulder view stays behind the rider through turns.
    if (this._prevHeading === undefined) this._prevHeading = state.heading;
    let dHeading = state.heading - this._prevHeading;
    this._prevHeading = state.heading;
    if (Math.abs(dHeading) > 0.5) dHeading = 0;   // ignore reset/recover teleports
    if (dHeading && this.cameraMode === 'chase') {
      const off = new THREE.Vector3().subVectors(this.camera.position, this.prevBoardPos);
      const c = Math.cos(dHeading), s = Math.sin(dHeading);
      const ox = off.x * c + off.z * s;         // rotate about +Y, same sense as board.rotation.y
      const oz = -off.x * s + off.z * c;
      off.set(ox, off.y, oz);
      this.camera.position.copy(this.prevBoardPos).add(off);
    }
    const delta = new THREE.Vector3().subVectors(boardPos, this.prevBoardPos);
    if (delta.lengthSq() < 100) this.camera.position.add(delta);
    this.prevBoardPos.copy(boardPos);
    this.controls.target.lerp(new THREE.Vector3(boardPos.x, boardPos.y + 1.4, boardPos.z), Math.min(dt * 6, 1));
    this.controls.update();

    // Lens-shift the rider so it stays centred in the clear band between the
    // top overlays and the control sheet (mobile). Ease it so opening/closing
    // the sheet pans smoothly. elements[9] is the frustum's vertical off-centre
    // term; negative lifts the subject up the screen.
    const targetLens = -this._framingLift;
    this._lensY += (targetLens - this._lensY) * Math.min(dt * 8, 1);
    this.camera.projectionMatrix.elements[9] = this._lensY;

    // elements[8] is the horizontal off-centre term; positive nudges the subject
    // LEFT on screen (by _lensX * halfWidth), keeping the rider centred in the
    // water to the left of the wind fader — regardless of the orbit angle.
    this._lensX += (this._framingShiftX - this._lensX) * Math.min(dt * 8, 1);
    this.camera.projectionMatrix.elements[8] = this._lensX;

    this.renderer.render(this.scene, this.camera);
  }

  // 'free' (default): camera keeps a fixed world orientation, player owns the
  // angle via orbit. 'chase': camera swings to stay behind the board.
  setCameraMode(mode) { this.cameraMode = mode === 'chase' ? 'chase' : 'free'; }

  // Foil mode: show the hydrofoil rig and hide the daggerboard (the foil replaces
  // it). Physics lives in sim.js; this is purely the board's look.
  setFoil(on) {
    this.foilEnabled = !!on;
    if (this.foilRig) this.foilRig.visible = this.foilEnabled;
    if (this.dagger) this.dagger.visible = !this.foilEnabled;
  }

  // Vertical framing offset (fraction of viewport height): positive lifts the
  // rider up the screen so it stays centred between the HUD and the open sheet.
  setFramingLift(f) {
    this._framingLift = Math.max(-0.35, Math.min(0.85, f || 0));
  }

  // Horizontal framing offset (fraction of viewport width): positive shifts the
  // rider left, so it stays centred in the water beside the wind fader.
  setFramingShiftX(f) {
    this._framingShiftX = Math.max(-0.4, Math.min(0.4, f || 0));
  }

  #poseSailor(state, t) {
    const P = this.sailorParts;
    const side = this.sailorSide;
    const crashed = state.crashed;

    // stance -> fore/aft feet placement (board local: nose +Z, mast foot at z=0.45)
    let stanceZ = { front: 0.1, mid: -0.4, back: -0.85 }[state.inputs.stance || 'mid'];
    // During a tack the rider steps FORWARD around the front of the mast, then
    // crosses to the new side — an arc around the mast foot, not a straight
    // sideways slide. The step peaks at the crossover and eases back to stance.
    // (A gybe walks a smaller arc, staying more aft.)
    const m = state.maneuver;
    let stepUp = 0;
    if (m && m.phase === 'turn' && !crashed) {
      const arc = Math.sin(Math.PI * (m.turn01 || 0));    // 0 at the ends, 1 at crossover
      stanceZ += (m.type === 'tack' ? 0.62 : 0.30) * arc; // toward the nose / mast foot
      stepUp = 0.06 * arc;                                // light weight-shift bob as he steps
    }
    const lean = crashed ? 0.1 : (state.inputs.lean || 0) / 100;

    const deckY = 0.27;
    const footX = side * 0.16;
    const fFront = new THREE.Vector3(footX, deckY, stanceZ + 0.3);
    const fBack = new THREE.Vector3(footX * 1.2, deckY, stanceZ - 0.25);

    // pelvis: above feet, offset to windward as the rider hikes out
    const hipHeight = 0.85 - lean * 0.25 + stepUp;
    const hipOut = side * (0.1 + lean * 0.55);
    const pelvis = new THREE.Vector3(footX + hipOut, deckY + hipHeight, stanceZ);
    const chest = new THREE.Vector3(footX + hipOut * 1.5, pelvis.y + 0.5 - lean * 0.1, stanceZ + 0.12);

    if (crashed) { // slumped in the water beside the board
      pelvis.set(side * 1.2, -0.1, stanceZ);
      chest.set(side * 1.5, 0.05, stanceZ + 0.1);
    }

    // ---- legs: hip (pelvis) -> knee -> foot, knees bent forward toward the nose ----
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const jointAt = (mesh, p, r) => { mesh.position.copy(p); mesh.scale.setScalar(r); };

    const kneeL = fFront.clone().lerp(pelvis, 0.5); kneeL.z += 0.11; kneeL.y += 0.02;
    const kneeR = fBack.clone().lerp(pelvis, 0.5);  kneeR.z += 0.08; kneeR.y += 0.02;
    boneBetween(P.thighL, pelvis, kneeL);
    boneBetween(P.thighR, pelvis, kneeR);
    boneBetween(P.shinL, kneeL, fFront);
    boneBetween(P.shinR, kneeR, fBack);
    jointAt(P.pelvis, pelvis, 0.1);
    jointAt(P.kneeL, kneeL, 0.06);
    jointAt(P.kneeR, kneeR, 0.06);
    // booties resting on the deck, pointing forward
    P.footL.position.copy(fFront).add(V(0, -0.03, 0.06));
    P.footR.position.copy(fBack).add(V(0, -0.03, 0.06));
    P.footL.rotation.set(0, 0, 0); P.footR.rotation.set(0, 0, 0);

    // ---- torso + head ----
    boneBetween(P.torso, pelvis, chest);
    P.harness.position.copy(pelvis).lerp(chest, 0.18).add(V(0, 0.02, 0));
    const neckBase = chest.clone().add(V(side * 0.01, 0.12, 0.02));
    const headPos = chest.clone().add(V(side * 0.02, 0.34, 0.03));
    boneBetween(P.neck, neckBase, headPos.clone().add(V(0, -0.1, 0)));
    P.head.position.copy(headPos);
    P.cap.position.copy(headPos).add(V(0, 0.015, -0.01));

    // ---- arms: shoulder -> elbow -> hand on the boom ----
    // boom grip points in board-local space (windward side of the boom torus).
    // The boom rides on rigSpin (the sail spin), inside rig (the mast lean), so
    // apply the spin first, then the lean, then the mast-foot offset.
    const grip = (z) => V(0, 1.55, z).applyEuler(this.rigSpin.rotation).applyEuler(this.rig.rotation).add(this.rig.position);
    const g1 = grip(-0.45);
    const g2 = grip(-1.1);
    const shoulderF = chest.clone().add(V(side * 0.12, 0.14, 0.08));
    const shoulderB = chest.clone().add(V(side * 0.12, 0.14, -0.08));

    let handF, handB;
    if (!crashed) {
      handF = g1; handB = g2;
    } else { // arms flail toward the water beside the board
      handF = chest.clone().add(V(side * 0.4, 0.1, 0.3));
      handB = chest.clone().add(V(side * 0.5, 0.05, -0.2));
    }
    // elbows bend down-and-out from the straight shoulder->hand line
    const elbowF = shoulderF.clone().lerp(handF, 0.5).add(V(side * 0.05, -0.09, 0));
    const elbowB = shoulderB.clone().lerp(handB, 0.5).add(V(side * 0.05, -0.09, 0));
    boneBetween(P.upperArmF, shoulderF, elbowF);
    boneBetween(P.upperArmB, shoulderB, elbowB);
    boneBetween(P.foreArmF, elbowF, handF);
    boneBetween(P.foreArmB, elbowB, handB);
    jointAt(P.shoulderF, shoulderF, 0.06);
    jointAt(P.shoulderB, shoulderB, 0.06);
    jointAt(P.elbowF, elbowF, 0.048);
    jointAt(P.elbowB, elbowB, 0.048);
    jointAt(P.handF, handF, 0.05);
    jointAt(P.handB, handB, 0.05);
  }

  #updateWindArrows(state, dt) {
    const wa = state.windFromAngle;
    const wvx = -Math.sin(wa), wvz = -Math.cos(wa);   // downwind unit dir
    const speed = (state.windKn / 1.94384) * 0.8;
    const bx = state.pos.x, bz = state.pos.z;
    const t = state.t;
    const R = this.windArrowHalf, span = R * 2;
    const dummy = this.windArrowDummy;
    for (let i = 0; i < this.windArrowCount; i++) {
      const a = this.windArrowData[i];
      // Arrows live in WORLD space and only drift downwind — they do NOT follow
      // the board. Each frame the arrow is wrapped into a board-centred [-R, R)
      // window: while it sits within R it stays exactly where it is on the water,
      // so you visibly sail PAST it and the flow rate past you matches the board's
      // speed. Once the board pulls more than R away the arrow teleports one whole
      // span to refill the field ahead — a jump that only ever happens out at the
      // faded edge, so it never pops in view.
      a.wx += wvx * speed * dt;
      a.wz += wvz * speed * dt;
      a.wx = bx + (((a.wx - bx + R) % span + span) % span - R);
      a.wz = bz + (((a.wz - bz + R) % span + span) % span - R);
      const x = a.wx, z = a.wz;
      const y = waveHeight(x, z, t) + 0.30;
      // pulsing shimmer, scaled between ~0.75 and ~1.45
      const pulse = 1.1 + 0.35 * Math.sin(t + a.phase);
      // fade out toward the window edge so the wrap teleports never pop into view
      const edge = Math.max(Math.abs(x - bx), Math.abs(z - bz)) / R;   // 0..1
      const edgeFade = 1 - Math.min(1, Math.max(0, (edge - 0.8) / 0.2));
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, wa, 0);       // tip (local -Z) points downwind
      dummy.scale.setScalar(pulse * edgeFade);
      dummy.updateMatrix();
      this.windArrowMesh.setMatrixAt(i, dummy.matrix);
    }
    this.windArrowMesh.instanceMatrix.needsUpdate = true;
  }

  #updateTrail(state, dt) {
    const bx = state.pos.x, bz = state.pos.z;
    // The trace is left by the TAIL (~1.25m aft of centre), not the board centre —
    // in a turn the tail sweeps a wider arc than the pivot, like a real wake.
    const fx = Math.sin(state.heading), fz = Math.cos(state.heading);
    const tx = bx - fx * 1.25, tz = bz - fz * 1.25;
    const cur = new THREE.Vector3(tx, 0.12, tz);

    // Backward clock = a reset (R): full restart at the origin — wipe the trace.
    // Keying on the clock (not distance) means normal sailing — including the
    // metres a board drifts while crashed — never falsely erases the trail.
    if (this.trailPrevT !== undefined && state.t < this.trailPrevT - 0.001) {
      this.trailPts.length = 0;
      this.trailSmooth.length = 0;
      this.trailLast = null;
    }
    this.trailPrevT = state.t;

    // Record through crash drift too (the board is still moving on the water), so
    // there is no frozen anchor and no long "bridge" segment on recovery. Sample
    // finely (0.6m) so turns are captured well before the spline smooths them.
    if (state.v > 0.4 &&
        (!this.trailLast || cur.distanceTo(this.trailLast) >= 0.6)) {
      this.trailPts.push({ x: cur.x, z: cur.z });
      if (this.trailPts.length > this.trailRawMax) this.trailPts.shift();
      this.trailLast = cur.clone();
      // Re-spline only when a sample is added/dropped, not every frame.
      this.#rebuildTrailSmooth();
    }

    // rewrite the whole strip each frame, oldest -> newest, fading toward dark
    // (additive blending -> dark reads as invisible). y follows the live wave
    // surface so the trail stays visible on top of the water.
    const pts = this.trailSmooth;
    const n = pts.length;
    const posAttr = this.trailLine.geometry.attributes.position;
    const colAttr = this.trailLine.geometry.attributes.color;
    const nr = 0x8e / 255, ng = 0xf0 / 255, nb = 0xff / 255; // newest = bright cyan
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      posAttr.setXYZ(i, p.x, waveHeight(p.x, p.z, state.t) + 0.14, p.z);
      // sqrt curve keeps more of the tail visible so it reads as a fade, not a cut
      const f = n > 1 ? Math.sqrt(i / (n - 1)) : 1;   // 0 oldest -> 1 newest
      colAttr.setXYZ(i, nr * f, ng * f, nb * f);
    }
    // Samples are only recorded every 0.6m, so without this the drawn line would
    // end up to 0.6m behind the tail. Append a live vertex at the current tail
    // position each frame so the line always reaches the board.
    let total = n;
    if (n > 0) {
      posAttr.setXYZ(n, tx, waveHeight(tx, tz, state.t) + 0.14, tz);
      colAttr.setXYZ(n, nr, ng, nb);
      total = n + 1;
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    this.trailLine.geometry.setDrawRange(0, total);
  }

  // Rebuild the smoothed (spline) path from the raw samples. A centripetal
  // Catmull-Rom curve passes through every sample without the loops/overshoot a
  // uniform spline would add at sharp turns, so the drawn line reads as a gently
  // rounded arc rather than a chain of straight segments.
  #rebuildTrailSmooth() {
    const raw = this.trailPts;
    const n = raw.length;
    if (n < 3) {
      // too few points to spline — mirror the raw samples verbatim
      this.trailSmooth = raw.map(p => ({ x: p.x, z: p.z }));
      return;
    }
    const vecs = raw.map(p => new THREE.Vector3(p.x, 0, p.z));
    const curve = new THREE.CatmullRomCurve3(vecs, false, 'centripetal');
    const divisions = (n - 1) * this.trailSubdiv; // getPoints returns divisions+1 pts
    const sampled = curve.getPoints(divisions);
    this.trailSmooth = sampled.map(v => ({ x: v.x, z: v.z }));
  }

  #updateSplash(dt) {
    if (this.splashLife <= 0) { this.splashMat.opacity = 0; return; }
    this.splashLife -= dt;
    this.splashMat.opacity = Math.max(0, Math.min(1, this.splashLife));
    const posAttr = this.splashPoints.geometry.attributes.position;
    for (let i = 0; i < this.splashCount; i++) {
      const d = this.splashData[i];
      if (d.life <= 0) continue;
      d.life -= dt;
      d.vy -= 9.8 * dt;
      posAttr.setXYZ(i,
        posAttr.getX(i) + d.vx * dt,
        Math.max(-0.2, posAttr.getY(i) + d.vy * dt),
        posAttr.getZ(i) + d.vz * dt);
    }
    posAttr.needsUpdate = true;
  }

  #updateWake(state, dt) {
    const posAttr = this.wakePoints.geometry.attributes.position;
    if (state.v > 2 && !state.crashed) {
      // emit a few particles at the tail (just a thin mast trail while foiling —
      // the hull is out of the water, so almost no wake)
      const n = state.foiling ? 1 : state.planing ? 4 : 2;
      const f = { x: Math.sin(state.heading), z: Math.cos(state.heading) };
      for (let k = 0; k < n; k++) {
        const i = this.wakeIdx = (this.wakeIdx + 1) % this.wakeCount;
        this.wakeData[i].life = 1.6;
        posAttr.setXYZ(i,
          state.pos.x - f.x * 1.3 + (Math.random() - 0.5) * 0.5,
          0.08,
          state.pos.z - f.z * 1.3 + (Math.random() - 0.5) * 0.5);
      }
    }
    for (let i = 0; i < this.wakeCount; i++) {
      const d = this.wakeData[i];
      if (d.life > 0) { d.life -= dt; if (d.life <= 0) posAttr.setY(i, -10); }
    }
    posAttr.needsUpdate = true;
  }
}
