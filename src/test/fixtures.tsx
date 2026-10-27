import { render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { expect, vi } from 'vitest';
import type { DeviceStorage } from '../app/aiDevice';
import { AiLookProvider } from '../app/AiLooks';
import { ClosetProvider } from '../app/ClosetContext';
import { ItemAnalysisProvider } from '../app/ItemAnalysis';
import type { FetchLike } from '../ai/providers';
import { emptyCloset, type ClosetData } from '../core/model';
import type { ImageDeps } from '../image/processImage';
import { ClosetRepository } from '../storage/repository';
import { NOW, closetWith, makeItem, makeOutfit, memoryStorage, seededStore, testIds } from './data';

export * from './data';

/** Image helpers that "encode" any picked file to a two-byte WebP, without a canvas. */
export function fakeImageDeps(overrides: Partial<ImageDeps> = {}): ImageDeps {
  return {
    decode: vi.fn().mockResolvedValue({ width: 1000, height: 1000, release: vi.fn() }),
    draw: vi.fn().mockReturnValue({ imageData: {} as ImageData, toJpeg: vi.fn(), release: vi.fn() }),
    encodeWebp: vi.fn().mockResolvedValue(new Uint8Array([9, 9]).buffer),
    ...overrides,
  };
}

export interface RenderOptions {
  /** The phone's own storage (API keys, monthly use); a fresh in-memory one by default. */
  deviceStorage?: DeviceStorage;
  /** Answers provider calls and the bundled doll; by default every call fails as if offline. */
  fetchFn?: FetchLike;
  imageDeps?: ImageDeps;
  now?: () => Date;
  /** Whether the phone is online for the garment analysis queue; online by default. */
  isOnline?: () => boolean;
}

export async function renderWithCloset(ui: ReactElement, data: ClosetData = emptyCloset(), options: RenderOptions = {}) {
  const store = seededStore(data);
  const repo = new ClosetRepository(store, () => NOW, testIds());
  const deviceStorage = options.deviceStorage === undefined ? memoryStorage() : options.deviceStorage;
  const fetchFn = options.fetchFn ?? vi.fn<FetchLike>().mockRejectedValue(new TypeError('offline in tests'));
  const result = render(
    <ClosetProvider repo={repo} now={() => NOW} newId={testIds()}>
      <AiLookProvider deviceStorage={deviceStorage} imageDeps={options.imageDeps ?? fakeImageDeps()} fetchFn={fetchFn} now={options.now}>
        <ItemAnalysisProvider deviceStorage={deviceStorage} fetchFn={fetchFn} now={options.now} isOnline={options.isOnline}>
          {ui}
        </ItemAnalysisProvider>
      </AiLookProvider>
    </ClosetProvider>,
  );
  await waitFor(() => expect(screen.queryByText('טוען את הארון…')).not.toBeInTheDocument());
  return { ...result, repo, store, deviceStorage, fetchFn };
}

/** Standard sample closet used by screen tests. */
export function sampleCloset(): ClosetData {
  return closetWith(
    [
      makeItem({ id: 'tBlue', name: 'חולצה כחולה', type: 'tee', colorGroup: 'blue', occasions: ['school'] }),
      makeItem({ id: 'tWhite', name: 'חולצה לבנה', type: 'tee', colorGroup: 'white', occasions: ['school'] }),
      makeItem({ id: 'tLong', name: 'חולצה ארוכה אפורה', type: 'longTop', colorGroup: 'gray', occasions: ['school'] }),
      makeItem({ id: 'tParty', name: 'חולצה חגיגית', type: 'longTop', colorGroup: 'purple', occasions: ['party'] }),
      makeItem({ id: 'lSweater', name: 'סוודר צהוב', type: 'sweater', colorGroup: 'yellow', occasions: ['school', 'casual'] }),
      makeItem({ id: 'lJacket', name: 'עליונית שחורה', type: 'jacket', colorGroup: 'black', occasions: ['school'] }),
      makeItem({ id: 'bJeans', name: 'ג׳ינס', type: 'pants', colorGroup: 'blue', occasions: ['school', 'casual'] }),
      makeItem({ id: 'bShorts', name: 'שורטס', type: 'shorts', colorGroup: 'beige', occasions: ['school'] }),
      makeItem({ id: 'bParty', name: 'מכנסיים לבנים', type: 'pants', colorGroup: 'white', occasions: ['party'] }),
      makeItem({ id: 'old', name: 'חולצה ישנה', type: 'tee', colorGroup: 'pink', occasions: ['school'], status: 'outgrown' }),
    ],
    [makeOutfit({ id: 'o1', topId: 'tBlue', bottomId: 'bJeans', layerId: 'lSweater' })],
  );
}
