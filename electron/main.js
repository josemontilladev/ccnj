/* Ventana principal de la aplicación de escritorio (Electron)
   Sistema de Membresía — Confraternidad Cristiana Nueva Jerusalén */

const { app, BrowserWindow } = require('electron');
const path = require('path');

function crearVentana() {
  const win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 900,
    minHeight: 600,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    autoHideMenuBar: true,
    title: 'Membresía CFNJ',
    webPreferences: { contextIsolation: true }
  });
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
}

app.whenReady().then(crearVentana);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) crearVentana();
});
