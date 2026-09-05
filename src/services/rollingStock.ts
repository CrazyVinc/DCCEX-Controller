import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  TrainInfoSchema,
  WagonInfoSchema,
  type TrainInfo,
  type WagonInfo,
} from '../../shared/src/schemas/rollingStock.ts';
import { TRAINS_DIR, WAGONS_DIR } from '../paths.ts';

interface UploadedFile {
  originalname: string;
  buffer: Buffer;
}

export interface ImageEntry {
  name: string;
  order: number;
  url: string;
}

interface ImageOwner {
  imageorder: { name: string }[];
}

const IMAGE_RE = /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i;

/** Partial update for a roster entry; `Speed.limit` is managed separately via `setTrainSpeedLimit`. */
export type TrainUpdate = Partial<Omit<TrainInfo, 'DCC_ID' | 'imageorder' | 'Speed'>> & {
  Speed?: Partial<TrainInfo['Speed']>;
};

/**
 * Locomotive roster + wagon list, persisted as `info.json` per entity under `data/rollingstock/`.
 * The initial read happens once at process start (synchronous is acceptable there).
 */
export class RollingStockService {
  trains: TrainInfo[];
  wagons: WagonInfo[];

  constructor() {
    this.trains = fs
      .readdirSync(TRAINS_DIR)
      .map((dir) => TrainInfoSchema.parse(JSON.parse(fs.readFileSync(path.join(TRAINS_DIR, dir, 'info.json'), 'utf-8'))));
    this.wagons = fs
      .readdirSync(WAGONS_DIR)
      .map((dir) => WagonInfoSchema.parse(JSON.parse(fs.readFileSync(path.join(WAGONS_DIR, dir, 'info.json'), 'utf-8'))));
  }

  getRollingStock(): { trains: TrainInfo[]; wagons: WagonInfo[] } {
    return { trains: this.trains, wagons: this.wagons };
  }

  getTrainById(DCC_ID: string | number): TrainInfo | undefined {
    return this.trains.find((train) => String(train.DCC_ID) === String(DCC_ID));
  }

  getWagonById(wagonId: string): WagonInfo | undefined {
    return this.wagons.find((wagon) => String(wagon.id) === String(wagonId));
  }

  private trainDir(DCC_ID: string | number): string {
    return path.join(TRAINS_DIR, String(DCC_ID));
  }

  private wagonDir(wagonId: string): string {
    return path.join(WAGONS_DIR, wagonId);
  }

  private async persistTrain(train: TrainInfo): Promise<void> {
    await mkdir(this.trainDir(train.DCC_ID), { recursive: true });
    await writeFile(path.join(this.trainDir(train.DCC_ID), 'info.json'), JSON.stringify(train, null, 2), 'utf-8');
  }

  private async persistWagon(wagon: WagonInfo): Promise<void> {
    await mkdir(this.wagonDir(wagon.id), { recursive: true });
    await writeFile(path.join(this.wagonDir(wagon.id), 'info.json'), JSON.stringify(wagon, null, 2), 'utf-8');
  }

  /** Create or replace a locomotive. */
  async addTrain(input: Omit<TrainInfo, 'imageorder'>): Promise<TrainInfo> {
    const existing = this.getTrainById(input.DCC_ID);
    const train: TrainInfo = { ...input, imageorder: existing?.imageorder ?? [] };
    await this.persistTrain(train);
    const idx = this.trains.findIndex((t) => t.DCC_ID === train.DCC_ID);
    if (idx !== -1) {
      this.trains[idx] = train;
    } else {
      this.trains.push(train);
    }
    return train;
  }

  async setTrainSpeedLimit(DCC_ID: string, speedLimit: number): Promise<TrainInfo> {
    const train = this.requireTrain(DCC_ID);
    const next: TrainInfo = { ...train, Speed: { ...train.Speed, limit: speedLimit } };
    await this.persistTrain(next);
    this.replaceTrain(next);
    return next;
  }

  async updateTrain(DCC_ID: string, updates: TrainUpdate): Promise<TrainInfo> {
    const current = this.requireTrain(DCC_ID);
    const next: TrainInfo = {
      ...current,
      ...updates,
      DCC_ID: current.DCC_ID,
      imageorder: current.imageorder,
      Speed: { ...current.Speed, ...(updates.Speed ?? {}), limit: current.Speed.limit },
    };
    await this.persistTrain(next);
    this.replaceTrain(next);
    return next;
  }

  async removeTrain(DCC_ID: string): Promise<void> {
    this.requireTrain(DCC_ID);
    await rm(this.trainDir(DCC_ID), { recursive: true, force: true });
    this.trains = this.trains.filter((train) => String(train.DCC_ID) !== String(DCC_ID));
  }

  private requireTrain(DCC_ID: string | number): TrainInfo {
    const train = this.getTrainById(DCC_ID);
    if (!train) {
      throw new Error(`Train with DCC_ID ${DCC_ID} not found`);
    }
    return train;
  }

  private requireWagon(wagonId: string): WagonInfo {
    const wagon = this.getWagonById(wagonId);
    if (!wagon) {
      throw new Error(`Wagon ${wagonId} not found`);
    }
    return wagon;
  }

  private replaceTrain(train: TrainInfo): void {
    const idx = this.trains.findIndex((t) => String(t.DCC_ID) === String(train.DCC_ID));
    this.trains[idx] = train;
  }

  private replaceWagon(wagon: WagonInfo): void {
    const idx = this.wagons.findIndex((w) => w.id === wagon.id);
    this.wagons[idx] = wagon;
  }

  /* ---------------- images (shared between trains and wagons) ---------------- */

  private sortByOrder(imageNames: string[], orderedNames: string[]): string[] {
    const orderIndex = new Map(orderedNames.map((name, index) => [name, index]));
    const inOrder = imageNames
      .filter((name) => orderIndex.has(name))
      .sort((a, b) => orderIndex.get(a)! - orderIndex.get(b)!);
    const unordered = imageNames.filter((name) => !orderIndex.has(name)).sort((a, b) => a.localeCompare(b));
    return [...inOrder, ...unordered];
  }

  private async listImages(owner: ImageOwner, dir: string, baseUrl: string): Promise<ImageEntry[]> {
    await mkdir(dir, { recursive: true });
    const files = await readdir(dir);
    const names = this.sortByOrder(
      files.filter((name) => IMAGE_RE.test(name)),
      owner.imageorder.map((e) => e.name),
    );
    owner.imageorder = names.map((name) => ({ name }));
    return names.map((name, index) => ({ name, order: index + 1, url: `${baseUrl}/${name}` }));
  }

  private async addImage(owner: ImageOwner, dir: string, baseUrl: string, file: UploadedFile | undefined): Promise<ImageEntry[]> {
    if (!file) {
      throw new Error('Image file is required');
    }
    const current = await this.listImages(owner, dir, baseUrl);
    const ext = ensureImageExtension(path.extname(file.originalname));
    const nextName = `image-${current.length + 1}${ext}`;
    await writeFile(path.join(dir, nextName), file.buffer);
    owner.imageorder = [...current.map((i) => ({ name: i.name })), { name: nextName }];
    return this.listImages(owner, dir, baseUrl);
  }

  private async reorderImages(owner: ImageOwner, dir: string, baseUrl: string, orderedNames: string[]): Promise<ImageEntry[]> {
    const existing = (await this.listImages(owner, dir, baseUrl)).map((i) => i.name);
    if (existing.length !== orderedNames.length || !existing.every((name) => orderedNames.includes(name))) {
      throw new Error('Image reorder payload must include exactly the existing image names');
    }
    owner.imageorder = orderedNames.map((name) => ({ name }));
    return this.listImages(owner, dir, baseUrl);
  }

  private async renameImage(owner: ImageOwner, dir: string, baseUrl: string, oldName: string, newName: string): Promise<ImageEntry[]> {
    const existing = (await this.listImages(owner, dir, baseUrl)).map((i) => i.name);
    if (!existing.includes(oldName)) {
      throw new Error('Image file not found');
    }
    const safeBaseName = String(newName).trim().replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
    if (!safeBaseName) {
      throw new Error('newName cannot be empty');
    }
    const finalName = `${safeBaseName}${ensureImageExtension(path.extname(oldName))}`;
    if (existing.includes(finalName) && finalName !== oldName) {
      throw new Error('Image name already exists');
    }
    await rename(path.join(dir, oldName), path.join(dir, finalName));
    owner.imageorder = existing.map((name) => ({ name: name === oldName ? finalName : name }));
    return this.listImages(owner, dir, baseUrl);
  }

  private async removeImage(owner: ImageOwner, dir: string, baseUrl: string, imageName: string): Promise<ImageEntry[]> {
    await unlink(path.join(dir, imageName));
    return this.listImages(owner, dir, baseUrl);
  }

  /* ---------------- train images ---------------- */

  async listTrainImages(DCC_ID: string): Promise<ImageEntry[]> {
    const train = this.requireTrain(DCC_ID);
    const images = await this.listImages(train, this.trainDir(DCC_ID), `/rollingstock-images/trains/${DCC_ID}`);
    await this.persistTrain(train);
    return images;
  }

  async addTrainImage(DCC_ID: string, file: UploadedFile | undefined): Promise<ImageEntry[]> {
    const train = this.requireTrain(DCC_ID);
    const images = await this.addImage(train, this.trainDir(DCC_ID), `/rollingstock-images/trains/${DCC_ID}`, file);
    await this.persistTrain(train);
    return images;
  }

  async reorderTrainImages(DCC_ID: string, orderedNames: string[]): Promise<ImageEntry[]> {
    const train = this.requireTrain(DCC_ID);
    const images = await this.reorderImages(train, this.trainDir(DCC_ID), `/rollingstock-images/trains/${DCC_ID}`, orderedNames);
    await this.persistTrain(train);
    return images;
  }

  async renameTrainImage(DCC_ID: string, oldName: string, newName: string): Promise<ImageEntry[]> {
    const train = this.requireTrain(DCC_ID);
    const images = await this.renameImage(train, this.trainDir(DCC_ID), `/rollingstock-images/trains/${DCC_ID}`, oldName, newName);
    await this.persistTrain(train);
    return images;
  }

  async removeTrainImage(DCC_ID: string, imageName: string): Promise<ImageEntry[]> {
    const train = this.requireTrain(DCC_ID);
    const images = await this.removeImage(train, this.trainDir(DCC_ID), `/rollingstock-images/trains/${DCC_ID}`, imageName);
    await this.persistTrain(train);
    return images;
  }

  /* ---------------- wagons ---------------- */

  async addWagon(Name: string, Length: number, serviceClass: WagonInfo['serviceClass'] = 'other'): Promise<WagonInfo> {
    const wagon: WagonInfo = { id: randomUUID(), Name, Length, serviceClass, imageorder: [] };
    await this.persistWagon(wagon);
    this.wagons.push(wagon);
    return wagon;
  }

  async updateWagon(wagonId: string, updates: Partial<Omit<WagonInfo, 'id' | 'imageorder'>>): Promise<WagonInfo> {
    const current = this.requireWagon(wagonId);
    const next: WagonInfo = { ...current, ...updates, id: current.id, imageorder: current.imageorder };
    await this.persistWagon(next);
    this.replaceWagon(next);
    return next;
  }

  async removeWagon(wagonId: string): Promise<void> {
    this.requireWagon(wagonId);
    await rm(this.wagonDir(wagonId), { recursive: true, force: true });
    this.wagons = this.wagons.filter((w) => w.id !== wagonId);
  }

  async listWagonImages(wagonId: string): Promise<ImageEntry[]> {
    const wagon = this.requireWagon(wagonId);
    const images = await this.listImages(wagon, this.wagonDir(wagonId), `/rollingstock-images/wagons/${wagonId}`);
    await this.persistWagon(wagon);
    return images;
  }

  async addWagonImage(wagonId: string, file: UploadedFile | undefined): Promise<ImageEntry[]> {
    const wagon = this.requireWagon(wagonId);
    const images = await this.addImage(wagon, this.wagonDir(wagonId), `/rollingstock-images/wagons/${wagonId}`, file);
    await this.persistWagon(wagon);
    return images;
  }

  async reorderWagonImages(wagonId: string, orderedNames: string[]): Promise<ImageEntry[]> {
    const wagon = this.requireWagon(wagonId);
    const images = await this.reorderImages(wagon, this.wagonDir(wagonId), `/rollingstock-images/wagons/${wagonId}`, orderedNames);
    await this.persistWagon(wagon);
    return images;
  }

  async renameWagonImage(wagonId: string, oldName: string, newName: string): Promise<ImageEntry[]> {
    const wagon = this.requireWagon(wagonId);
    const images = await this.renameImage(wagon, this.wagonDir(wagonId), `/rollingstock-images/wagons/${wagonId}`, oldName, newName);
    await this.persistWagon(wagon);
    return images;
  }

  async removeWagonImage(wagonId: string, imageName: string): Promise<ImageEntry[]> {
    const wagon = this.requireWagon(wagonId);
    const images = await this.removeImage(wagon, this.wagonDir(wagonId), `/rollingstock-images/wagons/${wagonId}`, imageName);
    await this.persistWagon(wagon);
    return images;
  }
}

function ensureImageExtension(ext: string): string {
  const cleaned = String(ext || '').toLowerCase().replace(/[^a-z0-9.]/g, '');
  if (!cleaned) return '.jpg';
  return cleaned.startsWith('.') ? cleaned : `.${cleaned}`;
}
