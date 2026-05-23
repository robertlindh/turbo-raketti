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
