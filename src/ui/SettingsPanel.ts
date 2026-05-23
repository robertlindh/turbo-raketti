import {
  SETTINGS, DEFAULT_SETTINGS, setSetting, resetSettings, saveSettings,
  hasPersistedSettings,
  type GameSettings,
} from "../game/Settings";

interface Slider {
  key: keyof GameSettings;
  label: string;
  min: number;
  max: number;
  step: number;
}

const SECTIONS: Array<{ title: string; sliders: Slider[] }> = [
  {
    title: "Physics",
    sliders: [
      { key: "gravity",            label: "Gravity (m/s²)",         min: 0,   max: 30,  step: 0.1 },
      { key: "shipThrust",         label: "Thrust accel (m/s²)",    min: 0,   max: 80,  step: 1   },
      { key: "shipRotate",         label: "Rotation rate (rad/s)",  min: 0,   max: 10,  step: 0.1 },
      { key: "shipMaxSpeed",       label: "Max speed (m/s)",        min: 5,   max: 80,  step: 1   },
      { key: "shipLinearDamping",  label: "Linear damping",         min: 0,   max: 2,   step: 0.01 },
      { key: "shipAngularDamping", label: "Angular damping",        min: 0,   max: 20,  step: 0.1 },
      { key: "shipRestitution",    label: "Bounciness",             min: 0,   max: 1,   step: 0.01 },
    ],
  },
  {
    title: "Weapons",
    sliders: [
      { key: "bulletSpeed",   label: "Bullet speed (m/s)",  min: 10,  max: 120, step: 1    },
      { key: "bulletTtl",     label: "Bullet TTL (s)",      min: 0.2, max: 5,   step: 0.05 },
      { key: "fireCooldown",  label: "Fire cooldown (s)",   min: 0.02, max: 1,  step: 0.01 },
      { key: "shipMaxHealth", label: "Ship max HP",         min: 25,  max: 500, step: 5    },
      { key: "bulletDamage",  label: "Bullet damage",       min: 5,   max: 200, step: 1    },
    ],
  },
  {
    title: "Match",
    sliders: [
      { key: "respawnDelay",  label: "Respawn delay (s)",   min: 0.2, max: 5,   step: 0.1  },
      { key: "gameMode",      label: "Mode (0 = Deathmatch, 1 = Race)", min: 0, max: 1, step: 1 },
      { key: "raceTargetLaps", label: "Race: target laps",  min: 1, max: 10, step: 1 },
    ],
  },
  {
    title: "Effects",
    sliders: [
      { key: "killParticles",     label: "Kill particles",       min: 0,    max: 60,  step: 1     },
      { key: "killGlowRadius",    label: "Kill glow radius (m)", min: 0,    max: 8,   step: 0.1   },
      { key: "killShake",         label: "Kill shake",           min: 0,    max: 1,   step: 0.01  },
      { key: "trailLife",         label: "Trail life (s)",       min: 0.05, max: 3,   step: 0.05  },
      { key: "trailSize",         label: "Trail size",           min: 0.2,  max: 6,   step: 0.1   },
      { key: "trailDrag",         label: "Trail drag (closer to 1 = longer trail)", min: 0.9, max: 1.0, step: 0.001 },
      { key: "trailEmitsPerTick", label: "Trail particles/tick", min: 1,    max: 6,   step: 1     },
    ],
  },
  {
    title: "Camera",
    sliders: [
      { key: "cameraZoom",           label: "Zoom multiplier (1 = auto)", min: 0.3, max: 2.5, step: 0.05 },
      { key: "splitScreenAuto",      label: "Splitscreen auto (0/1)",     min: 0,   max: 1,   step: 1    },
      { key: "splitScreenThreshold", label: "Split when apart (m)",       min: 20,  max: 200, step: 5    },
    ],
  },
  {
    title: "Audio",
    sliders: [
      { key: "masterVolume", label: "Master volume", min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    title: "Power-ups",
    sliders: [
      { key: "powerupsEnabled", label: "Enabled (0 = off)",         min: 0, max: 1,  step: 1   },
      { key: "powerupSpawnSec", label: "Avg spawn interval (s)",    min: 2, max: 30, step: 0.5 },
      { key: "powerupsMax",     label: "Max simultaneous",          min: 1, max: 8,  step: 1   },
    ],
  },
  {
    title: "Visuals",
    sliders: [
      { key: "bulletTrail", label: "Bullet trail (0/1)", min: 0, max: 1, step: 1 },
      { key: "crtEnabled",  label: "CRT scanlines (0/1)", min: 0, max: 1, step: 1 },
    ],
  },
];

export class SettingsPanel {
  private root: HTMLElement;
  private body: HTMLElement;
  private toast!: HTMLElement;
  private valueLabels = new Map<keyof GameSettings, HTMLElement>();
  private inputs = new Map<keyof GameSettings, HTMLInputElement>();
  private open = false;
  private toastTimer: number | null = null;

  constructor() {
    this.root = document.createElement("div");
    this.root.id = "settings-panel";
    this.root.style.cssText = `
      position: fixed;
      top: 12px;
      right: 220px;
      z-index: 100;
      font-family: system-ui, -apple-system, sans-serif;
      color: #ddd;
      user-select: none;
    `;

    const toggle = document.createElement("button");
    toggle.textContent = "⚙ Settings";
    toggle.style.cssText = `
      background: rgba(0,0,0,0.6);
      border: 1px solid #3a3a48;
      color: #ddd;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 12px;
      cursor: pointer;
      letter-spacing: 0.5px;
    `;
    toggle.onclick = () => this.toggleOpen();
    this.root.appendChild(toggle);

    this.body = document.createElement("div");
    this.body.style.cssText = `
      display: none;
      margin-top: 8px;
      background: rgba(10, 10, 18, 0.94);
      border: 1px solid #25252e;
      border-radius: 8px;
      padding: 16px;
      width: 320px;
      max-height: 70vh;
      overflow-y: auto;
      font-size: 12px;
    `;
    this.root.appendChild(this.body);

    this.buildSections();

    // Row of action buttons — Save (with toast), Reset.
    const buttonRow = document.createElement("div");
    buttonRow.style.cssText = "display: flex; gap: 8px; margin-top: 14px;";

    const saveBtn = document.createElement("button");
    saveBtn.textContent = "💾 Save";
    saveBtn.style.cssText = `
      flex: 1;
      background: #2a4a78;
      color: #fff;
      border: 1px solid #4a78a8;
      padding: 8px;
      border-radius: 5px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
    `;
    saveBtn.onclick = () => {
      saveSettings();
      this.showToast("Saved ✓");
    };
    buttonRow.appendChild(saveBtn);

    const resetBtn = document.createElement("button");
    resetBtn.textContent = "Reset";
    resetBtn.style.cssText = `
      flex: 1;
      background: #1a1a22;
      color: #ddd;
      border: 1px solid #3a3a48;
      padding: 8px;
      border-radius: 5px;
      cursor: pointer;
      font-size: 12px;
    `;
    resetBtn.onclick = () => {
      if (!confirm("Reset all settings to defaults?")) return;
      resetSettings();
      this.refreshAll();
      this.showToast("Reset");
    };
    buttonRow.appendChild(resetBtn);

    this.body.appendChild(buttonRow);

    // Status row below the buttons — "Auto-saving" hint + storage indicator.
    const statusRow = document.createElement("div");
    statusRow.style.cssText =
      "margin-top: 10px; font-size: 11px; color: #888; text-align: center; line-height: 1.4;";
    const persisted = hasPersistedSettings();
    statusRow.innerHTML = persisted
      ? "Auto-saved to browser storage · changes persist across reloads"
      : "Auto-saved to browser storage on every change";
    this.body.appendChild(statusRow);

    // Floating "Saved ✓" toast slot.
    this.toast = document.createElement("div");
    this.toast.style.cssText = `
      position: fixed;
      top: 60px;
      right: 24px;
      background: #2a4a78;
      color: #fff;
      padding: 8px 16px;
      border-radius: 6px;
      font-family: system-ui, sans-serif;
      font-size: 13px;
      font-weight: 600;
      opacity: 0;
      transition: opacity 0.2s ease;
      pointer-events: none;
      z-index: 200;
    `;
    document.body.appendChild(this.toast);

    document.body.appendChild(this.root);
  }

  private toggleOpen() {
    this.open = !this.open;
    this.body.style.display = this.open ? "block" : "none";
  }

  private buildSections() {
    for (const section of SECTIONS) {
      const heading = document.createElement("div");
      heading.textContent = section.title;
      heading.style.cssText = `
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 1px;
        text-transform: uppercase;
        color: #6cc0ff;
        margin: 12px 0 6px 0;
      `;
      this.body.appendChild(heading);

      for (const s of section.sliders) {
        this.body.appendChild(this.buildSlider(s));
      }
    }
  }

  private buildSlider(s: Slider): HTMLElement {
    const row = document.createElement("div");
    row.style.cssText = "margin: 6px 0;";

    const labelRow = document.createElement("div");
    labelRow.style.cssText = "display: flex; justify-content: space-between; font-size: 11px; color: #aaa; margin-bottom: 2px;";

    const label = document.createElement("span");
    label.textContent = s.label;
    const value = document.createElement("span");
    value.style.cssText = "color: #fff; font-variant-numeric: tabular-nums;";
    value.textContent = this.format(SETTINGS[s.key]);
    this.valueLabels.set(s.key, value);

    labelRow.appendChild(label);
    labelRow.appendChild(value);
    row.appendChild(labelRow);

    const input = document.createElement("input");
    input.type = "range";
    input.min = String(s.min);
    input.max = String(s.max);
    input.step = String(s.step);
    input.value = String(SETTINGS[s.key]);
    input.style.cssText = "width: 100%; accent-color: #6cc0ff;";
    input.addEventListener("input", () => {
      const v = parseFloat(input.value);
      setSetting(s.key, v);
      value.textContent = this.format(v);
    });
    this.inputs.set(s.key, input);
    row.appendChild(input);

    return row;
  }

  private refreshAll() {
    for (const [key, input] of this.inputs) {
      input.value = String(SETTINGS[key]);
      const label = this.valueLabels.get(key);
      if (label) label.textContent = this.format(SETTINGS[key]);
    }
    void DEFAULT_SETTINGS;
  }

  private format(v: number): string {
    if (Math.abs(v) >= 10) return v.toFixed(1);
    if (Math.abs(v) >= 1) return v.toFixed(2);
    return v.toFixed(3);
  }

  private showToast(text: string) {
    this.toast.textContent = text;
    this.toast.style.opacity = "1";
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toast.style.opacity = "0";
      this.toastTimer = null;
    }, 1300);
  }
}
