import fs from 'fs';
import { randomUUID } from 'crypto';
import { mkdir, readdir, rename, rm, unlink, writeFile } from 'fs/promises';
import path from 'path';

function withImageOrder(entity) {
    return {
        ...entity,
        imageorder: Array.isArray(entity.imageorder) ? entity.imageorder : [],
    };
}

class RollingStockService {
    //readdirsync returns an array of file names in the directory, we can use that to read each info.json and parse it into an object
    constructor() {
        this.trains = fs.readdirSync('data/rollingstock/trains').map((dir) =>
            withImageOrder(JSON.parse(fs.readFileSync(`data/rollingstock/trains/${dir}/info.json`, 'utf-8'))),
        );
        this.wagons = fs.readdirSync('data/rollingstock/wagons').map((dir) =>
            withImageOrder(JSON.parse(fs.readFileSync(`data/rollingstock/wagons/${dir}/info.json`, 'utf-8'))),
        );
    } 

    getTrains() {
        this.trains;
    }
    getWagons() {
        this.wagons;
    }

    /**
     * Adds a new train to the system or updates it.
     *
     * @async
     * @param {number|string} DCC_ID - The unique Digital Command Control identifier.
     * @param {string} Name - The display name of the train.
     * @param {number} Length - The physical length of the train (e.g., in mm or cm).
     * @param {Object} Speed - Speed calibration data.
     * @param {number} Speed.Duration - The time duration for speed measurement.
     * @param {number} Speed.Distance - The distance covered during measurement.
     * @param {number} Speed.Step - The specific speed step or notch.
     * @param {number} Speed.calculated - The resulting calculated velocity.
     * @param {number} startDelay - Delay in milliseconds before the train starts moving.
     * @param {number[]} Functions - Array of function IDs (e.g. [1, 2, 3, 4]).
     * @param {string} Notes - User-defined notes or descriptions.
     * @param {Object} [Meta={}] - Optional metadata for extensibility.
     * @returns {Promise<void>}
     */

    async addTrain(DCC_ID, Name, Length, Speed = {}, startDelay, Functions, Notes, Meta = {}, SpeedLimit = 127) {
        const { Duration, Distance, Step, calculated } = Speed;
        const existingTrain = this.getTrainById(DCC_ID);
        const trainData = {
            DCC_ID,
            Name,
            Length,
            Speed: { Duration, Distance, Step, calculated, limit: SpeedLimit },
            startDelay,
            Functions,
            Notes,
            Meta,
            imageorder: existingTrain?.imageorder ?? [],
        };
        const dataPath = `data/rollingstock/trains/${DCC_ID}`;

        // Write/update info.json on disk
        await mkdir(dataPath, { recursive: true });
        await writeFile(`${dataPath}/info.json`, JSON.stringify(trainData, null, 2), 'utf-8');

        // Update in-memory list as add or update
        const idx = this.trains.findIndex((train) => train.DCC_ID === DCC_ID);
        if (idx !== -1) {
            this.trains[idx] = trainData; // update existing
        } else {
            this.trains.push(trainData); // add new
        }
    }

    async setTrainSpeedLimit(DCC_ID, SpeedLimit) {
        const idx = this.trains.findIndex((train) => String(train.DCC_ID) === String(DCC_ID));
        if (idx === -1) {
            throw new Error(`Train with DCC_ID ${DCC_ID} not found`);
        }

        const trainData = {
            ...this.trains[idx],
            Speed: {
                ...this.trains[idx].Speed,
                limit: SpeedLimit,
            },
        };
        const dataPath = `data/rollingstock/trains/${DCC_ID}`;
        await writeFile(`${dataPath}/info.json`, JSON.stringify(trainData, null, 2), 'utf-8');
        this.trains[idx] = trainData;
        return trainData;
    }
    async updateTrain(DCC_ID, updates) {
        const idx = this.trains.findIndex((train) => String(train.DCC_ID) === String(DCC_ID));
        if (idx === -1) {
            throw new Error(`Train with DCC_ID ${DCC_ID} not found`);
        }

        const currentTrain = this.trains[idx];
        const nextTrain = {
            ...currentTrain,
            ...updates,
            DCC_ID: currentTrain.DCC_ID,
            Speed: {
                ...currentTrain.Speed,
                ...updates.Speed,
                limit: currentTrain.Speed?.limit ?? 127,
            },
        };

        const dataPath = `data/rollingstock/trains/${DCC_ID}`;
        await writeFile(`${dataPath}/info.json`, JSON.stringify(nextTrain, null, 2), 'utf-8');
        this.trains[idx] = nextTrain;
        return nextTrain;
    }

    async removeTrain(DCC_ID) {
        const idx = this.trains.findIndex((train) => String(train.DCC_ID) === String(DCC_ID));
        if (idx === -1) {
            throw new Error(`Train with DCC_ID ${DCC_ID} not found`);
        }
        await rm(`data/rollingstock/trains/${DCC_ID}`, { recursive: true, force: true });
        this.trains = this.trains.filter((train) => String(train.DCC_ID) !== String(DCC_ID));
    }

    getTrainImagesDir(DCC_ID) {
        return `data/rollingstock/trains/${DCC_ID}`;
    }

    getTrainById(DCC_ID) {
        return this.trains.find((train) => String(train.DCC_ID) === String(DCC_ID));
    }

    getWagonById(wagonId) {
        return this.wagons.find((wagon) => String(wagon.id) === String(wagonId));
    }

    getImageOrderNames(entity) {
        return (entity.imageorder ?? []).map((entry) => entry.name);
    }

    setImageOrder(entity, names) {
        entity.imageorder = names.map((name) => ({ name }));
    }

    sortImageNamesByOrder(imageNames, orderedNames) {
        const orderIndex = new Map(orderedNames.map((name, index) => [name, index]));
        const inOrder = imageNames
            .filter((name) => orderIndex.has(name))
            .sort((a, b) => orderIndex.get(a) - orderIndex.get(b));
        const unordered = imageNames
            .filter((name) => !orderIndex.has(name))
            .sort((a, b) => a.localeCompare(b));
        return [...inOrder, ...unordered];
    }

    async persistTrainInfo(DCC_ID, trainData) {
        const dataPath = `data/rollingstock/trains/${DCC_ID}`;
        await writeFile(`${dataPath}/info.json`, JSON.stringify(trainData, null, 2), 'utf-8');
    }

    async persistWagonInfo(wagonId, wagonData) {
        const dataPath = `data/rollingstock/wagons/${wagonId}`;
        await writeFile(`${dataPath}/info.json`, JSON.stringify(wagonData, null, 2), 'utf-8');
    }

    isImageFileName(name) {
        return /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(name);
    }

    sanitizeImageBaseName(name) {
        return String(name).trim().replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    ensureImageExtension(ext) {
        const cleaned = String(ext || '').toLowerCase().replace(/[^a-z0-9.]/g, '');
        if (!cleaned) {
            return '.jpg';
        }
        return cleaned.startsWith('.') ? cleaned : `.${cleaned}`;
    }

    async buildOrderedImageList(imageDir, orderedNames, baseUrl) {
        await mkdir(imageDir, { recursive: true });
        const files = await readdir(imageDir);
        const imageNames = files.filter((name) => this.isImageFileName(name));
        const namesInOrder = this.sortImageNamesByOrder(imageNames, orderedNames);
        return namesInOrder.map((name, index) => ({
            name,
            order: index + 1,
            url: `${baseUrl}/${name}`,
        }));
    }

    async listTrainImages(DCC_ID) {
        const train = this.getTrainById(DCC_ID);
        if (!train) {
            throw new Error(`Train with DCC_ID ${DCC_ID} not found`);
        }
        const imagesDir = this.getTrainImagesDir(DCC_ID);
        const images = await this.buildOrderedImageList(imagesDir, this.getImageOrderNames(train), `/rollingstock-images/trains/${DCC_ID}`);
        this.setImageOrder(train, images.map((image) => image.name));
        await this.persistTrainInfo(DCC_ID, train);
        return images;
    }

    async addTrainImage(DCC_ID, file) {
        if (!file) {
            throw new Error('Image file is required');
        }
        const existingTrain = this.getTrainById(DCC_ID);
        if (!existingTrain) {
            throw new Error(`Train with DCC_ID ${DCC_ID} not found`);
        }

        const ext = this.ensureImageExtension(path.extname(file.originalname));
        const imagesDir = this.getTrainImagesDir(DCC_ID);
        await mkdir(imagesDir, { recursive: true });
        const currentImages = await this.listTrainImages(DCC_ID);
        const nextOrder = currentImages.length + 1;
        const nextName = `image-${nextOrder}${ext}`;
        const targetPath = path.join(imagesDir, nextName);

        await writeFile(targetPath, file.buffer);
        this.setImageOrder(existingTrain, [...currentImages.map((image) => image.name), nextName]);
        await this.persistTrainInfo(DCC_ID, existingTrain);
        return this.listTrainImages(DCC_ID);
    }

    async reorderTrainImages(DCC_ID, orderedNames) {
        const existingTrain = this.getTrainById(DCC_ID);
        if (!existingTrain) {
            throw new Error(`Train with DCC_ID ${DCC_ID} not found`);
        }

        const existingImages = await this.listTrainImages(DCC_ID);
        const existingNames = existingImages.map((image) => image.name);
        if (existingNames.length !== orderedNames.length) {
            throw new Error('Image reorder payload must include all images');
        }
        if (!existingNames.every((name) => orderedNames.includes(name))) {
            throw new Error('Image reorder payload contains invalid file names');
        }
        this.setImageOrder(existingTrain, orderedNames);
        await this.persistTrainInfo(DCC_ID, existingTrain);
        return this.listTrainImages(DCC_ID);
    }

    async renameTrainImage(DCC_ID, oldName, newName) {
        const existingTrain = this.getTrainById(DCC_ID);
        if (!existingTrain) {
            throw new Error(`Train with DCC_ID ${DCC_ID} not found`);
        }
        const imagesDir = this.getTrainImagesDir(DCC_ID);
        const images = await this.listTrainImages(DCC_ID);
        const existingNames = images.map((image) => image.name);
        if (!existingNames.includes(oldName)) {
            throw new Error('Image file not found');
        }
        const ext = this.ensureImageExtension(path.extname(oldName));
        const safeBaseName = this.sanitizeImageBaseName(newName);
        if (!safeBaseName) {
            throw new Error('newName cannot be empty');
        }
        const finalName = `${safeBaseName}${ext}`;
        if (existingNames.includes(finalName) && finalName !== oldName) {
            throw new Error('Image name already exists');
        }
        await rename(path.join(imagesDir, oldName), path.join(imagesDir, finalName));
        this.setImageOrder(existingTrain, existingNames.map((name) => (name === oldName ? finalName : name)));
        await this.persistTrainInfo(DCC_ID, existingTrain);
        return this.listTrainImages(DCC_ID);
    }

    async removeTrainImage(DCC_ID, imageName) {
        const existingTrain = this.getTrainById(DCC_ID);
        if (!existingTrain) {
            throw new Error(`Train with DCC_ID ${DCC_ID} not found`);
        }
        const imagesDir = this.getTrainImagesDir(DCC_ID);
        const imagePath = path.join(imagesDir, imageName);
        await unlink(imagePath);
        const currentImages = await this.listTrainImages(DCC_ID);
        this.setImageOrder(existingTrain, currentImages.map((image) => image.name));
        await this.persistTrainInfo(DCC_ID, existingTrain);
        return this.listTrainImages(DCC_ID);
    }

    async addWagon(Name, Length) {
        const id = randomUUID();
        const wagonData = { id, Name, Length };
        const dataPath = `data/rollingstock/wagons/${id}`;
        await mkdir(dataPath, { recursive: true });
        await writeFile(`${dataPath}/info.json`, JSON.stringify(wagonData, null, 2), 'utf-8');
        this.wagons.push(wagonData);
        return wagonData;
    }

    async updateWagon(wagonId, updates) {
        const idx = this.wagons.findIndex((w) => String(w.id) === String(wagonId));
        if (idx === -1) {
            throw new Error(`Wagon ${wagonId} not found`);
        }
        const current = this.wagons[idx];
        const next = {
            ...current,
            ...updates,
            id: current.id,
        };
        const dataPath = `data/rollingstock/wagons/${wagonId}`;
        await writeFile(`${dataPath}/info.json`, JSON.stringify(next, null, 2), 'utf-8');
        this.wagons[idx] = next;
        return next;
    }

    async removeWagon(wagonId) {
        const idx = this.wagons.findIndex((w) => String(w.id) === String(wagonId));
        if (idx === -1) {
            throw new Error(`Wagon ${wagonId} not found`);
        }
        await rm(`data/rollingstock/wagons/${wagonId}`, { recursive: true, force: true });
        this.wagons = this.wagons.filter((w) => String(w.id) !== String(wagonId));
    }

    getWagonImagesDir(wagonId) {
        return `data/rollingstock/wagons/${wagonId}`;
    }

    async listWagonImages(wagonId) {
        const wagon = this.getWagonById(wagonId);
        if (!wagon) {
            throw new Error(`Wagon ${wagonId} not found`);
        }
        const imagesDir = this.getWagonImagesDir(wagonId);
        const images = await this.buildOrderedImageList(imagesDir, this.getImageOrderNames(wagon), `/rollingstock-images/wagons/${wagonId}`);
        this.setImageOrder(wagon, images.map((image) => image.name));
        await this.persistWagonInfo(wagonId, wagon);
        return images;
    }

    async addWagonImage(wagonId, file) {
        if (!file) {
            throw new Error('Image file is required');
        }
        const existing = this.getWagonById(wagonId);
        if (!existing) {
            throw new Error(`Wagon ${wagonId} not found`);
        }

        const ext = this.ensureImageExtension(path.extname(file.originalname));
        const imagesDir = this.getWagonImagesDir(wagonId);
        await mkdir(imagesDir, { recursive: true });
        const currentImages = await this.listWagonImages(wagonId);
        const nextOrder = currentImages.length + 1;
        const nextName = `image-${nextOrder}${ext}`;
        const targetPath = path.join(imagesDir, nextName);

        await writeFile(targetPath, file.buffer);
        this.setImageOrder(existing, [...currentImages.map((image) => image.name), nextName]);
        await this.persistWagonInfo(wagonId, existing);
        return this.listWagonImages(wagonId);
    }

    async reorderWagonImages(wagonId, orderedNames) {
        const existing = this.getWagonById(wagonId);
        if (!existing) {
            throw new Error(`Wagon ${wagonId} not found`);
        }

        const existingImages = await this.listWagonImages(wagonId);
        const existingNames = existingImages.map((image) => image.name);
        if (existingNames.length !== orderedNames.length) {
            throw new Error('Image reorder payload must include all images');
        }
        if (!existingNames.every((name) => orderedNames.includes(name))) {
            throw new Error('Image reorder payload contains invalid file names');
        }

        this.setImageOrder(existing, orderedNames);
        await this.persistWagonInfo(wagonId, existing);
        return this.listWagonImages(wagonId);
    }

    async renameWagonImage(wagonId, oldName, newName) {
        const existing = this.getWagonById(wagonId);
        if (!existing) {
            throw new Error(`Wagon ${wagonId} not found`);
        }
        const imagesDir = this.getWagonImagesDir(wagonId);
        const images = await this.listWagonImages(wagonId);
        const existingNames = images.map((image) => image.name);
        if (!existingNames.includes(oldName)) {
            throw new Error('Image file not found');
        }
        const ext = this.ensureImageExtension(path.extname(oldName));
        const safeBaseName = this.sanitizeImageBaseName(newName);
        if (!safeBaseName) {
            throw new Error('newName cannot be empty');
        }
        const finalName = `${safeBaseName}${ext}`;
        if (existingNames.includes(finalName) && finalName !== oldName) {
            throw new Error('Image name already exists');
        }
        await rename(path.join(imagesDir, oldName), path.join(imagesDir, finalName));
        this.setImageOrder(existing, existingNames.map((name) => (name === oldName ? finalName : name)));
        await this.persistWagonInfo(wagonId, existing);
        return this.listWagonImages(wagonId);
    }

    async removeWagonImage(wagonId, imageName) {
        const existing = this.getWagonById(wagonId);
        if (!existing) {
            throw new Error(`Wagon ${wagonId} not found`);
        }
        const imagesDir = this.getWagonImagesDir(wagonId);
        const imagePath = path.join(imagesDir, imageName);
        await unlink(imagePath);
        const currentImages = await this.listWagonImages(wagonId);
        this.setImageOrder(existing, currentImages.map((image) => image.name));
        await this.persistWagonInfo(wagonId, existing);
        return this.listWagonImages(wagonId);
    }

    getRollingStock() {
        return { trains: this.trains, wagons: this.wagons };
    }
}

const rollingStockService = new RollingStockService();

export default rollingStockService;
