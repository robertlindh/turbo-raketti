// Sidebar wiring — binds the HTML controls in editor.html to the Editor
// instance. Pure DOM, no Pixi. Re-syncs on every `editor.onChange`.

import type { Editor } from "./Editor";
import { cloneLevel } from "./Editor";
import { LEVELS } from "../level/levels";
import { exportLevelAsTypeScript } from "./exporter";
import { THEME_PRESETS } from "./themes";

export function mountSidebars(editor: Editor): void {
  buildToolbar(editor);
  buildLayerToggles();
  bindLevelMeta(editor);
  bindThemeUi(editor);
  bindBoundsUi(editor);
  bindImportExport(editor);
  bindPlayTest(editor);
  bindSnap(editor);
  bindResetCamera(editor);

  editor.onChange(() => syncAllUi(editor));
  syncAllUi(editor);
}

function syncAllUi(editor: Editor): void {
  const nameInput = document.getElementById("level-name") as HTMLInputElement;
  const idInput = document.getElementById("level-id") as HTMLInputElement;
  if (nameInput && document.activeElement !== nameInput) {
    nameInput.value = editor.level.name;
  }
  if (idInput && document.activeElement !== idInput) {
    idInput.value = slugify(editor.level.name);
  }
  syncThemeUi(editor);
  syncBoundsUi(editor);
}

function buildToolbar(editor: Editor): void {
  const host = document.getElementById("tools");
  if (!host) return;
  host.innerHTML = "";
  for (const tool of editor.tools.tools) {
    const btn = document.createElement("button");
    btn.className = "tool-btn";
    btn.dataset.toolId = tool.id;
    btn.innerHTML = `<span style="opacity:.6;margin-right:6px">${tool.hotkey}</span>${tool.label}`;
    btn.addEventListener("click", () => editor.tools.setActive(tool));
    host.appendChild(btn);
  }
  // Trigger initial active state.
  editor.tools.setActive(editor.tools.activeTool ?? editor.tools.tools[0]);
}

function buildLayerToggles(): void {
  // Layers all visible by default; a placeholder for future toggles.
  const host = document.getElementById("layer-toggles");
  if (!host) return;
  host.innerHTML = `<p class="hint" style="margin:0">Allt synligt. (Toggles kommer senare om vi behöver.)</p>`;
}

function bindLevelMeta(editor: Editor): void {
  const nameInput = document.getElementById("level-name") as HTMLInputElement | null;
  if (nameInput) {
    nameInput.addEventListener("input", () => {
      editor.mutate((lvl) => { lvl.name = nameInput.value; lvl.theme.name = nameInput.value; });
    });
  }
  // ID field is derived from name on export; show it but read-only-ish.
  const idInput = document.getElementById("level-id") as HTMLInputElement | null;
  if (idInput) {
    idInput.addEventListener("change", () => {
      idInput.value = slugify(idInput.value || editor.level.name);
    });
  }
}

function bindThemeUi(editor: Editor): void {
  const preset = document.getElementById("theme-preset") as HTMLSelectElement | null;
  if (preset) {
    preset.innerHTML = "";
    const optCustom = document.createElement("option");
    optCustom.value = "__custom";
    optCustom.textContent = "(anpassad)";
    preset.appendChild(optCustom);
    for (const [name] of Object.entries(THEME_PRESETS)) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      preset.appendChild(opt);
    }
    preset.addEventListener("change", () => {
      const sel = preset.value;
      if (sel in THEME_PRESETS) {
        editor.mutate((lvl) => {
          lvl.theme = { ...THEME_PRESETS[sel], name: lvl.theme.name };
        });
      }
    });
  }

  // Color inputs — one per theme palette key.
  const host = document.getElementById("theme-colors");
  if (host) {
    host.innerHTML = "";
    const themeKeys: Array<keyof Editor["level"]["theme"]> = [
      "skyTop", "skyBottom", "nebula", "starColor",
      "rockDeepest", "rockDark", "rockMid", "rockLight", "rockRim",
      "accent",
    ];
    for (const key of themeKeys) {
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `<label>${key}</label>`;
      const input = document.createElement("input");
      input.type = "color";
      input.dataset.themeKey = String(key);
      input.value = editor.level.theme[key] as string;
      input.addEventListener("input", () => {
        editor.mutate((lvl) => {
          (lvl.theme as unknown as Record<string, string>)[String(key)] = input.value;
        });
      });
      row.appendChild(input);
      const hex = document.createElement("input");
      hex.type = "text";
      hex.value = editor.level.theme[key] as string;
      hex.style.width = "82px";
      hex.addEventListener("change", () => {
        if (!/^#[0-9a-fA-F]{6}$/.test(hex.value)) return;
        editor.mutate((lvl) => {
          (lvl.theme as unknown as Record<string, string>)[String(key)] = hex.value;
        });
        input.value = hex.value;
      });
      row.appendChild(hex);
      host.appendChild(row);
    }
  }
}

function syncThemeUi(editor: Editor): void {
  const host = document.getElementById("theme-colors");
  if (!host) return;
  host.querySelectorAll<HTMLInputElement>("input[type=color]").forEach((inp) => {
    const key = inp.dataset.themeKey;
    if (!key) return;
    const v = (editor.level.theme as unknown as Record<string, string>)[key];
    if (v && inp.value !== v) inp.value = v;
    const hex = inp.nextElementSibling as HTMLInputElement | null;
    if (hex && hex.type === "text" && hex.value !== v) hex.value = v;
  });
}

function bindBoundsUi(editor: Editor): void {
  const host = document.getElementById("bounds-fields");
  if (!host) return;
  host.innerHTML = "";
  for (const key of ["minX", "maxX", "minY", "maxY"] as const) {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<label>${key}</label>`;
    const input = document.createElement("input");
    input.type = "number";
    input.step = "4";
    input.dataset.boundsKey = key;
    input.value = String(editor.level.bounds[key]);
    input.addEventListener("change", () => {
      const v = parseInt(input.value, 10);
      if (Number.isNaN(v)) return;
      editor.mutate((lvl) => {
        lvl.bounds[key] = v;
      });
      // Bounds affect the grid — re-render.
      editor.replaceLevel(editor.level);
    });
    row.appendChild(input);
    host.appendChild(row);
  }
  const fitBtn = document.getElementById("fit-bounds");
  fitBtn?.addEventListener("click", () => {
    const lvl = editor.level;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const consider = (pts: { x: number; y: number }[]) => {
      for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
    };
    consider(lvl.boundary);
    for (const o of lvl.obstacles) consider(o);
    if (!Number.isFinite(minX)) return;
    const padX = (maxX - minX) * 0.08 + 4;
    const padY = (maxY - minY) * 0.08 + 4;
    editor.mutate((lvl) => {
      lvl.bounds = {
        minX: Math.floor(minX - padX),
        maxX: Math.ceil(maxX + padX),
        minY: Math.floor(minY - padY),
        maxY: Math.ceil(maxY + padY),
      };
    });
    editor.replaceLevel(editor.level);
  });
}

function syncBoundsUi(editor: Editor): void {
  const host = document.getElementById("bounds-fields");
  if (!host) return;
  host.querySelectorAll<HTMLInputElement>("input[data-bounds-key]").forEach((inp) => {
    const key = inp.dataset.boundsKey as "minX" | "maxX" | "minY" | "maxY";
    const v = String(editor.level.bounds[key]);
    if (inp.value !== v && document.activeElement !== inp) inp.value = v;
  });
}

function bindImportExport(editor: Editor): void {
  const sel = document.getElementById("import-preset") as HTMLSelectElement | null;
  if (sel) {
    for (const entry of LEVELS) {
      const opt = document.createElement("option");
      opt.value = entry.id;
      opt.textContent = entry.level.name;
      sel.appendChild(opt);
    }
  }
  document.getElementById("load-preset")?.addEventListener("click", () => {
    if (!sel || !sel.value) return;
    const entry = LEVELS.find((e) => e.id === sel.value);
    if (!entry) return;
    if (!confirm(`Ladda "${entry.level.name}" — nuvarande bana ersätts. Fortsätta?`)) return;
    editor.replaceLevel(cloneLevel(entry.level));
  });

  const exportBtn = document.getElementById("export-ts");
  const exportOut = document.getElementById("export-output") as HTMLTextAreaElement | null;
  const idInput = document.getElementById("level-id") as HTMLInputElement | null;
  exportBtn?.addEventListener("click", () => {
    if (!exportOut) return;
    const id = idInput?.value || slugify(editor.level.name);
    exportOut.value = exportLevelAsTypeScript(editor.level, id);
  });
  document.getElementById("copy-export")?.addEventListener("click", () => {
    if (!exportOut) return;
    exportOut.select();
    navigator.clipboard?.writeText(exportOut.value);
  });
}

function bindPlayTest(editor: Editor): void {
  document.getElementById("play-test")?.addEventListener("click", () => {
    // Draft is autosaved on every mutation, but force one more save now.
    localStorage.setItem("tr.editor.draft", JSON.stringify(editor.level));
    // Use Vite's BASE_URL so the test-play link works both locally ("/")
    // and on GitHub Pages ("/turbo-raketti/").
    window.open(`${import.meta.env.BASE_URL}#__draft`, "_blank");
  });
}

function bindSnap(editor: Editor): void {
  const sel = document.getElementById("snap-step") as HTMLSelectElement | null;
  if (!sel) return;
  sel.value = String(editor.snapStep);
  sel.addEventListener("change", () => {
    editor.snapStep = parseInt(sel.value, 10) || 0;
    editor.updateStatus();
  });
}

function bindResetCamera(editor: Editor): void {
  document.getElementById("reset-camera")?.addEventListener("click", () => {
    editor.camera.resetToLevel();
  });
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
