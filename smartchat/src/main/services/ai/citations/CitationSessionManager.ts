import { PrismaClient } from '@prisma/client';
import { CitationEntity, ICitationEmitter } from './ICitationEmitter';
import { ICitationSessionManager } from './ICitationSessionManager';
import { CitationEmitter } from './CitationEmitter';

export class CitationSessionManager implements ICitationSessionManager {
  constructor(private readonly prisma: PrismaClient) {}

  async createEmitter(sessionId: string): Promise<ICitationEmitter> {
    const maxCitation = await this.prisma.citation.aggregate({
      where: { sessionId },
      _max: { index: true }
    });
    const maxIndex = maxCitation._max.index ?? 0;
    return new CitationEmitter(maxIndex);
  }

  async persist(sessionId: string, citations: ReadonlyMap<number, CitationEntity>): Promise<void> {
    if (!citations || citations.size === 0) return;

    const dataToInsert = Array.from(citations.entries()).map(([index, entity]) => ({
      sessionId,
      index,
      type: entity.type,
      payload: JSON.stringify(entity)
    }));

    // Batch insert inside a transaction to ensure atomic saves
    await this.prisma.$transaction(async (tx) => {
      await tx.citation.createMany({
        data: dataToInsert
      });
    });
  }

  async resolve(sessionId: string, index: number): Promise<CitationEntity | null> {
    const citation = await this.prisma.citation.findUnique({
      where: {
        sessionId_index: {
          sessionId,
          index
        }
      }
    });

    if (!citation) return null;

    try {
      return JSON.parse(citation.payload) as CitationEntity;
    } catch (e) {
      console.error(`[CitationSessionManager] Failed to parse payload for citation ${index}`, e);
      return null;
    }
  }

  async resolveAll(sessionId: string): Promise<ReadonlyMap<number, CitationEntity>> {
    const citations = await this.prisma.citation.findMany({
      where: { sessionId },
      orderBy: { index: 'asc' }
    });

    const map = new Map<number, CitationEntity>();
    for (const c of citations) {
      try {
        const entity = JSON.parse(c.payload) as CitationEntity;
        map.set(c.index, entity);
      } catch (e) {
        console.error(`[CitationSessionManager] Failed to parse payload for citation ${c.index}`, e);
      }
    }

    return map;
  }
}
