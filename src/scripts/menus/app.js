import { remote } from 'electron';
import i18n from '../../i18n/index.js';

const APP_NAME = remote.app.getName();
const isMac = process.platform === 'darwin';

const appTemplate = [
    {
        label: i18n.__('About', APP_NAME),
        click: function () {
            const win = new remote.BrowserWindow({
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
        label: i18n.__('Quit_App', APP_NAME),
        accelerator: 'CommandOrControl+Q',
        click: function () {
            remote.app.quit();
        }
    }
];

if (isMac) {
    const macAppExtraTemplate = [
        {
            type: 'separator'
        }
    ];
    appTemplate.push(...macAppExtraTemplate);
}

export default appTemplate;
