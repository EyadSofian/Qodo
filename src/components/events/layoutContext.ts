/**
 * Where each course sits in the saved schedule layout, for components far
 * from the board — the details drawer shows Department › Package › Level
 * without every caller threading the layout through.
 */

import { createContext, useContext } from 'react';
import type { Placement } from '../../lib/eventsLayout';

export const PlacementContext = createContext<Map<number, Placement>>(new Map());

export function usePlacement(id: number | null): Placement | null {
  const index = useContext(PlacementContext);
  return id === null ? null : index.get(id) ?? null;
}
