import fs from 'fs';
import { mkdir, writeFile } from 'fs/promises';

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

    async addTrain(DCC_ID, Name, Length, Speed = {}, startDelay, Functions, Notes, Meta = {}) {
        const { Duration, Distance, Step, calculated } = Speed;
        const trainData = { DCC_ID, Name, Length, Speed: { Duration, Distance, Step, calculated }, startDelay, Functions, Notes, Meta };
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
    removeTrain(DCC_ID) {
        fs.unlinkSync(`data/rollingstock/trains/${DCC_ID}/info.json`);
        this.trains = this.trains.filter((train) => train.DCC_ID !== DCC_ID);
    }


    /**
     * Add an image to a train or wagon.
     * @param {'train'|'wagon'} Type - The type of rolling stock ("train" or "wagon").
     * @param {number} DCC_ID - The DCC_ID of the item to add the image to.
     * @param {string} image - The image (URL, path, or data).
     */
    addImage(Type, DCC_ID, Media) {
        /** 
         * add to info.json a new section called images:
         * file: image0001.png
         * order:
         * 
         * for order, 0 is always thumbnail.
         */
        let path = `path`;
        // fs.writeFile()
    }

    removeImage(Type, DCC_ID, Media) {}
    
    addWagon(wagon) {
        this.wagons.push(wagon);
    }

    getRollingStock() {
        return { trains: this.trains, wagons: this.wagons };
    }
}

const rollingStockService = new RollingStockService();

export default rollingStockService;
