import { render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { expect } from 'vitest';
import { ClosetProvider } from '../app/ClosetContext';
import { emptyCloset, type ClosetData } from '../core/model';
import { ClosetRepository } from '../storage/repository';
import { NOW, closetWith, makeItem, makeOutfit, seededStore, testIds } from './data';

export * from './data';

export async function renderWithCloset(ui: ReactElement, data: ClosetData = emptyCloset()) {
  const store = seededStore(data);
  const repo = new ClosetRepository(store, () => NOW, testIds());
  const result = render(
    <ClosetProvider repo={repo} now={() => NOW} newId={testIds()}>
      {ui}
    </ClosetProvider>,
  );
  await waitFor(() => expect(screen.queryByText('טוען את הארון…')).not.toBeInTheDocument());
  return { ...result, repo, store };
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
