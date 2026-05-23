import { App } from "./app/App";

async function bootstrap() {
  const app = new App();
  await app.start();

  // Expose for quick console poking during development.
  (window as unknown as { app: App }).app = app;
}

bootstrap().catch((err) => {
  console.error("Failed to start app:", err);
});
