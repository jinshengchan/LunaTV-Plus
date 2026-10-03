export interface SourceIdentity {
  source: string;
  id: string;
}

export interface SourceProbe<T> {
  ok: boolean;
  latency: number;
  detail?: T;
}

// Owned by the page wrapper so automatic source changes can remount the player
// without losing this episode's failed candidates or in-flight search.
export function createSourceFailoverSession<T extends SourceIdentity>() {
  return {
    sessionId: 0,
    revision: 0,
    episodeIndex: null as number | null,
    tried: new Set<string>(),
    probes: new Map<string, SourceProbe<T>>(),
    sources: [] as T[],
    pendingSources: null as Promise<T[]> | null,
  };
}

export type SourceFailoverSession<T extends SourceIdentity> = ReturnType<
  typeof createSourceFailoverSession<T>
>;

export function resetSourceFailoverSession<T extends SourceIdentity>(
  session: SourceFailoverSession<T>,
) {
  session.revision++;
  session.sessionId = 0;
  session.tried.clear();
  session.probes.clear();
}

export async function findNextPlayableSource<T extends SourceIdentity>(
  session: SourceFailoverSession<T>,
  probe: (source: T) => Promise<SourceProbe<T>>,
  isCurrent: () => boolean,
): Promise<{ s: T; latency: number } | null> {
  const revision = session.revision;
  const current = () => isCurrent() && session.revision === revision;
  // A slow background search must not be mistaken for exhausted candidates.
  const sources = session.pendingSources
    ? await session.pendingSources.catch(() => [])
    : session.sources;
  if (!current()) return null;

  for (const source of sources) {
    if (!current()) return null;
    const key = `${source.source}:${source.id}`;
    if (session.tried.has(key)) continue;
    session.tried.add(key);
    let result = session.probes.get(key);
    if (!result) {
      try {
        result = await probe(source);
      } catch {
        result = { ok: false, latency: 9999 };
      }
      if (!current()) return null;
      session.probes.set(key, result);
    }
    if (result.ok) return { s: result.detail || source, latency: result.latency };
  }
  return null;
}
