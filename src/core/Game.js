import * as THREE from 'three';
import { Input } from './Input.js';
import { Player } from '../player/Player.js';
import { CameraRig } from '../player/CameraRig.js';
import { Hands } from '../player/Hands.js';
import { Basketball, BallMode } from '../ball/Basketball.js';
import { DribbleController } from '../ball/DribbleController.js';
import { World } from '../world/World.js';
import { AudioManager } from '../audio/AudioManager.js';
import { HUD } from '../ui/HUD.js';
import { Menu } from '../ui/Menu.js';
import { Tuning } from '../ui/Tuning.js';
import { clamp } from './MathUtils.js';
import { PLAYER } from './Constants.js';
import { codeLabel } from './Bindings.js';

/**
 * Top-level orchestrator: owns the renderer + scene, constructs every system,
 * runs the fixed-order update loop, and mediates pause / settings / audio.
 */
export class Game {
  constructor(physics, settings, handAsset) {
    this.physics = physics;
    this.settings = settings;
    this.handAsset = handAsset;
    this.paused = true;
    this.started = false;
    this._cooldowns = { court: 0, rim: 0, backboard: 0, net: 0 };
    this._accum = 0;
    this.fixedDt = 1 / 120;
    // Rapier defaults to a 1/60 step; it must match the loop or free balls
    // run at double speed.
    this.physics.setTimestep(this.fixedDt);

    this._initRenderer();
    this.scene = new THREE.Scene();

    this.audio = new AudioManager(settings);
    this.hud = new HUD();

    this.world = new World(this.scene, this.physics, settings.get('quality'));
    this._initPlayer();
    this._initInput();
    this._initMenu();
    this._initCollisionAudio();
    this.tuning = new Tuning();

    window.addEventListener('resize', () => this._onResize());
    this._onResize();
    this.clock = new THREE.Clock();
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.getElementById('app').appendChild(this.renderer.domElement);
  }

  _initPlayer() {
    // Spawn at the top of the key, facing the near hoop, ball a step ahead.
    const spawn = new THREE.Vector3(0, 0.02, 6.5);
    this.player = new Player(this.physics, spawn);

    this.cameraRig = new CameraRig(this.settings.get('fov'), window.innerWidth / window.innerHeight);
    this.cameraRig.yaw = 0; // look toward -Z
    this.cameraRig.pitch = -0.28; // a natural slight downward gaze
    this.scene.add(this.cameraRig.yawObject);

    this.hands = new Hands(this.scene, this.handAsset);
    this.ball = new Basketball(this.scene, this.physics, new THREE.Vector3(0.35, 0.3, 5.2));

    this.dribble = new DribbleController({
      player: this.player,
      cameraRig: this.cameraRig,
      hands: this.hands,
      ball: this.ball,
      audio: this.audio,
      hud: this.hud,
      hoops: this.world.hoops,
    });
    // The ball in your hands must never shove the body around.
    this.player.ignoreCollider = (c) => c.handle === this.ball.colliderHandle && this.ball.mode !== BallMode.FREE;
    this.dribble.update(0, null);
    this.hands.snapToTargets();
  }

  _initInput() {
    this.input = new Input(this.renderer.domElement);
    this.input.sensitivity = this.settings.get('sensitivity');
    this.input.invertY = this.settings.get('invertY');
    this.input.setBindings(this.settings.get('bindings'));
    this._refreshHints();
    this.input.onLockChange = (locked) => {
      if (locked) {
        this.input.allowUnlocked = false;
        this.renderer.domElement.style.cursor = '';
        this._resume();
      } else if (this.started && !this.input.allowUnlocked) {
        this._pause();
      }
    };
  }

  _initMenu() {
    this.menu = new Menu(this.settings, {
      onStart: () => this._start(),
      onResume: () => (this.input.allowUnlocked ? this._resume() : this.input.requestLock()),
      onSettingChange: (key, val) => this._applySetting(key, val),
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
        this.dribble.onBallContact(tag, speed);
        if (this._cooldowns[tag] > 0) return;
        this._cooldowns[tag] = 0.08;
        if (tag === 'court') this.audio.bounce(clamp(speed * 0.14, 0.3, 1.4));
        else if (tag === 'rim') this.audio.rim(clamp(speed * 0.16, 0.3, 1.3));
        else if (tag === 'backboard') this.audio.backboard(clamp(speed * 0.16, 0.3, 1.3));
      },
    });
  }

  // ---------------------------------------------------------------------------
  _start() {
    this.started = true;
    this.audio.init();
    this.audio.resume();
    this.audio.startAmbience({ birds: true, rain: false });
    this.input.requestLock();
    this.menu.hide();
    this.hud.show();
    this.hud.setHint(this.dribble.hints.loose);
    // Hosts that refuse pointer lock (an embedded frame): play unlocked.
    setTimeout(() => {
      if (this.started && !this.input.locked && this.paused) {
        this.input.allowUnlocked = true;
        this.renderer.domElement.style.cursor = 'none';
        this._resume();
        this.hud.setHint('This window refuses mouse capture: push the cursor toward an edge to keep turning · Esc pauses');
      }
    }, 600);
  }

  _resume() {
    this.paused = false;
    this.menu.hide();
    this.audio.resume();
  }

  _pause() {
    this.paused = true;
    this.tuning.hide();
    this.menu.showPause();
  }

  /** Hint strings follow the bindings. */
  _refreshHints() {
    const b = this.input.bindings;
    const L = (a) => codeLabel(b[a]);
    this.dribble.hints = {
      loose: `Walk into the ball to pick it up · ${L('pickup')} to grab`,
      hold: `${L('crossover')}: dribble right · ${L('between')}: dribble left · hold ${L('shoot')} to shoot · ${L('drop')}: drop`,
      layup: `${L('shoot')} to release`,
      nearRim: `${L('jump')} to drive · ${L('shoot')} to release`,
    };
  }

  _applySetting(key, val) {
    if (key === 'bindings') {
      this.input.setBindings(val);
      this._refreshHints();
      return;
    }
    if (key === 'sensitivity') this.input.sensitivity = val;
    else if (key === 'invertY') this.input.invertY = val;
    else if (key === 'fov') this.cameraRig.setFov(val);
    else if (key === 'volume') this.audio.setVolumes();
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
    const dt = clamp(this.clock.getDelta(), 0, 1 / 20);
    if (!this.paused && this.started) {
      if (this.input.wasPressed('Tab')) this.tuning.toggle();
      if (this.input.allowUnlocked && this.input.wasPressed('Escape')) {
        this._pause();
        return;
      }
      // Fixed-step simulation so the dribble timing is identical at any fps.
      this._accum += dt;
      let steps = 0;
      while (this._accum >= this.fixedDt && steps < 8) {
        this._update(this.fixedDt);
        this._accum -= this.fixedDt;
        steps++;
        // Edge-triggered input only applies to the first sub-step.
        this.input.endFrame();
      }
    }
    this.renderer.render(this.scene, this.cameraRig.camera);
    this.input.endFrame();
  }

  /** One simulation tick. Public so tests can pump the game deterministically. */
  _update(dt) {
    const look = this.input.consumeLook(dt);
    this.cameraRig.applyLook(look.dx, look.dy);

    // Jump: with the ball near the rim it is the layup takeoff; otherwise a
    // plain hop, any time the body is free (not mid-shot).
    if (this.input.pressedAction('jump') && !this.player.lockMove && this.player.grounded) {
      if (!this.dribble.tryLayupTakeoff() && this.player.jump(PLAYER.jumpSpeed)) this.audio.footstep(0.9);
    }
    this.player.update(dt, this.input, this.cameraRig);
    if (this.player.lastLandImpact > 0) {
      this.cameraRig.triggerLandDip(this.player.lastLandImpact * 0.12);
      this.audio.footstep(1.0);
    }

    this.cameraRig.update(dt, this.player.position, this.player.planarSpeed, this.player.grounded);
    this.cameraRig.yawObject.updateMatrixWorld(true);

    this.dribble.update(dt, this.input);
    this.hands.update(dt);

    this.physics.step();
    for (const k in this._cooldowns) this._cooldowns[k] = Math.max(0, this._cooldowns[k] - dt);

    this.ball.applyRollingResistance(dt);
    this.dribble.postStep();

    this.world.update(dt, this.player.position, this.ball.mesh.position);
    // The net catches the ball a little on its way through, and sings.
    const netContacts = this.world.netContacts || 0;
    if (netContacts > 0) {
      const speed = this.ball.velocity.length();
      this.ball.applyNetDrag(dt, netContacts);
      if (netContacts >= 5 && speed > 1.6 && this._cooldowns.net <= 0) {
        this._cooldowns.net = 0.6;
        this.audio.swish(clamp(speed * 0.18, 0.45, 1.25));
      }
    }
    this._footsteps(dt);
    this.hud.update(dt, this.dribble, this.player);
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
