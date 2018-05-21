'use strict';

const resolvePath = require('path').resolve;
const EventEmitter = require('events').EventEmitter;
const util = require('util');
const rimraf = require('rimraf');
const Loggr = require('../loggr');
const http = require('http');
const WS = require('ws');
const truncateString = require('lodash.truncate');
const treeKill = require('tree-kill');

const TEMP_DELETE_RETRIES = BrowserSpawnerBase.TEMP_DELETE_RETRIES = 3;
const TEMP_DELETE_TIMEOUT = BrowserSpawnerBase.TEMP_DELETE_TIMEOUT = 1000;

const DEFAULT_SPAWNER_PORT = 24556;

exports = module.exports = BrowserSpawnerBase;

/**
 * @typedef {BrowserSpawnerOptions}
 *
 * @property {String} name - Display name for this browser
 * @property {String} path - Path to browser executable
 * @property {String} [tempDir] - Temporary profile dir path. Defaults to a random directory in cwd
 * @property {Number} width - Recorded app viewport width
 * @property {Number} height - Recorded app viewport height
 * @property {Object} [logger] - Custom Loggr instance
 */

/**
 * 
 * @param {BrowserSpawnerOptions} options
 */
function BrowserSpawnerBase(options) {
    EventEmitter.call(this);

    this._opts = options || {};
    this._opts.width = this._opts.width;
    this._opts.height = this._opts.height;
    this._opts.tempDir = resolvePath(this._opts.tempDir || this._getDefaultTempDir());
    this._log = options.logger || new Loggr({
        namespace: `BrowserSpawner ${this._opts.name}`,
        indent: '  ',
    });

    this._process = null;

    this._httpServer = http.createServer((request, response) => response.end('404'));
    this._wsServer = null;
    this._wsConn = null;

    Object.defineProperty(this, 'name', {
        get: function () {
            return this._opts.name;
        },
    });
}

util.inherits(BrowserSpawnerBase, EventEmitter);

/**
 * 
 * @param {String} url - URL to open
 * @return {Promise}
 */
BrowserSpawnerBase.prototype.start = async function () {
    this._wsServer = new WS.Server({ server: this._httpServer, perMessageDeflate: false });

    this._wsServer.on('connection', this._onWsConnection.bind(this));

    this._wsServer.on('error', err => {
        this._log.error(err.stack || err.message);
    });

    await new Promise(res => this._httpServer.listen(DEFAULT_SPAWNER_PORT, res));

    await this._startBrowser(resolvePath(__dirname, 'browser-spawner-context.html'));
    await this._waitForConnection();

    // TODO await this with events?
    this._sendWsMessage({
        type: 'set-iframe-size',
        width: this._opts.width,
        height: this._opts.height,
    });
    await new Promise(r => setTimeout(r, 500));
};

BrowserSpawnerBase.prototype._waitForConnection = async function () {
    while (this._wsConn === null) {
        await new Promise(res => setTimeout(res, 500));
    }
};

BrowserSpawnerBase.prototype._onWsConnection = function (conn) {
    this._wsConn = conn;
};

/**
 * @abstract
 * @param {String} spawnerControlUrl
 * @return {Promise}
 */
BrowserSpawnerBase.prototype._startBrowser = async function () {
    throw new Error('BrowserSpawnerBase::_startBrowser: not implemented');
};

BrowserSpawnerBase.prototype.open = function (url) {
    if (!this._wsConn) {
        throw new Error('BrowserSpawnerBase::open: not connected');
    }

    const truncatedUrl = truncateString(url, {
        length: 120,
        omission: ' [...]',
    });

    this._log.info(`opening address "${truncatedUrl}"`);

    if (truncatedUrl.length < url) {
        this._log.trace(`opening address "${url}"`);
    }

    this._sendWsMessage({ type: 'open', url: url });
};

BrowserSpawnerBase.prototype._sendWsMessage = function (msgArg) {
    let msg = msgArg;
    if (typeof msgArg === 'object') {
        msg = JSON.stringify(msgArg);
    }

    this._wsConn.send(msg);
};

BrowserSpawnerBase.prototype.stop = async function () {
    if (this._process && this._wsServer) {
        await new Promise(resolve => {
            this._wsServer.close(resolve);
        });

        await new Promise((resolve, reject) => {
            treeKill(this._process.pid, err => err ? reject(err) : resolve());
        });

        await new Promise(res => this._httpServer.close(res));
        this._wsConn = null;
        this._process = null;
    }
    else {
        throw new Error('Process or WS Server not running');
    }
};

/**
 * 
 * @param {String} eventName - 'close', 'error'
 * @param {Function} callback - Params: 'close' event: none; 'error' event: error
 */
// BrowserSpawnerBase.prototype.on = function () {
//     return Promise.reject(new Error('BrowserSpawnerBase::on: not implemented'))
// };

BrowserSpawnerBase.prototype._getDefaultTempDir = function () {
    throw new Error('BrowserSpawnerBase::_getDefaultTempDir: not implemented');
};

BrowserSpawnerBase.prototype._deleteTempDir = function () {
    // TODO delete all previous temp dirs too

    return new Promise((resolve) => {
        this._log.debug('BrowserSpawnerBase: deleting temp dir');

        let attempts = 0;

        const loop = () => {
            attempts++;

            if (attempts > TEMP_DELETE_RETRIES) {
                throw new Error('BrowserSpawnerBase: maximum retries reached');
            }

            rimraf(this._opts.tempDir, (maybeError) => {
                if (maybeError) {
                    this._log.debug(`BrowserSpawnerBase: deleting temp dir failed: ${maybeError}`);

                    setTimeout(loop, TEMP_DELETE_TIMEOUT);
                }
                else {
                    resolve();
                }
            });
        };

        loop();
    });
};
