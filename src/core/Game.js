import * as THREE from 'three';
import { Input } from './Input.js';
import { Player } from '../player/Player.js';
import { CameraRig } from '../player/CameraRig.js';
import { Hands } from '../player/Hands.js';
import { Basketball, BallMode } from '../ball/Basketball.js';
import { BallController } from '../ball/BallController.js';
import { Park } from '../world/Park.js';
import { AudioManager } from '../audio/AudioManager.js';
import { HUD } from '../ui/HUD.js';
import { Menu } from '../ui/Menu.js';
import { NetworkManager } from '../net/NetworkManager.js';
import { GameState } from '../state/GameState.js';
import { ENVIRONMENTS } from '../world/environments.js';
import { BALL } from './Constants.js';
import { clamp } from './MathUtils.js';

/**
 * Top-level orchestrator: owns the renderer + scene, constructs every system,
 * runs the fixed-order update loop, and mediates pause / settings / audio. Kept
 * deliberately thin — each subsystem does its own work; Game just sequences
 * them and handles cross-cutting concerns (resize, collision audio, pause).
 */
export class Game {
  constructor(physics, settings) {
    this.physics = physics;
    this.settings = settings;
    this.paused = true;
    this.started = false;
    this._cooldowns = { court: 0, rim: 0, backboard: 0 };

    this._initRenderer();
    this._initScene();

    this.gameState = new GameState();
    this.audio = new AudioManager(settings);
    this.hud = new HUD(this.gameState);
    this.network = new NetworkManager();

    this._initWorld();
    this._initPlayer();
    this._initInput();
    this._initMenu();
    this._initCollisionAudio();

    window.addEventListener('resize', () => this._onResize());
    this._onResize();

    this.clock = new THREE.Clock();
    this.hud.setEnvName(this.park.currentEnv.name);
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.getElementById('app').appendChild(this.renderer.domElement);
  }

  _initScene() {
    this.scene = new THREE.Scene();
  }

  _initWorld() {
    this.park = new Park(this.scene, this.physics, this.renderer, this.settings);
  }

  _initPlayer() {
    // Spawn near mid-court, a little off to the side, facing a hoop.
    const spawn = new THREE.Vector3(2.5, 0.0, 7.5);
    this.player = new Player(this.physics, spawn);

    this.cameraRig = new CameraRig(this.settings.get('fov'), window.innerWidth / window.innerHeight);
    this.cameraRig.yaw = Math.PI; // look toward -Z hoop... actually toward +Z basket
    this.scene.add(this.cameraRig.yawObject);

    this.hands = new Hands(this.cameraRig.camera);

    this.ball = new Basketball(this.scene, this.physics, new THREE.Vector3(1.2, 0.3, 5.0));

    this.ballController = new BallController({
      scene: this.scene,
      physics: this.physics,
      player: this.player,
      cameraRig: this.cameraRig,
      hands: this.hands,
      ball: this.ball,
      park: this.park,
      audio: this.audio,
      gameState: this.gameState,
      hud: this.hud,
    });
  }

  _initInput() {
    this.input = new Input(this.renderer.domElement);
    this.input.sensitivity = this.settings.get('sensitivity');
    this.input.invertY = this.settings.get('invertY');
    this.input.onLockChange = (locked) => {
      if (locked) {
        this._resume();
      } else if (this.started) {
        this._pause();
      }
    };
  }

  _initMenu() {
    this.menu = new Menu(this.settings, {
      onStart: () => this._start(),
      onResume: () => this.input.requestLock(),
      onSettingChange: (key, val) => this._applySetting(key, val),
      onEnvironment: (key) => this._setEnvironment(key),
    });
  }

  _initCollisionAudio() {
    this.physics.onContact({
      collision: (h1, h2, started) => {
        if (!started || this.ball.mode !== BallMode.FREE) return;
        const ballH = this.ball.colliderHandle;
        let other = null;
        if (h1 === ballH) other = h2;
        else if (h2 === ballH) other = h1;
        else return;
        const tag = this.physics.tagOf(other);
        if (!tag) return;
        const speed = this.ball.velocity.length();
        if (this._cooldowns[tag] > 0) return;
        this._cooldowns[tag] = 0.08;
        if (tag === 'court') this.audio.bounce(clamp(speed * 0.12, 0.3, 1.4));
        else if (tag === 'rim') this.audio.rim();
        else if (tag === 'backboard') this.audio.backboard();
      },
    });
  }

  // ---------------------------------------------------------------------------
  _start() {
    this.started = true;
    this.audio.init();
    this.audio.resume();
    this.audio.startAmbience({ birds: this.park.currentEnv.ambienceBirds, rain: this.park.currentEnv.rain });
    this.input.requestLock();
    this.menu.hide();
    this.hud.show();
  }

  _resume() {
    this.paused = false;
    this.menu.hide();
    this.audio.resume();
  }

  _pause() {
    this.paused = true;
    this.menu.showPause();
  }

  _applySetting(key, val) {
    if (key === 'sensitivity') this.input.sensitivity = val;
    else if (key === 'invertY') this.input.invertY = val;
    else if (key === 'fov') this.cameraRig.setFov(val);
    else if (key === 'volume') this.audio.setVolumes();
  }

  _setEnvironment(key) {
    this.park.applyEnvironment(key);
    this.hud.setEnvName(ENVIRONMENTS[key].name);
    if (this.audio.ready) {
      this.audio.startAmbience({ birds: ENVIRONMENTS[key].ambienceBirds, rain: ENVIRONMENTS[key].rain });
    }
  }

  _onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.cameraRig.setAspect(w / h);
  }

  // ---------------------------------------------------------------------------
  start() {
    this.renderer.setAnimationLoop(() => this._frame());
  }

  _frame() {
    const dt = clamp(this.clock.getDelta(), 0, 1 / 30);

    if (!this.paused && this.started) {
      this._update(dt);
    }

    this.renderer.render(this.scene, this.cameraRig.camera);
    this.input.endFrame();
  }

  _update(dt) {
    // 1) Look
    const look = this.input.consumeLook();
    this.cameraRig.applyLook(look.dx, look.dy);

    // 2) Player movement (kinematic controller sets next translation).
    this.player.update(dt, this.input, this.cameraRig);
    if (this.player.lastLandImpact > 0) {
      this.cameraRig.triggerLandDip(this.player.lastLandImpact * 0.14);
      this.audio.footstep(1.2);
    }

    // 3) Camera follows the player; refresh matrices for hand-space math.
    this.cameraRig.update(dt, this.player.position, this.player.planarSpeed, this.player.grounded);
    this.cameraRig.yawObject.updateMatrixWorld(true);

    // 4) Ball possession / dribble / shooting.
    this.ballController.update(dt, this.input);

    // 5) Hands damp toward their targets.
    this.hands.update(dt);

    // 6) Step physics once (CCD handles fast shots).
    this.physics.step();
    for (const k in this._cooldowns) this._cooldowns[k] = Math.max(0, this._cooldowns[k] - dt);

    // 7) Rolling resistance + place the ball mesh from the post-step state.
    this.ball.applyRollingResistance(dt);
    this.ballController.postStep();

    // 8) World animation (grass wind, sun follow, net sim, weather).
    this.park.update(dt, this.player.position);
    const ballPos = this.ball.position;
    for (const hoop of this.park.hoops) {
      hoop.update(dt, ballPos, BALL.radius);
    }

    // 9) Footstep audio cadence.
    this._footsteps(dt);

    // 10) Publish networking snapshot (no-op transport by default).
    this.network.update(dt, NetworkManager.snapshot(this.player, this.cameraRig, this.ballController));
  }

  _footsteps(dt) {
    this._stepTimer = (this._stepTimer || 0) + dt;
    if (this.player.grounded && this.player.planarSpeed > 1.2) {
      const interval = clamp(0.62 - this.player.planarSpeed * 0.05, 0.28, 0.6);
      if (this._stepTimer >= interval) {
        this._stepTimer = 0;
        this.audio.footstep(clamp(this.player.planarSpeed * 0.14, 0.3, 1));
      }
    }
  }
}
