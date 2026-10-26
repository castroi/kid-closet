import { useState } from 'react';
import type { Outfit } from '../core/model';
import type { ImageDeps } from '../image/processImage';
import { AddItem } from '../ui/AddItem';
import { Closet } from '../ui/Closet';
import { Icon } from '../ui/common';
import { DressUp } from '../ui/DressUp';
import { Favorites } from '../ui/Favorites';
import { Parent } from '../ui/Parent';
import { Settings } from '../ui/Settings';
import type { DeviceStorage } from './aiDevice';
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
}

export function App({ imageDeps, shareEnv, storage, today, themeEnv, deviceStorage }: AppProps) {
  const [tab, setTab] = useState<Tab>('dress');
  const [env] = useState<ThemeEnv>(() => themeEnv ?? browserThemeEnv());
  const theme = useTheme(env);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Opening a favourite remounts the dress-up screen with that outfit selected.
  const [opened, setOpened] = useState<{ outfit: Outfit; key: number } | null>(null);

  const openOutfit = (outfit: Outfit) => {
    setOpened((prev) => ({ outfit, key: (prev?.key ?? 0) + 1 }));
    setTab('dress');
  };

  return (
    <div className="app" dir="rtl">
      <main style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {tab === 'dress' && (
          <DressUp
            key={opened?.key ?? 0}
            initialOutfit={opened?.outfit ?? null}
            today={today}
            onOpenFavorites={() => setTab('favorites')}
          />
        )}
        {tab === 'favorites' && <Favorites onOpen={openOutfit} />}
        {tab === 'closet' && <Closet onOpenParent={() => setTab('parent')} onOpenSettings={() => setSettingsOpen(true)} />}
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
