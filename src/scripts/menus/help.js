import { remote } from 'electron';
import servers from '../servers';
import i18n from '../../i18n/index.js';
const APP_NAME = remote.app.getName();

const helpTemplate = [
    {
        label: i18n.__('Help_Name', APP_NAME),
        click: () => remote.shell.openExternal('http://icerno.com/support.html')
    },
    {
        type: 'separator'
    },
    {
        label: i18n.__('Learn_More'),
        click: () => remote.shell.openExternal('http://icerno.com/')
    }
];

export default helpTemplate;
