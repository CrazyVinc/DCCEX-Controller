import net from 'net';
import EventEmitter from 'events';

/**
 * DccExClient
 * Handles TCP communication with a DCC-EX command station.
 */
class DccExClient extends EventEmitter {
    /**
     * @param {Object} options
     * @param {string} options.host - IP address of DCC-EX
     * @param {number} [options.port]
     * @param {boolean} [options.autoReconnect=true]
     */
    constructor({ host, port, autoReconnect = true, startupCabs = [] }) {
        super();

        this.host = host;
        this.port = port;
        this.autoReconnect = autoReconnect;

        this.socket = null;
        this.connected = false;

        this.queue = [];
        this.isWriting = false;

        this.buffer = '';

        this.reconnectDelay = 2000;

        // --- STATE ---
        this.power = null; // null = unknown, true = on, false = off
        this.enabledFunctionsByCab = {};
        this.startupCabs = this._normalizeCabs(startupCabs);
    }

    /**
     * Connect to DCC-EX
     */
    connect() {
        if (this.socket) return;

        this.socket = new net.Socket();

        this.socket.connect(this.port, this.host, () => {
            this.connected = true;
            this.emit('connect');

            // Request full status snapshot
            this.send('s');
            this._requestStartupLocoStatus();

            this._flushQueue();
        });

        this.socket.on('data', (data) => {
            this._handleData(data.toString());
        });

        this.socket.on('error', (err) => {
            this.emit('error', err);
        });

        this.socket.on('close', () => {
            this.connected = false;
            this.emit('disconnect');

            this.socket.destroy();
            this.socket = null;

            if (this.autoReconnect) {
                setTimeout(() => this.connect(), this.reconnectDelay);
            }
        });
    }

    /**
     * Disconnect manually
     */
    disconnect() {
        this.autoReconnect = false;
        if (this.socket) {
            this.socket.end();
            this.socket.destroy();
            this.socket = null;
        }
    }

    /**
     * Send raw DCC-EX command
     * @param {string} command
     */
    send(command) {
        const trimmed = typeof command === 'string' ? command.trim() : '';
        // Keep cache + dcc:power in sync when power is toggled via raw send (e.g. dcc:send "1"/"0")
        if (trimmed === '1') {
            this._setPower(true);
        } else if (trimmed === '0') {
            this._setPower(false);
        } else {
            this._trySyncFunctionFromCommand(trimmed);
        }

        const formatted = `<${trimmed}>`;

        this.queue.push(formatted);
        this._flushQueue();
    }

    /**
     * Internal queue handler
     */
    _flushQueue() {
        if (!this.connected || this.isWriting || this.queue.length === 0) {
            return;
        }

        this.isWriting = true;

        const cmd = this.queue.shift();

        this.socket.write(cmd, () => {
            this.isWriting = false;
            this._flushQueue();
        });
    }

    /**
     * Handle incoming TCP data
     */
    _handleData(chunk) {
        this.buffer += chunk;

        let index;
        while ((index = this.buffer.indexOf('>')) !== -1) {
            const message = this.buffer.slice(0, index + 1);
            this.buffer = this.buffer.slice(index + 1);

            this._parseMessage(message);
            this.emit('message', message);
        }
    }

    /**
     * Parse DCC-EX messages
     */
    _parseMessage(msg) {
        // Example: <p1> or <p0>
        if (msg.startsWith('<p')) {
            this._setPower(msg.includes('1'));
        }

        this._trySyncFunctionFromLocoStatus(msg);

        // You can extend here later:
        // turnout states, loco feedback, etc.
    }

    /**
     * @param {Array<number|string>} cabs
     */
    setStartupCabs(cabs = []) {
        this.startupCabs = this._normalizeCabs(cabs);
    }

    /**
     * @param {Array<number|string>} cabs
     * @returns {number[]}
     */
    _normalizeCabs(cabs) {
        if (!Array.isArray(cabs)) {
            return [];
        }
        return [...new Set(
            cabs
                .map((cab) => Number(cab))
                .filter((cab) => Number.isInteger(cab) && cab >= 0)
        )];
    }

    _requestStartupLocoStatus() {
        if (this.startupCabs.length === 0) {
            return;
        }
        for (const cab of this.startupCabs) {
            this.send(`t ${cab}`);
        }
    }

    /**
     * Get cached power state
     * @returns {boolean|null}
     */
    getPower() {
        return this.power;
    }

    /**
     * Update cached power state and emit only on changes.
     * @param {boolean} state
     */
    _setPower(state) {
        if (this.power !== state) {
            this.power = state;
            this.emit('power', this.power);
        }
    }

    /**
     * Get cached enabled functions for a cab.
     * @param {number} cab
     * @returns {Object<number, boolean>}
     */
    getEnabledFunctions(cab) {
        return this.enabledFunctionsByCab[cab] || {};
    }

    /**
     * DCC-EX function command: F {cab} {fn} {0|1}
     * @param {string} trimmed
     */
    _trySyncFunctionFromCommand(trimmed) {
        const m = trimmed.match(/^[fF]\s+(\d+)\s+(\d+)\s+([01])$/);
        if (!m) {
            return;
        }
        const cab = Number(m[1]);
        const fn = Number(m[2]);
        const on = m[3] === '1';
        this._setFunctionState(cab, fn, on);
    }

    /**
     * Sync from loco status response when function bitmask is present.
     * Typical format includes cab + speed + dir + function bitmask.
     * @param {string} msg
     */
    _trySyncFunctionFromLocoStatus(msg) {
        const m = msg.match(/^<\s*[lL]\s+(\d+)\s+(-?\d+)\s+([01])\s+(\d+)[^>]*>$/);
        if (!m) {
            return;
        }

        const cab = Number(m[1]);
        const functionBitmask = Number(m[4]);
        if (!Number.isInteger(cab) || cab < 0 || !Number.isInteger(functionBitmask) || functionBitmask < 0) {
            return;
        }

        // Rebuild all known states from the incoming bitmask snapshot.
        const nextStates = {};
        for (let fn = 0; fn <= 31; fn += 1) {
            nextStates[fn] = ((functionBitmask >> fn) & 1) === 1;
        }

        this.enabledFunctionsByCab[cab] = nextStates;
        for (let fn = 0; fn <= 31; fn += 1) {
            this.emit('function', { cab, fn, on: nextStates[fn] });
        }
    }

    /**
     * @param {number} cab
     * @param {number} fn
     * @param {boolean} on
     */
    _setFunctionState(cab, fn, on) {
        if (!this.enabledFunctionsByCab[cab]) {
            this.enabledFunctionsByCab[cab] = {};
        }
        const prev = this.enabledFunctionsByCab[cab][fn];
        if (prev === on) {
            return;
        }
        this.enabledFunctionsByCab[cab][fn] = on;
        this.emit('function', { cab, fn, on });
    }

    /* -------------------------
     * HIGH LEVEL COMMANDS
     * ------------------------- */

    /**
     * Set throttle
     * @param {number} cab - loco address
     * @param {number} speed - 0-126
     * @param {number} dir - 0 = reverse, 1 = forward
     */
    setThrottle(cab, speed, direction = 1) {
        const cabNumber = Number(cab);
        const speedStep = Number(speed);

        if (!Number.isInteger(cabNumber) || cabNumber < 0) {
            return;
        }

        if (!Number.isFinite(speedStep)) {
            return;
        }

        const clampedSpeed = Math.max(0, Math.min(126, Math.round(speedStep)));
        // DCC-EX: lowercase `t` = throttle; uppercase `T` = turnout (same as turnoutThrow/Close).
        this.send(`t ${cabNumber} ${speed} ${direction ^ 1}`);
    }

    /**
     * Emergency stop all
     */
    emergencyStop() {
        this.send('!');
    }

    /**
     * Power on track
     */
    powerOn() {
        this._setPower(true);
        this.send('1');
    }

    /**
     * Power off track
     */
    powerOff() {
        this._setPower(false);
        this.send('0');
    }

    /**
     * Throw turnout
     * @param {number} id
     */
    turnoutThrow(id) {
        this.send(`T ${id} 1`);
    }

    /**
     * Close turnout
     * @param {number} id
     */
    turnoutClose(id) {
        this.send(`T ${id} 0`);
    }

    /**
     * Toggle function (lights, sound, etc.)
     * @param {number} cab
     * @param {number} fn
     */
    toggleFunction(cab, fn) {
        const cabNumber = Number(cab);
        const fnToken = String(fn).trim();
        const fnNumber = Number(fnToken.toUpperCase().startsWith('F') ? fnToken.slice(1) : fnToken);

        if (!Number.isInteger(cabNumber) || cabNumber < 0 || !Number.isInteger(fnNumber) || fnNumber < 0) {
            return;
        }

        const currentState = this.getEnabledFunctions(cabNumber)[fnNumber];
        const bit = currentState ? 0 : 1;

        this.send(`F ${cabNumber} ${fnNumber} ${bit}`);
    }
}

export default new DccExClient({
    host: process.env.DCCHost || 'localhost',
    port: 2560
});