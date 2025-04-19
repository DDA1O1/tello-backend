// main.js / src/main.js
import { app, BrowserWindow, dialog} from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process'; 
import started from 'electron-squirrel-startup';


import { startServers, gracefulShutdown, uploadsDir as mediaUploadsPath } from '../server.js'; // Adjust path if needed server.js is relative to main.js


if (started) {
  app.quit();
}


// --- Determine __dirname for ES Modules ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


// Keep a global reference to the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow;


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


// --- Window Creation --- (MODIFIED) ---
const createWindow = () => {
  // Create the browser window.
  mainWindow = new BrowserWindow({ // Assign to global mainWindow
    width: 650, // Adjusted size for simple info
    height: 550, // Adjusted size
    webPreferences: {
      // --->>> Point to the preload script <<<---
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, // Keep false for security
      contextIsolation: true, // Keep true for security
    },
  });

  // --->>> Load index.html <<<---
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // --->>> Send media path AFTER window is ready <<<---
  mainWindow.webContents.once('did-finish-load', () => {
    if (mainWindow && mediaUploadsPath) { // Ensure window exists and path was resolved
        console.log(`Sending media path to renderer: ${mediaUploadsPath}`);
        mainWindow.webContents.send('update-media-path', mediaUploadsPath);
    } else {
        console.error("Could not send media path - window or path missing.");
    }
  });


  // Optional: Open the DevTools.
  // mainWindow.webContents.openDevTools();

  // Emitted when the window is closed.
  mainWindow.on('closed', () => {
    // Dereference the window object
    mainWindow = null;
  });
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

        createWindow(); // <-- Call this ONLY if you want a visible window

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
    if (BrowserWindow.getAllWindows().length === 0) {
      // Check FFmpeg again if needed, or just create window if server is assumed running
      if (mainWindow === null) {
         console.log('Re-creating main window on activate.');
         createWindow();
      }
    }
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
    console.log('All windows closed. Quitting app.');

     app.quit(); // <-- Comment this out to keep running without windows
     
  } else {
    console.log('All windows closed, but app remains active on macOS.');
 }
});

// --- Graceful Shutdown Integration ---
app.on('before-quit', async (event) => {
  console.log('Electron before-quit event triggered.');
  event.preventDefault(); // Prevent immediate quitting

  try {
      console.log('Calling gracefulShutdown from server.js...');
      await gracefulShutdown(); // Wait for server cleanup
      console.log('Graceful shutdown completed. Exiting Electron app.');
  } catch (error) {
      console.error('Error during graceful shutdown:', error);
      // Log error but proceed to quit anyway
  } finally {
      app.exit(); // Exit the app explicitly after cleanup attempt
  }
});

// In this file, you can also include capabilities like
// creating a Tray icon menu for status and quitting the app.