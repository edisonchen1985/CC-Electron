(function () {'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var path = _interopDefault(require('path'));
var url = _interopDefault(require('url'));
var electron = require('electron');
var fs = _interopDefault(require('fs'));
var util = _interopDefault(require('util'));
var jetpack = _interopDefault(require('fs-jetpack'));
var _ = _interopDefault(require('lodash'));
var idle = _interopDefault(require('@paulcbetts/system-idle-time'));
var electronUpdater = require('electron-updater');

const eApp = electron.app || electron.remote.app;

class I18n {
    /**
     * Load users language if available, and fallback to english for any missing strings
     * @constructor
     */
    constructor () {
        let dir = path.join(__dirname, '../i18n/lang');
        if (!fs.existsSync(dir)) {
            dir = path.join(__dirname, 'i18n/lang');
        }
        const defaultLocale = path.join(dir, 'zh.i18n.json');
        this.loadedLanguage = JSON.parse(fs.readFileSync(defaultLocale, 'utf8'));
        const locale = path.join(dir, `${eApp.getLocale()}.i18n.json`);
        if (fs.existsSync(locale)) {
            const lang = JSON.parse(fs.readFileSync(locale, 'utf8'));
            this.loadedLanguage = Object.assign(this.loadedLanguage, lang);
        }
    }

    /**
     * Get translation string
     * @param {string} phrase The key for the translation string
     * @param {...string|number} replacements List of replacements in template strings
     * @return {string} Translation in users language
     */
    __ (phrase, ...replacements) {
        const translation = this.loadedLanguage[phrase] ? this.loadedLanguage[phrase] : phrase;
        return util.format(translation, ...replacements);
    }
}

var i18n = new I18n();

const devMenuTemplate = {
    label: i18n.__('Development'),
    submenu: [{
        label: 'Reload',
        accelerator: 'CmdOrCtrl+R',
        click: function () {
            electron.BrowserWindow.getFocusedWindow().webContents.reloadIgnoringCache();
        }
    }, {
        label: i18n.__('Toggle_DevTools'),
        accelerator: 'Alt+CmdOrCtrl+I',
        click: function () {
            electron.BrowserWindow.getFocusedWindow().toggleDevTools();
        }
    }, {
        label: i18n.__('Quit'),
        accelerator: 'CmdOrCtrl+Q',
        click: function () {
            electron.app.quit();
        }
    }]
};

const editMenuTemplate = {
    label: i18n.__('Edit'),
    submenu: [
        { label: i18n.__('Undo'), accelerator: "CmdOrCtrl+Z", selector: "undo:" },
        { label: i18n.__('Redo'), accelerator: "Shift+CmdOrCtrl+Z", selector: "redo:" },
        { type: "separator" },
        { label: i18n.__('Cut'), accelerator: "CmdOrCtrl+X", selector: "cut:" },
        { label: i18n.__('Copy'), accelerator: "CmdOrCtrl+C", selector: "copy:" },
        { label: i18n.__('Paste'), accelerator: "CmdOrCtrl+V", selector: "paste:" },
        { label: i18n.__('Select_All'), accelerator: "CmdOrCtrl+A", selector: "selectAll:" }
    ]
};

class CertificateStore {
    initWindow (win) {
        this.storeFileName = 'certificate.json';
        this.userDataDir = jetpack.cwd(electron.app.getPath('userData'));

        this.load();

        // Don't ask twice for same cert if loading multiple urls
        this.queued = {};

        this.window = win;
        electron.app.on('certificate-error', (event, webContents, url$$1, error, certificate, callback) => {
            event.preventDefault();
            if (this.isTrusted(url$$1, certificate)) {
                callback(true);
                return;
            }

            if (this.queued[certificate.fingerprint]) {
                this.queued[certificate.fingerprint].push(callback);
                // Call the callback after approved/rejected
                return;
            } else {
                this.queued[certificate.fingerprint] = [callback];
            }

            let detail = `URL: ${url$$1}\nError: ${error}`;
            if (this.isExisting(url$$1)) {
                detail = i18n.__('Certificate_error_different', detail);
            }

            electron.dialog.showMessageBox(this.window, {
                title: i18n.__('Certificate_error'),
                message: i18n.__('Certificate_error_message', certificate.issuerName),
                detail: detail,
                type: 'warning',
                buttons: [
                    i18n.__('Yes'),
                    i18n.__('No')
                ],
                cancelId: 1
            }, (response) => {
                if (response === 0) {
                    this.add(url$$1, certificate);
                    this.save();
                    if (webContents.getURL().indexOf('file://') === 0) {
                        webContents.send('certificate-reload', url$$1);
                    }
                }
                //Call all queued callbacks with result
                this.queued[certificate.fingerprint].forEach(cb => cb(response === 0));
                delete this.queued[certificate.fingerprint];
            });
        });
    }

    load () {
        try {
            this.data = this.userDataDir.read(this.storeFileName, 'json');
        } catch (e) {
            console.error(e);
            this.data = {};
        }

        if (this.data === undefined) {
            this.clear();
        }
    }

    clear () {
        this.data = {};
        this.save();
    }

    save () {
        this.userDataDir.write(this.storeFileName, this.data, { atomic: true });
    }

    parseCertificate (certificate) {
        return certificate.issuerName + '\n' + certificate.data.toString();
    }

    getHost (certUrl) {
        return url.parse(certUrl).host;
    }

    add (certUrl, certificate) {
        const host = this.getHost(certUrl);
        this.data[host] = this.parseCertificate(certificate);
    }

    isExisting (certUrl) {
        const host = this.getHost(certUrl);
        return this.data.hasOwnProperty(host);
    }

    isTrusted (certUrl, certificate) {
        const host = this.getHost(certUrl);
        if (!this.isExisting(certUrl)) {
            return false;
        }
        return this.data[host] === this.parseCertificate(certificate);
    }
}

const certificateStore = new CertificateStore();

let servers = {};

var servers$1 = {
    loadServers (s) {
        servers = s;
    },

    getServers () {
        return servers;
    }
};

electron.app.on('login', function (event, webContents, request, authInfo, callback) {
    for (const url$$1 of Object.keys(servers)) {
        const server = servers[url$$1];
        if (request.url.indexOf(url$$1) === 0 && server.username) {
            callback(server.username, server.password);
            break;
        }
    }
});

// Simple module to help you remember the size and position of windows.
// Can be used for more than one window, just construct many
// instances of it and give each different name.

function windowStateKeeper (name, defaults) {

    const userDataDir = jetpack.cwd(electron.app.getPath('userData'));
    const stateStoreFile = `window-state-${name}.json`;
    let state = {
        width: defaults.width,
        height: defaults.height
    };

    try {
        const loadedState = userDataDir.read(stateStoreFile, 'json');
        if (loadedState) {
            state = loadedState;
        }
    } catch (err) {
        // For some reason json can't be read.
        // No worries, we have defaults.
    }

    const saveState = function (win) {
        if (!win.isMaximized() && !win.isMinimized() && win.isVisible()) {
            const position = win.getPosition();
            const size = win.getSize();
            state.x = position[0];
            state.y = position[1];
            state.width = size[0];
            state.height = size[1];
        }
        state.isMaximized = win.isMaximized();
        state.isMinimized = win.isMinimized();
        state.isHidden = !win.isMinimized() && !win.isVisible();
        userDataDir.write(stateStoreFile, state, { atomic: true });
    };

    return {
        get x () { return state.x && Math.floor(state.x); },
        get y () { return state.y && Math.floor(state.y); },
        get width () { return state.width && Math.floor(state.width); },
        get height () { return state.height && Math.floor(state.height); },
        get isMaximized () { return state.isMaximized; },
        get isMinimized () { return state.isMinimized; },
        get isHidden () { return state.isHidden; },
        saveState: _.debounce(saveState, 1000)
    };
}

const installDir = jetpack.cwd(electron.app.getAppPath());
const userDataDir = jetpack.cwd(electron.app.getPath('userData'));
const updateStoreFile = 'update.json';
let checkForUpdatesEvent;

electronUpdater.autoUpdater.autoDownload = false;

let updateFile = {};
try {
    const installUpdateFile = installDir.read(updateStoreFile, 'json');
    const userUpdateFile = userDataDir.read(updateStoreFile, 'json');
    updateFile = Object.assign({}, installUpdateFile, userUpdateFile);
} catch (err) {
    console.error(err);
}

function updateDownloaded () {
    electron.dialog.showMessageBox({
        title: i18n.__('Update_ready'),
        message: i18n.__('Update_ready_message'),
        buttons: [
            i18n.__('Update_Install_Later'),
            i18n.__('Update_Install_Now')
        ],
        defaultId: 1
    }, (response) => {
        if (response === 0) {
            electron.dialog.showMessageBox({
                title: i18n.__('Update_installing_later'),
                message: i18n.__('Update_installing_later_message')
            });
        } else {
            electronUpdater.autoUpdater.quitAndInstall();
            setTimeout(() => electron.app.quit(), 1000);
        }
    });
}

function updateNotAvailable () {
    if (checkForUpdatesEvent) {
        checkForUpdatesEvent.sender.send('update-result', false);
        checkForUpdatesEvent = null;
    }
}

function updateAvailable ({version}) {
    //注释掉自动更新
    return;
    if (checkForUpdatesEvent) {
        checkForUpdatesEvent.sender.send('update-result', true);
        checkForUpdatesEvent = null;
    } else if (updateFile.skip === version) {
        return;
    }

    let window = new electron.BrowserWindow({
        title: i18n.__('Update_Available'),
        width: 600,
        height: 330,
        show : false,
        center: true,
        resizable: false,
        maximizable: false,
        minimizable: false
    });

    window.loadURL(`file://${__dirname}/public/update.html`);
    window.setMenuBarVisibility(false);

    window.webContents.on('did-finish-load', () => {
        window.webContents.send('new-version', version);
        window.show();
    });

    electron.ipcMain.once('update-response', (e, type) => {
        switch (type) {
            case 'skip':
                updateFile.skip = version;
                userDataDir.write(updateStoreFile, updateFile, { atomic: true });
                electron.dialog.showMessageBox({
                    title: i18n.__('Update_skip'),
                    message: i18n.__('Update_skip_message')
                }, () => window.close());
                break;
            case 'remind':
                electron.dialog.showMessageBox({
                    title: i18n.__('Update_remind'),
                    message: i18n.__('Update_remind_message')
                }, () => window.close());
                break;
            case 'update':
                electron.dialog.showMessageBox({
                    title: i18n.__('Update_downloading'),
                    message: i18n.__('Update_downloading_message')
                }, () => window.close());
                electronUpdater.autoUpdater.downloadUpdate();
                break;
        }
    });

    window.on('closed', () => {
        window = null;
        electron.ipcMain.removeAllListeners('update-response');
    });
}

function checkForUpdates () {
    electronUpdater.autoUpdater.on('update-available', updateAvailable);
    electronUpdater.autoUpdater.on('update-not-available', updateNotAvailable);

    electronUpdater.autoUpdater.on('update-downloaded', updateDownloaded);

    // Event from about window
    electron.ipcMain.on('check-for-updates', (e, autoUpdate) => {
        if (autoUpdate === true || autoUpdate === false) {
            updateFile.autoUpdate = autoUpdate;
            userDataDir.write(updateStoreFile, updateFile, { atomic: true });
        } else if (autoUpdate === 'auto') {
            e.returnValue = updateFile.autoUpdate !== false;
        } else {
            checkForUpdatesEvent = e;
            electronUpdater.autoUpdater.checkForUpdates();
        }
    });

    if (updateFile.autoUpdate !== false) {
        electronUpdater.autoUpdater.checkForUpdates();
    }
}

// This is main process of Electron, started as first thing when your
// app starts. This script is running through entire life of your application.
// It doesn't have any windows which you can see on screen, but we can open
// window from here.

process.env.GOOGLE_API_KEY = 'AIzaSyADqUh_c1Qhji3Cp1NE43YrcpuPkmhXD-c';

let screenshareEvent;
electron.ipcMain.on('screenshare', (event, sources) => {
    screenshareEvent = event;
    let mainWindow = new electron.BrowserWindow({
        width: 776,
        height: 600,
        show : false,
        skipTaskbar: false
    });

    mainWindow.loadURL('file://'+__dirname+'/public/screenshare.html');

    //window.openDevTools();
    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.send('sources', sources);
        mainWindow.show();
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
        if (screenshareEvent) {
            screenshareEvent.sender.send('screenshare-result', 'PermissionDeniedError');
            screenshareEvent = null;
        }
    });
});

electron.ipcMain.on('source-result', (e, sourceId) => {
    if (screenshareEvent) {
        screenshareEvent.sender.send('screenshare-result', sourceId);
        screenshareEvent = null;
    }
});

function afterMainWindow (mainWindow) {
    if (!electron.app.isDefaultProtocolClient('rocketchat')) {
        electron.app.setAsDefaultProtocolClient('rocketchat');
    }
    // Preserver of the window size and position between app launches.
    const mainWindowState = windowStateKeeper('main', {
        width: 1000,
        height: 600
    });

    if (mainWindowState.x !== undefined && mainWindowState.y !== undefined) {
        mainWindow.setPosition(mainWindowState.x, mainWindowState.y, false);
    }
    if (mainWindowState.width !== undefined && mainWindowState.height !== undefined) {
        mainWindow.setSize(mainWindowState.width, mainWindowState.height, false);
    }
    mainWindow.setMinimumSize(600, 400);

    if (mainWindowState.isMaximized) {
        mainWindow.maximize();
    }

    if (mainWindowState.isMinimized) {
        mainWindow.minimize();
    }

    if (mainWindowState.isHidden) {
        mainWindow.hide();
    }

    mainWindow.on('close', function (event) {
        if (mainWindow.forceClose) {
            mainWindowState.saveState(mainWindow);
            return;
        }
        event.preventDefault();
        if (mainWindow.isFullScreen()) {
            mainWindow.once('leave-full-screen', () => {
                mainWindow.hide();
            });
            mainWindow.setFullScreen(false);
        } else {
            mainWindow.hide();
        }
        mainWindowState.saveState(mainWindow);
    });

    electron.app.on('before-quit', function () {
        mainWindowState.saveState(mainWindow);
        mainWindow.forceClose = true;
    });

    mainWindow.on('resize', function () {
        mainWindowState.saveState(mainWindow);
    });

    mainWindow.on('move', function () {
        mainWindowState.saveState(mainWindow);
    });

    electron.app.on('activate', function () {
        mainWindow.show();
        mainWindowState.saveState(mainWindow);
    });

    mainWindow.webContents.on('will-navigate', function (event) {
        event.preventDefault();
    });

    electron.ipcMain.on('focus', () => {
        mainWindow.show();
        mainWindowState.saveState(mainWindow);
    });

    electron.ipcMain.on('getSystemIdleTime', (event) => {
        event.returnValue = idle.getIdleTime();
    });

    certificateStore.initWindow(mainWindow);

    checkForUpdates();
}

// Simple wrapper exposing environment variables to rest of the code.

// The variables have been written to `env.json` by the build process.
const env = jetpack.cwd(__dirname).read('env.json', 'json');

// This is main process of Electron, started as first thing when your
// app starts. This script is running through entire life of your application.
// It doesn't have any windows which you can see on screen, but we can open
// window from here.

// Special module holding environment variables which you declared
// in config/env_xxx.json file.
const setApplicationMenu = function () {
    const menus = [editMenuTemplate];
    if (env.name !== 'production') {
        menus.push(devMenuTemplate);
    }
    electron.Menu.setApplicationMenu(electron.Menu.buildFromTemplate(menus));
};

// Save userData in separate folders for each environment.
// Thanks to this you can use production and development versions of the app
// on same machine like those are two separate apps.
if (env.name !== 'production') {
    const userDataPath = electron.app.getPath('userData');
    electron.app.setPath('userData', userDataPath + ' (' + env.name + ')');
}

const processProtocolArgv = (argv) => {
    const protocolURI = argv.find(arg => arg.startsWith('rocketchat://'));
    if (protocolURI) {
        const site = protocolURI.split(/\/|\?/)[2];
        if (site) {
            let scheme = 'https://';
            if (protocolURI.includes('insecure=true')) {
                scheme = 'http://';
            }
            return scheme + site;
        }
    }
};

let mainWindow = null;
const appIsReady = new Promise(resolve => {
    if (electron.app.isReady()) {
        resolve();
    } else {
        electron.app.on('ready', resolve);
    }
});
if (process.platform === 'darwin') {
    // Open protocol urls on mac as open-url is not yet implemented on other OS's
    electron.app.on('open-url', function (e, url$$1) {
        e.preventDefault();
        const site = processProtocolArgv([url$$1]);
        if (site) {
            appIsReady.then(() => setTimeout(() => mainWindow.send('add-host', site), 750));
        }
    });
} else {
    const isSecondInstance = electron.app.makeSingleInstance((argv) => {
        // Someone tried to run a second instance, we should focus our window.
        const site = processProtocolArgv(argv);
        if (site) {
            appIsReady.then(() => mainWindow.send('add-host', site));
        }
        if (mainWindow) {
            if (mainWindow.isMinimized()) {
                mainWindow.restore();
            }
            mainWindow.show();
        }
    });
    if (isSecondInstance) {
        electron.app.quit();
    }
}

electron.app.on('ready', function () {
    setApplicationMenu();

    mainWindow = new electron.BrowserWindow({
        width: 1000,
        titleBarStyle: 'hidden',
        height: 600
    });

    afterMainWindow(mainWindow);

    mainWindow.loadURL(url.format({
        pathname: path.join(__dirname, 'public', 'app.html'),
        protocol: 'file:',
        slashes: true
    }));

    if (env.name === 'development') {
        mainWindow.openDevTools();
    }
});

electron.app.on('window-all-closed', function () {
    electron.app.quit();
});

exports.remoteServers = servers$1;
exports.certificate = certificateStore;

}());
//# sourcemappingURL=background.js.map