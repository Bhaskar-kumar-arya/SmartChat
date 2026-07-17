import { CitationEntity, ICitationEmitter } from './ICitationEmitter';

export class CitationEmitter implements ICitationEmitter {
  private currentIndex: number;
  private readonly citations = new Map<number, CitationEntity>();

  constructor(startOffset: number) {
    this.currentIndex = startOffset;
  }

  register(entity: CitationEntity): number {
    this.currentIndex += 1;
    this.citations.set(this.currentIndex, entity);
    return this.currentIndex;
  }

  getEntries(): ReadonlyMap<number, CitationEntity> {
    return this.citations;
  }
}
