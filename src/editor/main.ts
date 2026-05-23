/// <reference types="vite/client" />
import { Editor } from "./Editor";

// HMR can leave the singleton Editor in an inconsistent state because Pixi
// owns a canvas the previous instance attached. Accept a full reload on
// changes to any module under this tree.
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    location.reload();
  });
}

async function bootstrap() {
  const mount = document.getElementById("canvas-mount");
  if (!mount) throw new Error("#canvas-mount not found");

  const editor = new Editor(mount);
  await editor.init();

  (window as unknown as { editor: Editor }).editor = editor;
}

bootstrap().catch((err) => {
  console.error("Failed to start editor:", err);
});
