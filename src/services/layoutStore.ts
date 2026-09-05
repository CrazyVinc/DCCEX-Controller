import EventEmitter from 'node:events';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildLayoutIndex, type LayoutIndex } from '../../shared/src/layout/index.ts';
import { normalizeLayout } from '../../shared/src/layout/ops.ts';
import { emptyLayout, LayoutDocumentSchema, type LayoutDocument } from '../../shared/src/layout/schema.ts';
import { isV1Layout, migrateLayoutV1ToV3 } from '../migrations/layoutV1ToV3.ts';
import { DATA_DIR, LAYOUT_FILE } from '../paths.ts';

export interface LayoutStoreEvents {
  updated: [LayoutDocument];
}

/**
 * Single source of the layout document on the server. Keeps the parsed document and
 * its resolved index in memory; every save is validated, normalised and persisted.
 */
export class LayoutStore extends EventEmitter<LayoutStoreEvents> {
  private doc: LayoutDocument = emptyLayout();
  private index: LayoutIndex = buildLayoutIndex(this.doc);

  async load(): Promise<void> {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(LAYOUT_FILE, 'utf-8'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.setDoc(emptyLayout());
        return;
      }
      throw err;
    }

    if (isV1Layout(raw)) {
      const { doc, report } = migrateLayoutV1ToV3(raw);
      await copyFile(LAYOUT_FILE, path.join(DATA_DIR, 'layout.v1.backup.json'));
      await this.persist(doc);
      const badGaps = report.gaps.filter((g) => g.gapMm > 0.5 || g.gapDeg > 0.3);
      console.log(
        `[layout] migrated v1 → v3: ${report.pieces} pieces, ${report.joints} joints inferred, ` +
          `${badGaps.length} joint(s) with a mismatch > tolerance` +
          (report.skippedPieces.length ? `, skipped: ${report.skippedPieces.join(', ')}` : ''),
      );
      this.setDoc(doc);
      return;
    }

    this.setDoc(normalizeLayout(LayoutDocumentSchema.parse(raw)));
  }

  getLayout(): LayoutDocument {
    return this.doc;
  }

  getIndex(): LayoutIndex {
    return this.index;
  }

  async save(input: unknown): Promise<LayoutDocument> {
    const doc = normalizeLayout({ ...LayoutDocumentSchema.parse(input), updatedAt: new Date().toISOString() });
    await this.persist(doc);
    this.setDoc(doc);
    this.emit('updated', doc);
    return doc;
  }

  private setDoc(doc: LayoutDocument): void {
    this.doc = doc;
    this.index = buildLayoutIndex(doc);
  }

  private async persist(doc: LayoutDocument): Promise<void> {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(LAYOUT_FILE, JSON.stringify(doc, null, 2), 'utf-8');
  }
}
