import fs from 'fs';
import { mkdir, readdir, rename, rm, unlink, writeFile } from 'fs/promises';
import path from 'path';

class RollingStockService {
    //readdirsync returns an array of file names in the directory, we can use that to read each info.json and parse it into an object
    constructor() {
        this.trains = fs.readdirSync('data/rollingstock/trains').map((dir) => JSON.parse(fs.readFileSync(`data/rollingstock/trains/${dir}/info.json`, 'utf-8')));
        this.wagons = fs.readdirSync('data/rollingstock/wagons').map((dir) => JSON.parse(fs.readFileSync(`data/rollingstock/wagons/${dir}/info.json`, 'utf-8')));
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
        const trainData = {
            DCC_ID,
            Name,
            Length,
            Speed: { Duration, Distance, Step, calculated, limit: SpeedLimit },
            startDelay,
            Functions,
            Notes,
            Meta
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
        await fs.unlink(`data/rollingstock/trains/${DCC_ID}/info.json`);
        this.trains = this.trains.filter((train) => String(train.DCC_ID) !== String(DCC_ID));
    }

    getTrainImagesDir(DCC_ID) {
        return `data/rollingstock/trains/${DCC_ID}`;
    }

    parseImageOrder(fileName) {
        const match = /^image(\d{3})\.[a-z0-9]+$/i.exec(fileName);
        if (!match) {
            return Number.MAX_SAFE_INTEGER;
        }
        return Number(match[1]);
    }

    async listTrainImages(DCC_ID) {
        const imagesDir = this.getTrainImagesDir(DCC_ID);
        await mkdir(imagesDir, { recursive: true });
        const files = await readdir(imagesDir);
        const imageFiles = files
            .filter((name) => /^image\d{3}\.[a-z0-9]+$/i.test(name))
            .sort((a, b) => this.parseImageOrder(a) - this.parseImageOrder(b));

        return imageFiles.map((name, index) => ({
            name,
            order: index + 1,
            url: `/rollingstock-images/trains/${DCC_ID}/${name}`,
        }));
    }

    async addTrainImage(DCC_ID, file) {
        if (!file) {
            throw new Error('Image file is required');
        }
        const existingTrain = this.trains.find((train) => String(train.DCC_ID) === String(DCC_ID));
        if (!existingTrain) {
            throw new Error(`Train with DCC_ID ${DCC_ID} not found`);
        }

        const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
        const safeExt = ext.replace(/[^.a-z0-9]/g, '');
        const imagesDir = this.getTrainImagesDir(DCC_ID);
        await mkdir(imagesDir, { recursive: true });
        const currentImages = await this.listTrainImages(DCC_ID);
        const nextOrder = currentImages.length + 1;
        const nextName = `image${String(nextOrder).padStart(3, '0')}${safeExt}`;
        const targetPath = path.join(imagesDir, nextName);

        await writeFile(targetPath, file.buffer);
        return this.listTrainImages(DCC_ID);
    }

    async reorderTrainImages(DCC_ID, orderedNames) {
        const existingTrain = this.trains.find((train) => String(train.DCC_ID) === String(DCC_ID));
        if (!existingTrain) {
            throw new Error(`Train with DCC_ID ${DCC_ID} not found`);
        }

        const imagesDir = this.getTrainImagesDir(DCC_ID);
        const existingImages = await this.listTrainImages(DCC_ID);
        const existingNames = existingImages.map((image) => image.name);
        if (existingNames.length !== orderedNames.length) {
            throw new Error('Image reorder payload must include all images');
        }
        if (!existingNames.every((name) => orderedNames.includes(name))) {
            throw new Error('Image reorder payload contains invalid file names');
        }

        const tmpPrefix = `tmp_${Date.now()}`;
        const tmpFiles = [];
        for (let i = 0; i < orderedNames.length; i += 1) {
            const oldName = orderedNames[i];
            const ext = path.extname(oldName).toLowerCase();
            const tmpName = `${tmpPrefix}_${i + 1}${ext}`;
            await rename(path.join(imagesDir, oldName), path.join(imagesDir, tmpName));
            tmpFiles.push({ tmpName, ext });
        }

        for (let i = 0; i < tmpFiles.length; i += 1) {
            const finalName = `image${String(i + 1).padStart(3, '0')}${tmpFiles[i].ext}`;
            await rename(path.join(imagesDir, tmpFiles[i].tmpName), path.join(imagesDir, finalName));
        }

        return this.listTrainImages(DCC_ID);
    }

    async removeTrainImage(DCC_ID, imageName) {
        const imagesDir = this.getTrainImagesDir(DCC_ID);
        const imagePath = path.join(imagesDir, imageName);
        await unlink(imagePath);
        const currentImages = await this.listTrainImages(DCC_ID);
        const namesInOrder = currentImages.map((image) => image.name);
        await this.reorderTrainImages(DCC_ID, namesInOrder);
        return this.listTrainImages(DCC_ID);
    }
    
    addWagon(wagon) {
        this.wagons.push(wagon);
    }

    getRollingStock() {
        return { trains: this.trains, wagons: this.wagons };
    }
}

const rollingStockService = new RollingStockService();

export default rollingStockService;
