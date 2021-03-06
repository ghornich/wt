'use strict';

var assert = require('assert');
var Promise = require('bluebird');
var promiseWhile = require('../../../../modules/promise-while')(Promise);
var base64ToFile = require('../../../../modules/base64-to-file');
var lodashSet = require('lodash.set');

/**
 * @type {String}
 * @memberOf BrowserPuppetCommands
 * @default
 */
var DEFAULT_UPLOAD_FILE_MIME = 'application/octet-stream';

exports = module.exports = BrowserPuppetCommands;

/**
 * @class
 * @abstract
 */
function BrowserPuppetCommands() {
    throw new Error('Can\'t create instance of abstract class "BrowserPuppetCommands"');
}

/**
 * @param {ScrollCommand} cmd
 * @throws {Error}
 */
BrowserPuppetCommands.prototype.scroll = function (cmd) {
    var $el = this.$(cmd.selector);
    this._assert$el($el, cmd);
    $el[0].scrollTop = cmd.scrollTop;
};

/**
 * @param {ScrollToCommand} cmd
 * @throws {Error}
 */
BrowserPuppetCommands.prototype.scrollTo = function (cmd) {
    var $el = this.$(cmd.selector);
    this._assert$el($el, cmd, { assertVisibility: false });
    $el[0].scrollIntoView();
};

/**
 * @param {MouseoverCommand} cmd
 * @throws {Error}
 */
BrowserPuppetCommands.prototype.mouseover = function (cmd) {
    this._log.trace('BrowserPuppetCommands::mouseover: ' + JSON.stringify(cmd));

    var $el = this.$(cmd.selector);
    this._assert$el($el, cmd);

    var mouseoverEvent = new Event('mouseover');
    $el[0].dispatchEvent(mouseoverEvent);
};

/**
 * Waits for selector to become visible
 *
 * @param {WaitForVisibleCommand} cmd
 * @return {Promise}
 */
BrowserPuppetCommands.prototype.waitForVisible = function (cmd) {
    var self = this;

    return Promise.try(function () {
        var pollInterval = _defaultNum(cmd.pollInterval, 500);
        var timeout = _defaultNum(cmd.timeout, 20000);

        var isTimedOut = false;

        self._log.debug('waitForVisible: starting');

        if (self.isSelectorVisible(cmd.selector)) {
            self._log.debug('waitForVisible: selector wasn\'t visible: ' + cmd.selector);
            return;
        }

        setTimeout(function () {
            isTimedOut = true;
        }, timeout);

        return promiseWhile(
            function () {
                var result = self.isSelectorVisible(cmd.selector);
                self._log.debug('waitForVisible: visibility: ' + cmd.selector + ', ' + result);
                return !result;
            },
            function () {
                if (isTimedOut) {
                    var msg = 'waitForVisible: timed out (time: ' + timeout + 'ms, selector: "' + cmd.selector + '")';
                    self._log.error(msg);
                    throw new Error(msg);
                }

                self._log.debug('waitForVisible: delaying');
                return Promise.delay(pollInterval);
            }
        );
    });
};

/**
 * Waits until selector is visible
 * 
 * @param {WaitWhileVisibleCommand} cmd
 * @return {Promise}
 */
BrowserPuppetCommands.prototype.waitWhileVisible = function (cmd) {
    var self = this;

    return Promise.try(function () {
        var pollInterval = _defaultNum(cmd.pollInterval, 500);
        var initialDelay = _defaultNum(cmd.initialDelay, 500);
        var timeout = _defaultNum(cmd.timeout, 20000);

        var isTimedOut = false;

        self._log.debug('waitWhileVisible: starting, initialDelay: ' + initialDelay);

        return Promise.delay(initialDelay)
        .then(function () {
            if (!self.isSelectorVisible(cmd.selector)) {
                self._log.debug('waitWhileVisible: selector wasnt visible: ' + cmd.selector);
                return;
            }

            setTimeout(function () {
                isTimedOut = true;
            }, timeout);

            return promiseWhile(
                function () {
                    var result = self.isSelectorVisible(cmd.selector);
                    self._log.debug('waitWhileVisible: visibility: ' + cmd.selector + ', ' + result);
                    return result;
                },
                function () {
                    if (isTimedOut) {
                        var msg = 'waitWhileVisible: timed out (time: ' + timeout + 'ms, selector: "' + cmd.selector + '")';
                        self._log.error(msg);
                        throw new Error(msg);
                    }

                    self._log.debug('waitWhileVisible: delaying');
                    return Promise.delay(pollInterval);
                }
            );
        });
    });
};

/**
 * @param {ClickCommand} cmd
 * @throws {Error}
 */
BrowserPuppetCommands.prototype.click = function (cmd) {
    var $el = this.$(cmd.selector);
    this._assert$el($el, cmd, cmd.options);

    // TODO use dispatchEvent?
    $el[0].click();
};

// TODO handle meta keys, arrow keys
// TODO which event to use? keyup, keydown, keypress?

/**
 * @param {PressKeyCommand} cmd
 * @throws {Error}
 */
BrowserPuppetCommands.prototype.pressKey = function (cmd) {
    var $el = this.$(cmd.selector);
    var keyCodeNum = Number(cmd.keyCode);

    assert(Number.isFinite(keyCodeNum), 'BrowserPuppetCommands::pressKey: keyCode is not a number');
    this._assert$el($el, cmd);

    var keydownEvent = new Event('keydown', { bubbles: true });

    keydownEvent.which = keyCodeNum;
    keydownEvent.keyCode = keyCodeNum;
    keydownEvent.charCode = keyCodeNum;

    $el[0].dispatchEvent(keydownEvent);
};

/**
 * @param {SetValueCommand} cmd
 * @throws {Error}
 */
BrowserPuppetCommands.prototype.setValue = function (cmd) {
    var $el = this.$(cmd.selector);
    var el = $el[0];
    var tagName = el && el.tagName || '';

    this._assert$el($el, cmd);

    if (tagName !== 'INPUT' && tagName !== 'TEXTAREA') {
        throw new Error('Unable to set value of "' + cmd.selector + '": unsupported tag "' + tagName + '"');
    }

    try {
        setNativeValue(el, cmd.value);
    }
    catch (err){
        // ignore error, fallback to directly setting value
        el.value = cmd.value;
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
};

/**
 * @param {FocusCommand} cmd
 * @throws {Error}
 */
BrowserPuppetCommands.prototype.focus = function (cmd) {
    var $el = this.$(cmd.selector);
    this._assert$el($el, cmd, cmd.options);
    $el[0].focus();
};

/**
 * @param {GetValueCommand} cmd
 * @return {String|Boolean}
 * @throws {Error}
 */
BrowserPuppetCommands.prototype.getValue = function (cmd) {
    var $el = this.$(cmd.selector);
    var el = $el[0];

    this._assert$el($el, cmd);

    // TODO util fn to get node value

    // TODO handle all val() nodes
    if (el.tagName === 'INPUT' && el.type === 'checkbox') {
        return el.checked;
    }

    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        return $el.val().replace(/\n/g, '\\n');
    }

    return $el.text().replace(/\n/g, '\\n');

};

/**
 * @param {IsVisibleCommand} cmd
 * @return {Boolean}
 * @throws {Error}
 */
BrowserPuppetCommands.prototype.isVisible = function (cmd) {
    return this.isSelectorVisible(cmd.selector);
};

/**
 * Upload file and assign the generated File instance to a variable.
 *
 * @param {UploadFileAndAssignCommand} cmd
 * @throws {Error}
 */
BrowserPuppetCommands.prototype.uploadFileAndAssign = function (cmd) {
    cmd.fileData.type = cmd.fileData.type || DEFAULT_UPLOAD_FILE_MIME;
    lodashSet(window, cmd.destinationVariable, base64ToFile(cmd.fileData));
};

/**
 * @param {*} $el
 * @param {*} cmd
 * @param {ElementAssertOptions} [options]
 */
BrowserPuppetCommands.prototype._assert$el = function ($el, cmd, options) {
    options = options || {};
    options.assertVisibility = defaultVal(options.assertVisibility, true);

    if ($el.length === 0) {
        throw new Error(cmd.type + ': selector not found: "' + cmd.selector + '"');
    }

    if ($el.length > 1) {
        throw new Error(cmd.type + ': selector not unique: "' + cmd.selector + '"');
    }

    if (options.assertVisibility && !this._isJQueryElementsVisible($el)) {
        throw new Error(cmd.type + ': selector not visible: "' + cmd.selector + '"');
    }
};

function defaultVal(val, def) {
    if (val !== undefined) {
        return val;
    }

    return def;
}

function _defaultNum(value, def) {
    var numValue = Number(value);

    if (Number.isFinite(numValue)) {
        return numValue;
    }

    return def;
}

// https://github.com/facebook/react/issues/10135#issuecomment-314441175
function setNativeValue(element, value) {
    var valueSetter = Object.getOwnPropertyDescriptor(element, 'value').set;
    var prototype = Object.getPrototypeOf(element);
    var prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
    
    if (valueSetter && valueSetter !== prototypeValueSetter) {
        prototypeValueSetter.call(element, value);
    } else {
      valueSetter.call(element, value);
    }
  }