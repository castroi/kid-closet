import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { ClosetProvider } from './app/ClosetContext';
import { browserShareEnv, requestPersistence } from './app/device';
import { browserImageDeps } from './image/browserImage';
import { registerServiceWorker } from './pwa';
import { OpfsFileStore, createWorkerWriter, type DirHandleLike } from './storage/opfsStore';
import { ClosetRepository } from './storage/repository';
import { RecoveryScreen } from './ui/RecoveryScreen';
import './styles.css';

function start() {
  const root = createRoot(document.getElementById('root')!);

  if (!navigator.storage?.getDirectory) {
    root.render(
      <div className="center-message" dir="rtl">
        <h1>הדפדפן לא נתמך</h1>
        <p className="muted">צריך iPhone עם iOS 15.2 ומעלה, ולפתוח את האפליקציה מ־Safari.</p>
      </div>,
    );
    return;
  }

  const workerWrite = createWorkerWriter(
    () => new Worker(new URL('./storage/opfs.worker.ts', import.meta.url), { type: 'module' }),
  );
  const store = new OpfsFileStore(() => navigator.storage.getDirectory() as unknown as Promise<DirHandleLike>, workerWrite);
  const repo = new ClosetRepository(store);

  void requestPersistence(navigator.storage);
  registerServiceWorker();

  root.render(
    <StrictMode>
      <ClosetProvider repo={repo} renderError={(error, restore) => <RecoveryScreen error={error} onRestore={restore} />}>
        <App imageDeps={browserImageDeps} shareEnv={browserShareEnv()} storage={navigator.storage} />
      </ClosetProvider>
    </StrictMode>,
  );
}

start();
