export interface ShipInput {
  thrust: boolean;   // accelerate along ship's facing direction
  rotateLeft: boolean;
  rotateRight: boolean;
  fire: boolean;
  special: boolean;  // secondary weapon (joystick-down on original)
}

export interface KeyBinding {
  thrust: string[];
  rotateLeft: string[];
  rotateRight: string[];
  fire: string[];
  special: string[];
}

export const PLAYER1_KEYS: KeyBinding = {
  thrust: ["ArrowUp"],
  rotateLeft: ["ArrowLeft"],
  rotateRight: ["ArrowRight"],
  fire: ["Space", "ArrowDown"],
  special: ["ShiftRight", "ControlRight"],
};

export const PLAYER2_KEYS: KeyBinding = {
  thrust: ["KeyW"],
  rotateLeft: ["KeyA"],
  rotateRight: ["KeyD"],
  fire: ["KeyS", "ShiftLeft"],
  special: ["ControlLeft", "KeyQ"],
};

export class KeyboardInput {
  private keys = new Set<string>();
  private readonly trapped = new Set([
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Space",
  ]);

  private onDown = (e: KeyboardEvent) => {
    this.keys.add(e.code);
    if (this.trapped.has(e.code)) e.preventDefault();
  };
  private onUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  attach() {
    window.addEventListener("keydown", this.onDown);
    window.addEventListener("keyup", this.onUp);
  }

  detach() {
    window.removeEventListener("keydown", this.onDown);
    window.removeEventListener("keyup", this.onUp);
  }

  read(binding: KeyBinding): ShipInput {
    const any = (codes: string[]) => codes.some((c) => this.keys.has(c));
    return {
      thrust: any(binding.thrust),
      rotateLeft: any(binding.rotateLeft),
      rotateRight: any(binding.rotateRight),
      fire: any(binding.fire),
      special: any(binding.special),
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// GamepadInput — standard XInput-style mapping.
//
// Buttons (standard mapping):
//   0  A          (south) — thrust
//   1  B          (east)  — special
//   2  X          (west)  — fire
//   3  Y          (north) — special (alt)
//   4  LB                  — special (alt)
//   5  RB                  — fire (alt)
//   6  LT (analog)         — fire (alt, half-press)
//   7  RT (analog)         — thrust (alt)
//   12 D-pad up
//   13 D-pad down
//   14 D-pad left          — rotate left
//   15 D-pad right         — rotate right
//
// Axes:
//   0  Left-stick X        — rotate (analog)
//   1  Left-stick Y
//   2  Right-stick X
//   3  Right-stick Y
//
// On-screen rotation in the rest of the engine is on/off (rotateLeft /
// rotateRight). To keep things consistent we deadzone the stick to 0.3 and
// emit booleans. Holding the stick further does not (yet) increase turn rate.
// ──────────────────────────────────────────────────────────────────────────

const STICK_DEADZONE = 0.3;
const TRIGGER_THRESHOLD = 0.4;

export class GamepadInput {
  private connected = new Set<number>();

  attach() {
    window.addEventListener("gamepadconnected", this.onConnect);
    window.addEventListener("gamepaddisconnected", this.onDisconnect);
    // Pick up any gamepads that were already plugged in.
    for (const gp of this.scanPads()) {
      if (gp) this.connected.add(gp.index);
    }
  }

  detach() {
    window.removeEventListener("gamepadconnected", this.onConnect);
    window.removeEventListener("gamepaddisconnected", this.onDisconnect);
    this.connected.clear();
  }

  private onConnect = (e: GamepadEvent) => {
    this.connected.add(e.gamepad.index);
  };

  private onDisconnect = (e: GamepadEvent) => {
    this.connected.delete(e.gamepad.index);
  };

  /** Set of currently-connected gamepad indices. */
  connectedIndices(): number[] {
    return [...this.connected].sort((a, b) => a - b);
  }

  /** Is the gamepad at this index currently connected and responsive? */
  isConnected(index: number): boolean {
    if (!this.connected.has(index)) return false;
    const gp = this.scanPads()[index];
    return !!gp && gp.connected;
  }

  /** Read a ShipInput from the gamepad at the given index. Returns an
   *  all-false input if the gamepad isn't plugged in. */
  read(index: number): ShipInput {
    const pad = this.scanPads()[index];
    if (!pad || !pad.connected) {
      return { thrust: false, rotateLeft: false, rotateRight: false, fire: false, special: false };
    }

    const button = (i: number) => {
      const b = pad.buttons[i];
      return !!b && (b.pressed || b.value > TRIGGER_THRESHOLD);
    };
    const stickX = pad.axes[0] ?? 0;

    const dpadLeft  = button(14);
    const dpadRight = button(15);

    return {
      thrust:      button(0) || button(7),                       // A or RT
      rotateLeft:  dpadLeft  || stickX < -STICK_DEADZONE,
      rotateRight: dpadRight || stickX >  STICK_DEADZONE,
      fire:        button(2) || button(5) || button(6),          // X or RB or LT
      special:     button(1) || button(3) || button(4),          // B or Y or LB
    };
  }

  private scanPads(): (Gamepad | null)[] {
    // navigator.getGamepads returns a stable list (length 4) where each
    // slot is either a Gamepad object or null.
    return navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
  }
}

/** OR two ShipInputs together (returns a fresh object). Useful for combining
 *  keyboard + gamepad per player so either device works. */
export function orInputs(a: ShipInput, b: ShipInput): ShipInput {
  return {
    thrust: a.thrust || b.thrust,
    rotateLeft: a.rotateLeft || b.rotateLeft,
    rotateRight: a.rotateRight || b.rotateRight,
    fire: a.fire || b.fire,
    special: a.special || b.special,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// TouchInput — virtual on-screen controls for phones / tablets. Renders a
// fixed control overlay with five buttons:
//   • Left-thumb area:  ◄ rotate-left   ► rotate-right
//   • Right-thumb area: △ thrust   ◯ fire   ✦ special
// Only activates when `hasTouch()` returns true so desktop users don't see
// the overlay. Multi-touch is supported — each button tracks the touches
// currently over it independently of the others.
// ──────────────────────────────────────────────────────────────────────────

export function hasTouch(): boolean {
  return typeof window !== "undefined"
    && ("ontouchstart" in window || (navigator.maxTouchPoints ?? 0) > 0);
}

type TouchButtonId = "left" | "right" | "thrust" | "fire" | "special";

export class TouchInput {
  private state: Record<TouchButtonId, boolean> = {
    left: false, right: false, thrust: false, fire: false, special: false,
  };
  /** Per-pointer mapping so when a finger slides off a button we still
   *  release it correctly on touchend. */
  private pointerToButton = new Map<number, TouchButtonId>();
  private root: HTMLElement | null = null;
  private buttons: Partial<Record<TouchButtonId, HTMLElement>> = {};

  attach(): void {
    if (!hasTouch() || this.root) return;
    this.buildOverlay();
  }

  detach(): void {
    this.root?.remove();
    this.root = null;
    this.buttons = {};
    this.pointerToButton.clear();
    this.state = { left: false, right: false, thrust: false, fire: false, special: false };
  }

  read(): ShipInput {
    return {
      thrust: this.state.thrust,
      rotateLeft: this.state.left,
      rotateRight: this.state.right,
      fire: this.state.fire,
      special: this.state.special,
    };
  }

  private buildOverlay(): void {
    const root = document.createElement("div");
    root.id = "touch-controls";
    root.style.cssText = `
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 65;
      user-select: none;
      -webkit-user-select: none;
      touch-action: none;
    `;

    // Left cluster — rotation pad.
    const leftPad = this.makeCluster("left-pad", { left: "16px", bottom: "16px" });
    const btnLeft = this.makeButton("left", "◀");
    const btnRight = this.makeButton("right", "▶");
    leftPad.append(btnLeft, btnRight);

    // Right cluster — action stack.
    const rightPad = this.makeCluster("right-pad", { right: "16px", bottom: "16px" });
    const btnThrust = this.makeButton("thrust", "▲");
    const btnFire = this.makeButton("fire", "●");
    const btnSpecial = this.makeButton("special", "✦");
    rightPad.append(btnThrust, btnFire, btnSpecial);

    root.append(leftPad, rightPad);
    document.body.appendChild(root);
    this.root = root;
  }

  private makeCluster(_id: string, anchor: { left?: string; right?: string; bottom?: string }): HTMLElement {
    const el = document.createElement("div");
    el.style.cssText = `
      position: absolute;
      ${anchor.left ? `left: ${anchor.left};` : ""}
      ${anchor.right ? `right: ${anchor.right};` : ""}
      ${anchor.bottom ? `bottom: ${anchor.bottom};` : ""}
      display: flex;
      gap: 10px;
      pointer-events: auto;
    `;
    return el;
  }

  private makeButton(id: TouchButtonId, glyph: string): HTMLElement {
    const btn = document.createElement("div");
    btn.dataset.btn = id;
    btn.textContent = glyph;
    btn.style.cssText = `
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: rgba(20, 22, 30, 0.55);
      border: 2px solid rgba(174, 240, 255, 0.5);
      color: #aef0ff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 26px;
      font-family: system-ui, sans-serif;
      box-shadow: 0 0 16px rgba(0,0,0,0.4);
      touch-action: none;
      pointer-events: auto;
    `;
    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      this.state[id] = true;
      this.pointerToButton.set(e.pointerId, id);
      btn.style.background = "rgba(60, 110, 180, 0.85)";
      btn.style.borderColor = "#ffffff";
      try { btn.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    const onUp = (e: PointerEvent) => {
      e.preventDefault();
      this.state[id] = false;
      this.pointerToButton.delete(e.pointerId);
      btn.style.background = "rgba(20, 22, 30, 0.55)";
      btn.style.borderColor = "rgba(174, 240, 255, 0.5)";
      try { btn.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    btn.addEventListener("pointerdown", onDown);
    btn.addEventListener("pointerup", onUp);
    btn.addEventListener("pointercancel", onUp);
    btn.addEventListener("pointerleave", (e) => {
      // Only release if the pointer is no longer pressed.
      if (e.buttons === 0) onUp(e);
    });
    this.buttons[id] = btn;
    return btn;
  }
}
