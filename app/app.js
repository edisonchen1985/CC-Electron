(function () {'use strict';

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var electron = require('electron');
var path = _interopDefault(require('path'));
var fs = _interopDefault(require('fs'));
var util = _interopDefault(require('util'));
var jetpack = _interopDefault(require('fs-jetpack'));
var events = require('events');

// Add your custom JS code here

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

/* globals $ */

const remoteServers = electron.remote.require('./background').remoteServers;

class Servers extends events.EventEmitter {
    constructor () {
        super();
        this.load();
        const processProtocol = this.getProtocolUrlFromProcess(electron.remote.process.argv);
        if (processProtocol) {
            this.showHostConfirmation(processProtocol);
        }
        electron.ipcRenderer.on('add-host', (e, host) => {
            if (this.hostExists(host)) {
                this.setActive(host);
            } else {
                this.showHostConfirmation(host);
            }
        });
    }

    get hosts () {
        return this._hosts;
    }

    set hosts (hosts) {
        this._hosts = hosts;
        this.save();
        return true;
    }

    get hostsKey () {
        return 'rocket.chat.hosts';
    }

    get activeKey () {
        return 'rocket.chat.currentHost';
    }

    load () {
        let hosts = localStorage.getItem(this.hostsKey);

        try {
            hosts = JSON.parse(hosts);
        } catch (e) {
            if (typeof hosts === 'string' && hosts.match(/^https?:\/\//)) {
                hosts = {};
                hosts[hosts] = {
                    title: hosts,
                    url: hosts
                };
            }

            localStorage.setItem(this.hostsKey, JSON.stringify(hosts));
        }

        if (hosts === null) {
            hosts = {};
        }

        if (Array.isArray(hosts)) {
            const oldHosts = hosts;
            hosts = {};
            oldHosts.forEach(function (item) {
                item = item.replace(/\/$/, '');
                hosts[item] = {
                    title: item,
                    url: item
                };
            });
            localStorage.setItem(this.hostsKey, JSON.stringify(hosts));
        }

        // Load server info from server config file
        if (Object.keys(hosts).length === 0) {
            const path$$1 = jetpack.find(electron.remote.app.getPath('userData'), { matching: 'servers.json'})[0] ||
                jetpack.find(jetpack.path(electron.remote.app.getAppPath(), '..'), { matching: 'servers.json'})[0];

            if (path$$1) {
                const pathToServerJson = jetpack.path(path$$1);

                try {
                    const result = jetpack.read(pathToServerJson, 'json');
                    if (result) {
                        hosts = {};
                        Object.keys(result).forEach((title) => {
                            const url = result[title];
                            hosts[url] = { title, url };
                        });
                        localStorage.setItem(this.hostsKey, JSON.stringify(hosts));
                        // Assume user doesn't want sidebar if they only have one server
                        if (Object.keys(hosts).length === 1) {
                            localStorage.setItem('sidebar-closed', 'true');
                        }
                    }

                } catch (e) {
                    console.error('Server file invalid');
                }
            }
        }

        this._hosts = hosts;
        remoteServers.loadServers(this._hosts);
        this.emit('loaded');
    }

    save () {
        localStorage.setItem(this.hostsKey, JSON.stringify(this._hosts));
        this.emit('saved');
    }

    get (hostUrl) {
        return this.hosts[hostUrl];
    }

    forEach (cb) {
        for (const host in this.hosts) {
            if (this.hosts.hasOwnProperty(host)) {
                cb(this.hosts[host]);
            }
        }
    }

    validateHost (hostUrl, timeout) {
        timeout = timeout || 5000;
        return new Promise(function (resolve, reject) {
            let resolved = false;
            $.getJSON(`${hostUrl}/api/info`).then(function () {
                if (resolved) {
                    return;
                }
                resolved = true;
                resolve();
            }, function (request) {
                if (request.status === 401) {
                    const authHeader = request.getResponseHeader('www-authenticate');
                    if (authHeader && authHeader.toLowerCase().indexOf('basic ') === 0) {
                        resolved = true;
                        reject('basic-auth');
                    }
                }
                if (resolved) {
                    return;
                }
                resolved = true;
                reject('invalid');
            });
            if (timeout) {
                setTimeout(function () {
                    if (resolved) {
                        return;
                    }
                    resolved = true;
                    reject('timeout');
                }, timeout);
            }
        });
    }

    hostExists (hostUrl) {
        const hosts = this.hosts;

        return !!hosts[hostUrl];
    }

    addHost (hostUrl) {
        const hosts = this.hosts;

        const match = hostUrl.match(/^(https?:\/\/)([^:]+):([^@]+)@(.+)$/);
        let username;
        let password;
        let authUrl;
        if (match) {
            authUrl = hostUrl;
            hostUrl = match[1] + match[4];
            username = match[2];
            password = match[3];
        }

        if (this.hostExists(hostUrl) === true) {
            this.setActive(hostUrl);
            return false;
        }

        hosts[hostUrl] = {
            title: hostUrl,
            url: hostUrl,
            authUrl: authUrl,
            username: username,
            password: password
        };
        this.hosts = hosts;

        remoteServers.loadServers(this.hosts);

        this.emit('host-added', hostUrl);

        return hostUrl;
    }

    removeHost (hostUrl) {
        const hosts = this.hosts;
        if (hosts[hostUrl]) {
            delete hosts[hostUrl];
            this.hosts = hosts;

            remoteServers.loadServers(this.hosts);

            if (this.active === hostUrl) {
                this.clearActive();
            }
            this.emit('host-removed', hostUrl);
        }
    }

    get active () {
        return localStorage.getItem(this.activeKey);
    }

    setActive (hostUrl) {
        let url;
        if (this.hostExists(hostUrl)) {
            url = hostUrl;
        } else if (Object.keys(this._hosts).length > 0) {
            url = Object.keys(this._hosts)[0];
        }

        if (url) {
            localStorage.setItem(this.activeKey, hostUrl);
            this.emit('active-setted', url);
            return true;
        }
        this.emit('loaded');
        return false;
    }

    restoreActive () {
        this.setActive(this.active);
    }

    clearActive () {
        localStorage.removeItem(this.activeKey);
        this.emit('active-cleared');
        return true;
    }

    setHostTitle (hostUrl, title) {
        if (title === 'Rocket.Chat' && /https?:\/\/open\.rocket\.chat/.test(hostUrl) === false) {
            title += ' - ' + hostUrl;
        }
        const hosts = this.hosts;
        hosts[hostUrl].title = title;
        this.hosts = hosts;
        this.emit('title-setted', hostUrl, title);
    }
    getProtocolUrlFromProcess (args) {
        let site = null;
        if (args.length > 1) {
            const protocolURI = args.find(arg => arg.startsWith('rocketchat://'));
            if (protocolURI) {
                site = protocolURI.split(/\/|\?/)[2];
                if (site) {
                    let scheme = 'https://';
                    if (protocolURI.includes('insecure=true')) {
                        scheme = 'http://';
                    }
                    site = scheme + site;
                }
            }
        }
        return site;
    }
    showHostConfirmation (host) {
        return electron.remote.dialog.showMessageBox({
            type: 'question',
            buttons: [i18n.__('Add'), i18n.__('Cancel')],
            defaultId: 0,
            title: i18n.__('Add_Server'),
            message: i18n.__('Add_host_to_servers', host)
        }, (response) => {
            if (response === 0) {
                this.validateHost(host)
                    .then(() => this.addHost(host))
                    .then(() => this.setActive(host))
                    .catch(() => electron.remote.dialog.showErrorBox(i18n.__('Invalid_Host'), i18n.__('Host_not_validated', host)));
            }
        });
    }

    resetAppData () {
        return electron.remote.dialog.showMessageBox({
            type: 'question',
            buttons: ['Yes', 'Cancel'],
            defaultId: 1,
            title: i18n.__('Reset_App_Data'),
            message: i18n.__('Reset_App_Data_Message')
        }, (response) => {
            if (response === 0) {
                const dataDir = electron.remote.app.getPath('userData');
                jetpack.remove(dataDir);
                electron.remote.app.relaunch();
                electron.remote.app.quit();
            }
        });
    }

}

var servers = new Servers();

class WebView extends events.EventEmitter {
    constructor () {
        super();

        this.webviewParentElement = document.body;

        servers.forEach((host) => {
            this.add(host);
        });

        servers.on('host-added', (hostUrl) => {
            this.add(servers.get(hostUrl));
        });

        servers.on('host-removed', (hostUrl) => {
            this.remove(hostUrl);
        });

        servers.on('active-setted', (hostUrl) => {
            this.setActive(hostUrl);
        });

        servers.on('active-cleared', (hostUrl) => {
            this.deactiveAll(hostUrl);
        });

        servers.once('loaded', () => {
            this.loaded();
        });

        electron.ipcRenderer.on('screenshare-result', (e, result) => {
            const webviewObj = this.getActive();
            webviewObj.executeJavaScript(`
                window.parent.postMessage({
                    sourceId: '${result}'
                }, '*')
            `);
        });
    }

    loaded () {
        document.querySelector('#loading').style.display = 'none';
        document.querySelector('#login-card').style.display = 'block';
        document.querySelector('footer').style.display = 'block';
    }

    loading () {
        document.querySelector('#loading').style.display = 'block';
        document.querySelector('#login-card').style.display = 'none';
        document.querySelector('footer').style.display = 'none';
    }

    add (host) {
        let webviewObj = this.getByUrl(host.url);
        if (webviewObj) {
            return;
        }

        webviewObj = document.createElement('webview');
        webviewObj.setAttribute('server', host.url);
        webviewObj.setAttribute('preload', './preload.js');
        webviewObj.setAttribute('allowpopups', 'on');
        webviewObj.setAttribute('disablewebsecurity', 'on');

        webviewObj.addEventListener('did-navigate-in-page', (lastPath) => {
            if ((lastPath.url).includes(host.url)) {
                this.saveLastPath(host.url, lastPath.url);
            }
        });

        webviewObj.addEventListener('console-message', (e) => {
            console.log('webview:', e.message);
        });

        webviewObj.addEventListener('ipc-message', (event) => {
            this.emit('ipc-message-'+event.channel, host.url, event.args);

            switch (event.channel) {
                case 'title-changed':
                    servers.setHostTitle(host.url, event.args[0]);
                    break;
                case 'unread-changed':
                    sidebar.setBadge(host.url, event.args[0]);
                    break;
                case 'focus':
                    servers.setActive(host.url);
                    break;
                case 'get-sourceId':
                    electron.desktopCapturer.getSources({types: ['window', 'screen']}, (error, sources) => {
                        if (error) {
                            throw error;
                        }

                        sources = sources.map(source => {
                            source.thumbnail = source.thumbnail.toDataURL();
                            return source;
                        });
                        electron.ipcRenderer.send('screenshare', sources);
                    });
                    break;
                case 'reload-server':
                    const active = this.getActive();
                    const server = active.getAttribute('server');
                    this.loading();
                    active.loadURL(server);
                    break;
                case 'sidebar-background':
                    sidebar.changeSidebarColor(event.args[0]);
                    break;
            }
        });

        webviewObj.addEventListener('dom-ready', () => {
            this.emit('dom-ready', host.url);
        });

        webviewObj.addEventListener('did-fail-load', (e) => {
            if (e.isMainFrame) {
                webviewObj.loadURL('file://' + __dirname + '/loading-error.html');
            }
        });

        webviewObj.addEventListener('did-get-response-details', (e) => {
            if (e.resourceType === 'mainFrame' && e.httpResponseCode >= 500) {
                webviewObj.loadURL('file://' + __dirname + '/loading-error.html');
            }
        });

        this.webviewParentElement.appendChild(webviewObj);

        webviewObj.src = host.lastPath || host.url;
    }

    remove (hostUrl) {
        const el = this.getByUrl(hostUrl);
        if (el) {
            el.remove();
        }
    }

    saveLastPath (hostUrl, lastPathUrl) {
        const hosts = servers.hosts;
        hosts[hostUrl].lastPath = lastPathUrl;
        servers.hosts = hosts;
    }

    getByUrl (hostUrl) {
        return this.webviewParentElement.querySelector(`webview[server="${hostUrl}"]`);
    }

    getActive () {
        return document.querySelector('webview.active');
    }

    isActive (hostUrl) {
        return !!this.webviewParentElement.querySelector(`webview.active[server="${hostUrl}"]`);
    }

    deactiveAll () {
        let item;
        while (!(item = this.getActive()) === false) {
            item.classList.remove('active');
        }
        document.querySelector('.landing-page').classList.add('hide');
    }

    showLanding () {
        this.loaded();
        document.querySelector('.landing-page').classList.remove('hide');
    }

    setActive (hostUrl) {
        if (this.isActive(hostUrl)) {
            return;
        }

        this.deactiveAll();
        const item = this.getByUrl(hostUrl);
        if (item) {
            item.classList.add('active');
        }
        this.focusActive();
    }

    focusActive () {
        const active = this.getActive();
        if (active) {
            active.focus();
            return true;
        }
        return false;
    }

    goBack () {
        this.getActive().goBack();
    }

    goForward () {
        this.getActive().goForward();
    }
}

var webview = new WebView();

const APP_NAME$1 = electron.remote.app.getName();
const isMac$1 = process.platform === 'darwin';

const appTemplate = [
    {
        label: i18n.__('About', APP_NAME$1),
        click: function () {
            const win = new electron.remote.BrowserWindow({
                width: 310,
                height: 240,
                resizable: false,
                show: false,
                center: true,
                maximizable: false,
                minimizable: false,
                title: 'Teamware'
            });
            win.loadURL('file://' + __dirname + '/about.html');
            win.setMenuBarVisibility(false);
            win.show();
        }
    },
    {
        type: 'separator',
        id: 'about-sep'
    },
    {
        label: i18n.__('Quit_App', APP_NAME$1),
        accelerator: 'CommandOrControl+Q',
        click: function () {
            electron.remote.app.quit();
        }
    }
];

if (isMac$1) {
    const macAppExtraTemplate = [
        {
            type: 'separator'
        }
    ];
    appTemplate.push(...macAppExtraTemplate);
}

const editTemplate = [
    {
        label: i18n.__('Undo'),
        accelerator: 'CommandOrControl+Z',
        role: 'undo'
    },
    {
        label: i18n.__('Redo'),
        accelerator: 'CommandOrControl+Shift+Z',
        role: 'redo'
    },
    {
        type: 'separator'
    },
    {
        label: i18n.__('Cut'),
        accelerator: 'CommandOrControl+X',
        role: 'cut'
    },
    {
        label: i18n.__('Copy'),
        accelerator: 'CommandOrControl+C',
        role: 'copy'
    },
    {
        label: i18n.__('Paste'),
        accelerator: 'CommandOrControl+V',
        role: 'paste'
    },
    {
        label: i18n.__('Select_All'),
        accelerator: 'CommandOrControl+A',
        role: 'selectall'
    }
];

const { Tray, Menu: Menu$1 } = electron.remote;

const mainWindow = electron.remote.getCurrentWindow();

const icons = {
    win32: {
        dir: 'windows'
    },

    linux: {
        dir: 'linux'
    },

    darwin: {
        dir: 'osx',
        icon: 'icon-trayTemplate.png'
    }
};

const _iconTray = path.join(__dirname, 'images', icons[process.platform].dir, icons[process.platform].icon || 'icon-tray.png');
const _iconTrayAlert = path.join(__dirname, 'images', icons[process.platform].dir, icons[process.platform].iconAlert || 'icon-tray-alert.png');

function createAppTray () {
    const _tray = new Tray(_iconTray);
    mainWindow.tray = _tray;

    const contextMenuShow = Menu$1.buildFromTemplate([{
        label: i18n.__('Show'),
        click () {
            mainWindow.show();
        }
    }, {
        label: i18n.__('Quit'),
        click () {
            electron.remote.app.quit();
        }
    }]);

    const contextMenuHide = Menu$1.buildFromTemplate([{
        label: i18n.__('Hide'),
        click () {
            mainWindow.hide();
        }
    }, {
        label: i18n.__('Quit'),
        click () {
            electron.remote.app.quit();
        }
    }]);

    if (!mainWindow.isMinimized() && !mainWindow.isVisible()) {
        _tray.setContextMenu(contextMenuShow);
    } else {
        _tray.setContextMenu(contextMenuHide);
    }

    const onShow = function () {
        _tray.setContextMenu(contextMenuHide);
    };

    const onHide = function () {
        _tray.setContextMenu(contextMenuShow);
    };

    mainWindow.on('show', onShow);
    mainWindow.on('restore', onShow);

    mainWindow.on('hide', onHide);
    mainWindow.on('minimize', onHide);

    _tray.setToolTip(electron.remote.app.getName());

    _tray.on('right-click', function (e, b) {
        _tray.popUpContextMenu(undefined, b);
    });

    _tray.on('click', () => {
        if (mainWindow.isVisible()) {
            return mainWindow.hide();
        }

        mainWindow.show();
    });

    mainWindow.destroyTray = function () {
        mainWindow.removeListener('show', onShow);
        mainWindow.removeListener('hide', onHide);
        _tray.destroy();
    };
}

function setImage (title) {
    if (title === '•') {
        title = "Dot";
    } else if (!isNaN(parseInt(title)) && title > 9) {
        title = "9Plus";
    }

    const _iconPath = path.join(__dirname, 'images', icons[process.platform].dir, `icon-tray${title}.png`);
    mainWindow.tray.setImage(_iconPath);
}

function showTrayAlert (showAlert, title) {
    if (mainWindow.tray === null || mainWindow.tray === undefined) {
        return;
    }

    mainWindow.flashFrame(showAlert);
    if (process.platform !== 'darwin') {
        setImage(title);
    } else {
        if (showAlert) {
            mainWindow.tray.setImage(_iconTrayAlert);
        } else {
            mainWindow.tray.setImage(_iconTray);
        }
        mainWindow.tray.setTitle(title);
    }

}

function removeAppTray () {
    mainWindow.destroyTray();
}

function toggle () {
    if (localStorage.getItem('hideTray') === 'true') {
        createAppTray();
        localStorage.setItem('hideTray', 'false');
    } else {
        removeAppTray();
        localStorage.setItem('hideTray', 'true');
    }
}

if (localStorage.getItem('hideTray') !== 'true') {
    createAppTray();
}

var tray = {
    showTrayAlert,
    toggle
};

const isMac$2 = process.platform === 'darwin';
const certificate = electron.remote.require('./background').certificate;

const viewTemplate = [
    {
        label: i18n.__('Original_Zoom'),
        accelerator: 'CommandOrControl+0',
        role: 'resetzoom'
    },
    {
        label: i18n.__('Zoom_In'),
        accelerator: 'CommandOrControl+Plus',
        role: 'zoomin'
    },
    {
        label: i18n.__('Zoom_Out'),
        accelerator: 'CommandOrControl+-',
        role: 'zoomout'
    },
    {
        type: 'separator'
    },
    {
        label: i18n.__('Current_Server_Reload'),
        accelerator: 'CommandOrControl+R',
        click: function () {
            const activeWebview = webview.getActive();
            if (activeWebview) {
                activeWebview.reload();
            }
        }
    },
    {
        label: i18n.__('Current_Server_Toggle_DevTools'),
        accelerator: isMac$2 ? 'Command+Alt+I' : 'Ctrl+Shift+I',
        click: function () {
            const activeWebview = webview.getActive();
            if (activeWebview) {
                activeWebview.openDevTools();
            }
        }
    },
    {
        type: 'separator'
    },
    {
        label: i18n.__('Application_Reload'),
        accelerator: 'CommandOrControl+Shift+R',
        click: function () {
            const mainWindow = electron.remote.getCurrentWindow();
            if (mainWindow.destroyTray) {
                mainWindow.destroyTray();
            }
            mainWindow.reload();
        }
    },
    {
        label: i18n.__('Application_Toggle_DevTools'),
        click: function () {
            electron.remote.getCurrentWindow().toggleDevTools();
        }
    },
    {
        type: 'separator',
        id: 'toggle'
    },
    {
        label: i18n.__('Toggle_Server_List'),
        click: function () {
            sidebar.toggle();
        }
    },
    {
        type: 'separator'
    },
    {
        label: i18n.__('Clear'),
        submenu: [
            {
                label: i18n.__('Clear_Trusted_Certificates'),
                click: function () {
                    certificate.clear();
                }
            }
        ]
    }
];

if (isMac$2) {
    viewTemplate.push({
        label: i18n.__('Toggle_Tray_Icon'),
        click: function () {
            tray.toggle();
        },
        position: 'after=toggle'
    });
} else {
    viewTemplate.push({
        label: i18n.__('Toggle_Menu_Bar'),
        click: function () {
            const current = localStorage.getItem('autohideMenu') === 'true';
            electron.remote.getCurrentWindow().setAutoHideMenuBar(!current);
            localStorage.setItem('autohideMenu', JSON.stringify(!current));
        },
        position: 'after=toggle'
    });
}

const isMac$3 = process.platform === 'darwin';

const macWindowTemplate = [
    {
        label: i18n.__('Back'),
        accelerator: 'Command+left',
        click: () => { webview.goBack(); }
    },
    {
        label: i18n.__('Forward'),
        accelerator: 'Command+right',
        click: () => { webview.goForward(); }
    }
];

const windowTemplate = [
    {
        label: i18n.__('Back'),
        accelerator: 'Alt+Left',
        click: () => { webview.goBack(); }
    },
    {
        label: i18n.__('Forward'),
        accelerator: 'Alt+Right',
        click: () => { webview.goForward(); }
    },
];

var historyMenu = isMac$3 ? macWindowTemplate : windowTemplate;

const isMac$4 = process.platform === 'darwin';

const macWindowTemplate$1 = [
    {
        label: i18n.__('Minimize'),
        accelerator: 'Command+M',
        role: 'minimize'
    },
    {
        label: i18n.__('Close'),
        accelerator: 'Command+W',
        role: 'close'
    },
    {
        type: 'separator'
    },
    {
        type: 'separator',
        id: 'server-list-separator',
        visible: false
    },
    {
        label: i18n.__('Add_new_server'),
        accelerator: 'Command+N',
        click: function () {
            const mainWindow = electron.remote.getCurrentWindow();
            mainWindow.show();
            servers.clearActive();
            webview.showLanding();
        }
    }
];

const windowTemplate$1 = [
    {
        type: 'separator',
        id: 'server-list-separator',
        visible: false
    },
    {
        label: i18n.__('Add_new_server'),
        accelerator: 'Ctrl+N',
        click: function () {
            servers.clearActive();
            webview.showLanding();
        }
    },
    {
        type: 'separator'
    },
    {
        label: i18n.__('Close'),
        accelerator: 'Ctrl+W',
        click: function () {
            electron.remote.getCurrentWindow().close();
        }
    }
];

var windowMenu = isMac$4 ? macWindowTemplate$1 : windowTemplate$1;

const APP_NAME$2 = electron.remote.app.getName();

const helpTemplate = [
    {
        label: i18n.__('Help_Name', APP_NAME$2),
        click: () => electron.remote.shell.openExternal('http://icerno.com/support.html')
    },
    {
        type: 'separator'
    },
    {
        label: i18n.__('Learn_More'),
        click: () => electron.remote.shell.openExternal('http://icerno.com/')
    }
];

const Menu = electron.remote.Menu;
const APP_NAME = electron.remote.app.getName();
const isMac = process.platform === 'darwin';

document.title = APP_NAME;

const menuTemplate = [
    {
        label: APP_NAME,
        submenu: appTemplate
    },
    {
        label: i18n.__('Edit'),
        submenu: editTemplate
    },
    {
        label: i18n.__('View'),
        submenu: viewTemplate
    },
    {
        label: i18n.__('History'),
        submenu: historyMenu
    },
    {
        label: i18n.__('Window'),
        id: 'window',
        role: 'window',
        submenu: windowMenu
    },
    {
        label: i18n.__('Help'),
        role: 'help',
        submenu: helpTemplate
    }
];

function createMenu () {
    const menu = Menu.buildFromTemplate(menuTemplate);
    Menu.setApplicationMenu(menu);
}

function addServer (host, position) {
    const index = windowMenu.findIndex((i) => i.id === 'server-list-separator');
    windowMenu[index].visible = true;

    const menuItem = {
        label: host.title,
        accelerator: `CmdOrCtrl+ ${position}`,
        position: 'before=server-list-separator',
        id: host.url,
        click: () => {
            const mainWindow = electron.remote.getCurrentWindow();
            mainWindow.show();
            servers.setActive(host.url);
        }
    };

    windowMenu.push(menuItem);

    createMenu();
}

function removeServer (server) {
    const index = windowMenu.findIndex((i) => i.id === server);
    windowMenu.splice(index, 1);
    createMenu();
}

function autoHideMenu () {
    electron.remote.getCurrentWindow().setAutoHideMenuBar(true);
}

if (!isMac && localStorage.getItem('autohideMenu') === 'true') {
    autoHideMenu();
}

createMenu();

class SideBar extends events.EventEmitter {
    constructor () {
        super();

        this.sortOrder = JSON.parse(localStorage.getItem(this.sortOrderKey)) || [];
        localStorage.setItem(this.sortOrderKey, JSON.stringify(this.sortOrder));

        this.listElement = document.getElementById('serverList');

        Object.values(servers.hosts)
            .sort((a, b) => this.sortOrder.indexOf(a.url) - this.sortOrder.indexOf(b.url))
            .forEach((host) => {
                this.add(host);
            });

        servers.on('host-added', (hostUrl) => {
            this.add(servers.get(hostUrl));
        });

        servers.on('host-removed', (hostUrl) => {
            this.remove(hostUrl);
        });

        servers.on('active-setted', (hostUrl) => {
            this.setActive(hostUrl);
        });

        servers.on('active-cleared', (hostUrl) => {
            this.deactiveAll(hostUrl);
        });

        servers.on('title-setted', (hostUrl, title) => {
            this.setLabel(hostUrl, title);
        });

        webview.on('dom-ready', (hostUrl) => {
            this.setActive(localStorage.getItem(servers.activeKey));
            webview.getActive().send('request-sidebar-color');
            this.setImage(hostUrl);
            if (this.isHidden()) {
                this.hide();
            } else {
                this.show();
            }
        });

    }

    get sortOrderKey () {
        return 'rocket.chat.sortOrder';
    }

    add (host) {
        let name = host.title.replace(/^https?:\/\/(?:www\.)?([^\/]+)(.*)/, '$1');
        name = name.split('.');
        name = name[0][0] + (name[1] ? name[1][0] : '');
        name = name.toUpperCase();

        const initials = document.createElement('span');
        initials.innerHTML = name;

        const tooltip = document.createElement('div');
        tooltip.classList.add('tooltip');
        tooltip.innerHTML = host.title;

        const badge = document.createElement('div');
        badge.classList.add('badge');

        const img = document.createElement('img');
        img.onload = function () {
            img.style.display = 'initial';
            initials.style.display = 'none';
        };

        let hostOrder = 0;
        if (this.sortOrder.includes(host.url)) {
            hostOrder = this.sortOrder.indexOf(host.url) + 1;
        } else {
            hostOrder = this.sortOrder.length + 1;
            this.sortOrder.push(host.url);
        }

        const hotkey = document.createElement('div');
        hotkey.classList.add('name');
        if (process.platform === 'darwin') {
            hotkey.innerHTML = `⌘${hostOrder}`;
        } else {
            hotkey.innerHTML = `^${hostOrder}`;
        }

        const item = document.createElement('li');
        item.appendChild(initials);
        item.appendChild(tooltip);
        item.appendChild(badge);
        item.appendChild(img);
        item.appendChild(hotkey);

        item.dataset.host = host.url;
        item.dataset.sortOrder = hostOrder;
        item.setAttribute('server', host.url);
        item.classList.add('instance');

        item.setAttribute('draggable', true);

        item.ondragstart = (event) => {
            window.dragged = event.target.nodeName !== 'LI' ? event.target.closest('li') : event.target;
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.dropEffect = 'move';
            event.target.style.opacity = .5;
        };

        item.ondragover = (event) => {
            event.preventDefault();
        };

        item.ondragenter = (event) => {
            if (this.isBefore(window.dragged, event.target)) {
                event.currentTarget.parentNode.insertBefore(window.dragged, event.currentTarget);
            } else if (event.currentTarget !== event.currentTarget.parentNode.lastChild) {
                event.currentTarget.parentNode.insertBefore(window.dragged, event.currentTarget.nextSibling);
            } else {
                event.currentTarget.parentNode.appendChild(window.dragged);
            }
        };

        item.ondragend = (event) => {
            event.target.style.opacity = '';
        };

        item.ondrop = (event) => {
            event.preventDefault();

            const newSortOrder = [];
            Array.from(event.currentTarget.parentNode.children)
                .map((sideBarElement) => {
                    const url = sideBarElement.dataset.host;
                    newSortOrder.push(url);
                    this.remove(url);

                    return sideBarElement;
                })
                .map((sideBarElement) => {
                    this.sortOrder = newSortOrder;
                    localStorage.setItem(this.sortOrderKey, JSON.stringify(this.sortOrder));

                    const url = sideBarElement.dataset.host;
                    const host = { url, title: sideBarElement.querySelector('div.tooltip').innerHTML };
                    this.add(host);
                    this.setImage(url);
                });

            this.setActive(window.dragged.dataset.host);
        };

        item.onclick = () => {
            servers.setActive(host.url);
        };

        this.listElement.appendChild(item);
        addServer(host, hostOrder);
    }

    setImage (hostUrl) {
        const img = this.getByUrl(hostUrl).querySelector('img');
        img.src = `${hostUrl}/assets/favicon.svg?v=${Math.round(Math.random()*10000)}`;
    }

    remove (hostUrl) {
        const el = this.getByUrl(hostUrl);
        if (el) {
            el.remove();
            removeServer(hostUrl);
        }
    }

    getByUrl (hostUrl) {
        return this.listElement.querySelector(`.instance[server="${hostUrl}"]`);
    }

    getActive () {
        return this.listElement.querySelector('.instance.active');
    }

    isActive (hostUrl) {
        return !!this.listElement.querySelector(`.instance.active[server="${hostUrl}"]`);
    }

    changeSidebarColor ({color, background}) {
        const sidebar = document.querySelector('.server-list');
        if (sidebar) {
            sidebar.style.background = background;
            sidebar.style.color = color;
        }
    }

    setActive (hostUrl) {
        if (this.isActive(hostUrl)) {
            return;
        }

        this.deactiveAll();
        const item = this.getByUrl(hostUrl);
        if (item) {
            item.classList.add('active');
        }
        webview.getActive().send && webview.getActive().send('request-sidebar-color');
    }

    deactiveAll () {
        let item;
        while (!(item = this.getActive()) === false) {
            item.classList.remove('active');
        }
    }

    setLabel (hostUrl, label) {
        this.listElement.querySelector(`.instance[server="${hostUrl}"] .tooltip`).innerHTML = label;
    }

    setBadge (hostUrl, badge) {
        const item = this.getByUrl(hostUrl);
        const badgeEl = item.querySelector('.badge');

        if (badge !== null && badge !== undefined && badge !== '') {
            item.classList.add('unread');
            if (isNaN(parseInt(badge))) {
                badgeEl.innerHTML = '';
            } else {
                badgeEl.innerHTML = badge;
            }
        } else {
            badge = undefined;
            item.classList.remove('unread');
            badgeEl.innerHTML = '';
        }
        this.emit('badge-setted', hostUrl, badge);
    }

    getGlobalBadge () {
        let count = 0;
        let alert = '';
        const instanceEls = this.listElement.querySelectorAll('li.instance');
        for (let i = instanceEls.length - 1; i >= 0; i--) {
            const instanceEl = instanceEls[i];
            const text = instanceEl.querySelector('.badge').innerHTML;
            if (!isNaN(parseInt(text))) {
                count += parseInt(text);
            }

            if (alert === '' && instanceEl.classList.contains('unread') === true) {
                alert = '•';
            }
        }

        if (count > 0) {
            return String(count);
        } else {
            return alert;
        }
    }

    hide () {
        document.body.classList.add('hide-server-list');
        localStorage.setItem('sidebar-closed', 'true');
        this.emit('hide');
        if (process.platform === 'darwin') {
            document.querySelectorAll('webview').forEach(
                (webviewObj) => { if (webviewObj.insertCSS) { webviewObj.insertCSS('aside.side-nav{margin-top:15px;overflow:hidden; transition: margin .5s ease-in-out; } .sidebar{padding-top:10px;transition: margin .5s ease-in-out;}'); } });
        }
    }

    show () {
        document.body.classList.remove('hide-server-list');
        localStorage.setItem('sidebar-closed', 'false');
        this.emit('show');
        if (process.platform === 'darwin') {
            document.querySelectorAll('webview').forEach(
                (webviewObj) => { if (webviewObj.insertCSS) { webviewObj.insertCSS('aside.side-nav{margin-top:0; overflow:hidden; transition: margin .5s ease-in-out;} .sidebar{padding-top:0;transition: margin .5s ease-in-out;}'); } });
        }
    }

    toggle () {
        if (this.isHidden()) {
            this.show();
        } else {
            this.hide();
        }
    }

    isHidden () {
        return localStorage.getItem('sidebar-closed') === 'true';
    }

    isBefore (a, b) {
        if (a.parentNode === b.parentNode) {
            for (let cur = a; cur; cur = cur.previousSibling) {
                if (cur === b) {
                    return true;
                }
            }
        }
        return false;
    }
}

var sidebar = new SideBar();


let selectedInstance = null;
const instanceMenu = electron.remote.Menu.buildFromTemplate([{
    label: i18n.__('Reload_server'),
    click: function () {
        webview.getByUrl(selectedInstance.dataset.host).reload();
    }
}, {
    label: i18n.__('Remove_server'),
    click: function () {
        servers.removeHost(selectedInstance.dataset.host);
    }
}, {
    label: i18n.__('Open_DevTools'),
    click: function () {
        webview.getByUrl(selectedInstance.dataset.host).openDevTools();
    }
}]);

window.addEventListener('contextmenu', function (e) {
    if (e.target.classList.contains('instance') || e.target.parentNode.classList.contains('instance')) {
        e.preventDefault();
        if (e.target.classList.contains('instance')) {
            selectedInstance = e.target;
        } else {
            selectedInstance = e.target.parentNode;
        }

        instanceMenu.popup(electron.remote.getCurrentWindow());
    }
}, false);

if (process.platform === 'darwin') {
    window.addEventListener('keydown', function (e) {
        if (e.key === 'Meta') {
            document.getElementsByClassName('server-list')[0].classList.add('command-pressed');
        }
    });

    window.addEventListener('keyup', function (e) {
        if (e.key === 'Meta') {
            document.getElementsByClassName('server-list')[0].classList.remove('command-pressed');
        }
    });
} else {
    window.addEventListener('keydown', function (e) {
        if (e.key === 'ctrlKey') {
            document.getElementsByClassName('server-list')[0].classList.add('command-pressed');
        }
    });

    window.addEventListener('keyup', function (e) {
        if (e.key === 'ctrlKey') {
            document.getElementsByClassName('server-list')[0].classList.remove('command-pressed');
        }
    });
}

/* globals $ */

sidebar.on('badge-setted', function () {
    const badge = sidebar.getGlobalBadge();

    if (process.platform === 'darwin') {
        electron.remote.app.dock.setBadge(badge);
    }
    tray.showTrayAlert(!isNaN(parseInt(badge)) && badge > 0, badge);
});

const start = function () {
    const defaultInstance = 'https://cc.nomalis.com';

    // connection check
    function online () {
        document.body.classList.remove('offline');
    }

    function offline () {
        document.body.classList.add('offline');
    }

    if (!navigator.onLine) {
        offline();
    }
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    // end connection check

    const form = document.querySelector('form');
    const hostField = form.querySelector('[name="host"]');
    const button = form.querySelector('[type="submit"]');
    const invalidUrl = form.querySelector('#invalidUrl');

    window.addEventListener('load', function () {
        hostField.focus();
    });

    function validateHost () {
        return new Promise(function (resolve, reject) {
            const execValidation = function () {
                invalidUrl.style.display = 'none';
                hostField.classList.remove('wrong');

                let host = hostField.value.trim();
                host = host.replace(/\/$/, '');
                hostField.value = host;

                if (host.length === 0) {
                    button.value = i18n.__('Connect');
                    button.disabled = false;
                    resolve();
                    return;
                }

                button.value = i18n.__('Validating');
                button.disabled = true;

                servers.validateHost(host, 2000).then(function () {
                    button.value = i18n.__('Connect');
                    button.disabled = false;
                    resolve();
                }, function (status) {
                    // If the url begins with HTTP, mark as invalid
                    if (/^https?:\/\/.+/.test(host) || status === 'basic-auth') {
                        button.value = i18n.__('Invalid_url');
                        invalidUrl.style.display = 'block';
                        switch (status) {
                            case 'basic-auth':
                                invalidUrl.innerHTML = i18n.__('Auth_needed_try', '<b>username:password@host</b>');
                                break;
                            case 'invalid':
                                invalidUrl.innerHTML = i18n.__('No_valid_server_found');
                                break;
                            case 'timeout':
                                invalidUrl.innerHTML = i18n.__('Timeout_trying_to_connect');
                                break;
                        }
                        hostField.classList.add('wrong');
                        reject();
                        return;
                    }

                    // // If the url begins with HTTPS, fallback to HTTP
                    // if (/^https:\/\/.+/.test(host)) {
                    //     hostField.value = host.replace('https://', 'http://');
                    //     return execValidation();
                    // }

                    // If the url isn't localhost, don't have dots and don't have protocol
                    // try as a .rocket.chat subdomain
                    if (!/(^https?:\/\/)|(\.)|(^([^:]+:[^@]+@)?localhost(:\d+)?$)/.test(host)) {
                        hostField.value = `https://${host}.cc.nomalis.com`;
                        return execValidation();
                    }

                    // If the url don't start with protocol try HTTPS
                    if (!/^https?:\/\//.test(host)) {
                        hostField.value = `https://${host}`;
                        return execValidation();
                    }
                });
            };
            execValidation();
        });
    }

    hostField.addEventListener('blur', function () {
        validateHost().then(function () {}, function () {});
    });

    electron.ipcRenderer.on('certificate-reload', function (event, url) {
        hostField.value = url.replace(/\/api\/info$/, '');
        validateHost().then(function () {}, function () {});
    });

    const submit = function () {
        validateHost().then(function () {
            const input = form.querySelector('[name="host"]');
            let url = input.value;

            if (url.length === 0) {
                url = defaultInstance;
            }

            url = servers.addHost(url);
            if (url !== false) {
                sidebar.show();
                servers.setActive(url);
            }

            input.value = '';
        }, function () {});
    };

    hostField.addEventListener('keydown', function (ev) {
        if (ev.which === 13) {
            ev.preventDefault();
            ev.stopPropagation();
            submit();
            return false;
        }
    });

    form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        submit();
        return false;
    });

    $('.add-server').on('click', function () {
        servers.clearActive();
        webview.showLanding();
    });

    servers.restoreActive();
};

window.addEventListener('focus', function () {
    webview.focusActive();
});

const app$1 = electron.remote.app;

Bugsnag.metaData = {
    // platformId: app.process.platform,
    // platformArch: app.process.arch,
    // electronVersion: app.process.versions.electron,
    version: app$1.getVersion()
    // platformVersion: cordova.platformVersion
    // build: appInfo.build
};

Bugsnag.appVersion = app$1.getVersion();

app$1.setAppUserModelId('chat.rocket');

window.$ = window.jQuery = require('./vendor/jquery-3.1.1');
start();

}());
//# sourcemappingURL=app.js.map