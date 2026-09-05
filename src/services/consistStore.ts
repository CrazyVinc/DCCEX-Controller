import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ConsistSchema, type Consist, type ConsistInput } from '../../shared/src/domain/train.ts';
import { newId } from '../../shared/src/util/id.ts';
import { CONSISTS_DIR } from '../paths.ts';
import type { RollingStockService } from './rollingStock.ts';

/** Consists (operated trains) persisted as `data/consists/<id>.json`. */
export class ConsistStore {
  private consists = new Map<string, Consist>();
  private readonly rollingStock: RollingStockService;

  constructor(rollingStock: RollingStockService) {
    this.rollingStock = rollingStock;
  }

  async load(): Promise<void> {
    await mkdir(CONSISTS_DIR, { recursive: true });
    for (const file of await readdir(CONSISTS_DIR)) {
      if (!file.endsWith('.json')) continue;
      const consist = ConsistSchema.parse(JSON.parse(await readFile(path.join(CONSISTS_DIR, file), 'utf-8')));
      this.consists.set(consist.id, consist);
    }
  }

  list(): Consist[] {
    return [...this.consists.values()];
  }

  get(id: string): Consist | undefined {
    return this.consists.get(id);
  }

  require(id: string): Consist {
    const c = this.consists.get(id);
    if (!c) throw new Error(`Consist ${id} not found`);
    return c;
  }

  async create(input: ConsistInput): Promise<Consist> {
    const consist = ConsistSchema.parse({ ...input, id: newId('cs') });
    this.validateUnits(consist);
    await this.persist(consist);
    this.consists.set(consist.id, consist);
    return consist;
  }

  async update(id: string, input: ConsistInput): Promise<Consist> {
    this.require(id);
    const consist = ConsistSchema.parse({ ...input, id });
    this.validateUnits(consist);
    await this.persist(consist);
    this.consists.set(id, consist);
    return consist;
  }

  async remove(id: string): Promise<void> {
    this.require(id);
    await rm(path.join(CONSISTS_DIR, `${id}.json`), { force: true });
    this.consists.delete(id);
  }

  /** Total length: unit lengths from the roster plus one coupling gap per coupling. */
  totalLengthMm(consist: Consist): number {
    let total = 0;
    for (const unit of consist.units) {
      if (unit.kind === 'loco') {
        total += this.rollingStock.getTrainById(unit.dccId)?.Length ?? 0;
      } else {
        total += this.rollingStock.getWagonById(unit.wagonId)?.Length ?? 0;
      }
    }
    return total + Math.max(0, consist.units.length - 1) * consist.couplingGapMm;
  }

  /** DCC addresses of all locomotives in the consist, with their orientation. */
  locos(consist: Consist): { dccId: string; orientation: 'forward' | 'reverse' }[] {
    return consist.units.filter((u): u is Extract<typeof u, { kind: 'loco' }> => u.kind === 'loco').map((u) => ({ dccId: u.dccId, orientation: u.orientation }));
  }

  private validateUnits(consist: Consist): void {
    for (const unit of consist.units) {
      if (unit.kind === 'loco' && !this.rollingStock.getTrainById(unit.dccId)) {
        throw new Error(`Locomotive ${unit.dccId} is not in the roster`);
      }
      if (unit.kind === 'wagon' && !this.rollingStock.getWagonById(unit.wagonId)) {
        throw new Error(`Wagon ${unit.wagonId} does not exist`);
      }
    }
  }

  private async persist(consist: Consist): Promise<void> {
    await mkdir(CONSISTS_DIR, { recursive: true });
    await writeFile(path.join(CONSISTS_DIR, `${consist.id}.json`), JSON.stringify(consist, null, 2), 'utf-8');
  }
}
