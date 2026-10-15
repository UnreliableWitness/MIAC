import type { SprintItem, SprintRow } from './types';

/** One entry of `workItemRelations` from the iteration work items API. */
export type SprintRelation = {
  rel: string | null;
  source: { id: number } | null;
  target: { id: number };
};

export const HIERARCHY_FORWARD = 'System.LinkTypes.Hierarchy-Forward';

/**
 * Turns the sprint's relations into grid rows in ADO's backlog order. The first entry for a work item wins;
 * a child follows its parent; a child whose parent is not in the sprint (or not readable) stays top level, in place.
 */
export function buildSprintTree(
  relations: SprintRelation[],
  items: SprintItem[],
): SprintRow[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const order: string[] = [];
  const parentOf = new Map<string, string | null>();
  for (const r of relations) {
    const id = String(r.target.id);
    if (parentOf.has(id) || !byId.has(id)) continue;
    order.push(id);
    parentOf.set(
      id,
      r.source && r.rel === HIERARCHY_FORWARD ? String(r.source.id) : null,
    );
  }
  /** A parent counts only when it is in the sprint and following it up never comes back to the child. */
  const parentIn = (id: string): string | null => {
    const parent = parentOf.get(id) ?? null;
    if (!parent || !parentOf.has(parent)) return null;
    const seen = new Set([id]);
    for (let p: string | null = parent; p; p = parentOf.get(p) ?? null) {
      if (seen.has(p)) return null;
      seen.add(p);
    }
    return parent;
  };
  const roots: string[] = [];
  const children = new Map<string, string[]>();
  for (const id of order) {
    const parent = parentIn(id);
    if (parent) children.set(parent, [...(children.get(parent) ?? []), id]);
    else roots.push(id);
  }
  const rows: SprintRow[] = [];
  const visit = (id: string, depth: number, parentId: string | null) => {
    const kids = children.get(id) ?? [];
    rows.push({
      item: byId.get(id)!,
      depth,
      parentId,
      hasChildren: kids.length > 0,
    });
    for (const k of kids) visit(k, depth + 1, id);
  };
  for (const id of roots) visit(id, 0, null);
  return rows;
}
