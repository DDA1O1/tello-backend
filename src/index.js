// main.js / src/main.js
import { app, BrowserWindow, dialog } from 'electron'; // <-- Add dialog
import path from 'path';
import { spawn } from 'child_process'; // <-- Add spawn

// --->>> Import your server starter function <<<---
// Adjust the path if you placed server.js elsewhere (e.g., '../server.js')
import { startServers } from '../server.js'; // Or wherever server.js is relative to main.js


// --- FFmpeg Check Function ---
function checkFFmpeg(callback) {
  const ffmpegCheck = spawn('ffmpeg', ['-version']);
  let hasError = false;
  let output = '';

  ffmpegCheck.stdout.on('data', (data) => {
    output += data.toString();
  });

  ffmpegCheck.stderr.on('data', (data) => {
    output += data.toString();
  });

  ffmpegCheck.on('error', (err) => {
    console.error("FFmpeg spawn error:", err.message);
    hasError = true;
    // Don't call callback here, wait for exit
  });

  ffmpegCheck.on('close', (code) => { // Use 'close' instead of 'exit' to ensure streams are flushed
    if (hasError || code !== 0) {
        console.error("FFmpeg check failed. Code:", code, "Output:", output);
        callback(false); // FFmpeg not found, not executable, or exited with error
    } else {
        console.log("FFmpeg check successful.");
        callback(true); // FFmpeg found
    }
  });
}
// --- End FFmpeg Check ---


// --- Window Creation (Optional - You might remove this) ---
const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      // preload: path.join(__dirname, 'preload.js'), // Keep if you need preload
      nodeIntegration: false, // Best practice: Keep false
      contextIsolation: true, // Best practice: Keep true
    },
  });

  // Load index.html - you might load a simple status page or nothing
  // mainWindow.loadFile(path.join(__dirname, '../index.html')); // Adjust path if needed

  // Open the DevTools (optional)
  // mainWindow.webContents.openDevTools();

  return mainWindow; // Return window if you use it later
};
// --- End Window Creation ---


// This method will be called when Electron has finished initialization
// and is ready to create browser windows.
app.whenReady().then(() => {
  console.log('Electron app ready.');

  // --- Check for FFmpeg BEFORE starting the server ---
  checkFFmpeg(isAvailable => {
    if (!isAvailable) {
      dialog.showErrorBox(
        'FFmpeg Error',
        'FFmpeg could not be found or is not working correctly.\n\nPlease install FFmpeg and ensure it is added to your system\'s PATH environment variable.\n\nThe application will now close.'
      );
      app.quit(); // Close the app if FFmpeg is missing
    } else {
      // FFmpeg found, proceed to start the server
      console.log('FFmpeg found. Starting backend servers...');
      try {
        startServers(); // --->>> Call your server startup logic <<<---
        console.log('Backend servers initiated.');

        // createWindow(); // <-- Call this ONLY if you want a visible window

        // Optional: Show a notification that the server is running
        // (Requires 'notification' module from Electron)
        // new Notification({ title: 'Tello Backend', body: 'Server is running.' }).show();

      } catch (error) {
        console.error('Failed to start backend servers:', error);
        dialog.showErrorBox(
          'Server Startup Error',
          `Failed to start backend servers: ${error.message}\n\nPlease check the console logs.\n\nThe application will now close.`
        );
        app.quit();
      }
    }
  });


  app.on('activate', () => {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    // Remove this if you don't have/want a window
    // if (BrowserWindow.getAllWindows().length === 0) {
    //   createWindow();
    // }
  });
});


// Quit when all windows are closed, except on macOS.
// If you have NO window, you might want to change this
// or provide a Tray icon to quit the app.
app.on('window-all-closed', () => {
  // If you have no window, the app would quit immediately.
  // You might want it to stay running in the background.
  // To keep it running, comment out the app.quit() line.
  // You'll need another way to quit (e.g., Tray icon).
  if (process.platform !== 'darwin') {
     // app.quit(); // <-- Comment this out to keep running without windows
     console.log("Main window closed, but app continues running in background.");
     console.log("Use Task Manager or Activity Monitor to quit, or implement a Tray icon.");
  }
});

// Optional: Add graceful shutdown for the Electron app itself
app.on('before-quit', async (event) => {
    console.log('Electron before-quit event triggered.');
    // If your server.js has a gracefulShutdown function, call it here
    // Example: assuming gracefulShutdown is exported from server.js
    // event.preventDefault(); // Prevent immediate quitting
    // import { gracefulShutdown } from './server.js'; // Make sure it's exported
    // await gracefulShutdown(); // Wait for it to finish
    // app.quit(); // Quit now
});

// In this file, you can also include capabilities like
// creating a Tray icon menu for status and quitting the app.