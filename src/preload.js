// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
// src/preload.js
const { contextBridge, ipcRenderer, shell } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Function for renderer to call to set up listener for media path
  receiveMediaPath: (callback) => {
    // Listen for the 'update-media-path' message from the main process
    ipcRenderer.on('update-media-path', (_event, path) => callback(path));
  },
  // Function for renderer to request opening a path in the file explorer
  openPath: (path) => {
    shell.openPath(path); // Use shell module for safety
  }
});

console.log('Preload script loaded.');