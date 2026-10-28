import { useState } from 'react';
import type { Outfit } from '../core/model';
import type { ImageDeps } from '../image/processImage';
import { AddItem } from '../ui/AddItem';
import { Closet } from '../ui/Closet';
import { Icon, Toast } from '../ui/common';
import { DressUp } from '../ui/DressUp';
import { Favorites } from '../ui/Favorites';
import { Parent } from '../ui/Parent';
import { Settings } from '../ui/Settings';
import type { FetchLike } from '../ai/providers';
import { browserDeviceStorage, type DeviceStorage } from './aiDevice';
import { AiLookProvider, useAiLooks, type LookOutfit } from './AiLooks';
import { ItemAnalysisProvider } from './ItemAnalysis';
import type { ShareEnv, StorageLike } from './device';
import { browserThemeEnv, useTheme, type ThemeEnv } from './theme';

export type Tab = 'dress' | 'favorites' | 'closet' | 'add' | 'parent';

const NAV: { tab: Exclude<Tab, 'parent'>; label: string; icon: string }[] = [
  { tab: 'dress', label: 'להתלבש', icon: 'shirt' },
  { tab: 'favorites', label: 'מועדפים', icon: 'heart' },
  { tab: 'closet', label: 'הארון שלי', icon: 'closet' },
  { tab: 'add', label: 'הוספה', icon: 'plus' },
];

export interface AppProps {
  imageDeps: ImageDeps;
  shareEnv: ShareEnv;
  storage?: StorageLike;
  today?: Date;
  themeEnv?: ThemeEnv;
  deviceStorage?: DeviceStorage;
  /** Only for tests: the provider calls, the bundled doll and the garment analyses. */
  fetchFn?: FetchLike;
}

export function App({ deviceStorage: givenStorage, fetchFn, ...props }: AppProps) {
  // The phone's own storage for the API key, this month's use and view choices; never in the closet or backups.
  const [deviceStorage] = useState<DeviceStorage>(() => (givenStorage === undefined ? browserDeviceStorage() : givenStorage));
  return (
    <AiLookProvider deviceStorage={deviceStorage} imageDeps={props.imageDeps} fetchFn={fetchFn}>
      <ItemAnalysisProvider deviceStorage={deviceStorage} fetchFn={fetchFn}>
        <Screens {...props} deviceStorage={deviceStorage} />
      </ItemAnalysisProvider>
    </AiLookProvider>
  );
}

function Screens({ imageDeps, shareEnv, storage, today, themeEnv, deviceStorage }: Omit<AppProps, 'fetchFn'>) {
  const [tab, setTab] = useState<Tab>('dress');
  const [env] = useState<ThemeEnv>(() => themeEnv ?? browserThemeEnv());
  const theme = useTheme(env);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Opening a favourite remounts the dress-up screen on that outfit's preview ("לראות את הלוק").
  const [opened, setOpened] = useState<{ outfit: Outfit | LookOutfit; preview: boolean; key: number } | null>(null);
  const ai = useAiLooks();

  const openOutfit = (outfit: Outfit | LookOutfit, preview = false) => {
    setOpened((prev) => ({ outfit, preview, key: (prev?.key ?? 0) + 1 }));
    setTab('dress');
  };

  return (
    <div className="app" dir="rtl">
      <main style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {tab === 'dress' && (
          <DressUp
            key={opened?.key ?? 0}
            initialOutfit={opened ? { id: '', createdAt: '', ...opened.outfit } : null}
            initialPreview={opened?.preview ?? false}
            today={today}
            onOpenFavorites={() => setTab('favorites')}
          />
        )}
        {tab === 'favorites' && <Favorites onOpen={(o) => openOutfit(o, true)} />}
        {tab === 'closet' && <Closet onOpenParent={() => setTab('parent')} onOpenSettings={() => setSettingsOpen(true)} imageDeps={imageDeps} />}
        {tab === 'add' && <AddItem imageDeps={imageDeps} onOpenCloset={() => setTab('closet')} />}
        {tab === 'parent' && (
          <Parent
            onBack={() => setTab('closet')}
            imageDeps={imageDeps}
            deviceStorage={deviceStorage}
            shareEnv={shareEnv}
            storage={storage}
          />
        )}
      </main>
      {ai.finished && (
        <div className="action-bar">
          <Toast
            text="הבובה מוכנה"
            actionLabel="לראות"
            onAction={() => {
              const outfit = ai.finished;
              ai.clearFinished();
              if (outfit) openOutfit(outfit, true);
            }}
          />
        </div>
      )}
      <nav className="tabbar" aria-label="ניווט ראשי">
        {NAV.map((n) => (
          <button
            key={n.tab}
            type="button"
            aria-current={tab === n.tab || (n.tab === 'closet' && tab === 'parent') ? 'page' : undefined}
            onClick={() => setTab(n.tab)}
          >
            <Icon name={n.icon} size={24} />
            {n.label}
          </button>
        ))}
      </nav>
      {settingsOpen && (
        <Settings theme={theme.choice} onThemeChange={theme.setChoice} onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}
