import express from 'express';
import { WebSocketServer } from 'ws';
import { spawn } from 'child_process'; 
import dgram from 'dgram'; 
import { fileURLToPath } from 'url'; 
import { dirname, join, basename } from 'path'; 
import fs from 'fs';
import serverState from './state.js';
import cors from 'cors';
import { app as electronApp } from 'electron'; 

const __filename = fileURLToPath(import.meta.url); // to get the whole path of the file
const __dirname = dirname(__filename); // to get the directory name of the file



// Create separate folders for different media types if they don't exist
const createMediaFolders = () => {
    try {
        const userDataPath = electronApp.getPath('userData');
        const uploadsDir = join(userDataPath, 'uploads');
        const photosDir = join(uploadsDir, 'photos');
        const mp4Dir = join(uploadsDir, 'mp4_recordings');

        console.log(`Ensuring media folders exist in: ${uploadsDir}`);

        [uploadsDir, photosDir, mp4Dir].forEach(dir => {
            if (!fs.existsSync(dir)) {
                console.log(`Creating directory: ${dir}`);
                fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
            }
        });

        try {
            const testFile = join(photosDir, '.testwrite');
            fs.writeFileSync(testFile, 'test');
            fs.unlinkSync(testFile);
            console.log(`Write access confirmed for: ${photosDir}`);
        } catch (writeError) {
             console.warn(`Could not confirm write access to ${photosDir}: ${writeError.message}`);
        }

        // --->>> Return the base uploads directory as well <<<---
        return { uploadsDir, photosDir, mp4Dir };
    } catch (error) {
        console.error('Error creating media folders in userData:', error);
        throw error; // Rethrow the error
    }
};

// Initialize folders and get the base path
let photosDir, mp4Dir, uploadsDir; // <-- Add uploadsDir here
try {
    ({ uploadsDir, photosDir, mp4Dir } = createMediaFolders()); // <-- Capture uploadsDir
} catch (error) {
    console.error('Failed to create or verify media folders:', error);
    // If this fails, we probably should exit, but Electron main process handles exit on error now.
    // process.exit(1);
}

// Initialize Express app
const app = express();
const port = 3000; // express port to serve static files
const streamPort = 3001; // websocket port



const corsOptions = {
    //origin: 'https://your-frontend-domain.com', // !!-- IMPORTANT: CHANGE THIS to your frontend domain --!
  // Or for local testing with Vite dev server:
    origin: ['https://live.d1o1.fun'],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    optionsSuccessStatus: 204
  };
  app.use(cors(corsOptions));



// Configure middleware
app.use(express.json()); // parse json bodies in the request
app.use(express.urlencoded({ extended: true })); // parse urlencoded bodies in the request

// Tello drone configuration
const TELLO_IP = '192.168.10.1'; // drone ip address
const TELLO_PORT = 8889; // drone port
const TELLO_VIDEO_PORT = 11111; // drone video port

// Create UDP client for drone commands
const droneClient = dgram.createSocket('udp4');

// Create WebSocket server
const wss = new WebSocketServer({ 
    port: streamPort,
    clientTracking: true
});

// WebSocket server event handlers
wss.on('listening', () => {
    console.log(`WebSocket server is listening on port ${streamPort}`);
});

wss.on('error', (error) => {
    console.error('WebSocket server error:', error.message);
});

wss.on('connection', (ws) => {
    try {
        const clientId = serverState.addClient(ws);
        console.log(`New client ${clientId} connected (Total: ${serverState.websocket.clients.size})`);

        ws.on('close', () => {
            serverState.removeClient(ws);
            console.log(`Client ${clientId} disconnected (Remaining: ${serverState.websocket.clients.size})`);
        });

        ws.on('error', (error) => {
            console.error(`Client ${clientId} error:`, error.message);
            serverState.removeClient(ws);
        });
    } catch (error) {
        console.error('WebSocket connection error:', error.message);
        ws.close(1011, 'Internal Server Error');
    }
});

// Simplified monitoring - check battery, speed and time every 10 seconds
function startDroneMonitoring() {
    if (serverState.drone.monitoringInterval) {
        return;
    }
    
    const interval = setInterval(() => {
        droneClient.send('battery?', 0, 8, TELLO_PORT, TELLO_IP);
        droneClient.send('time?', 0, 5, TELLO_PORT, TELLO_IP);
    }, 10000);

    serverState.setMonitoringInterval(interval);
}

function stopDroneMonitoring() {
    if (serverState.drone.monitoringInterval) {
        clearInterval(serverState.drone.monitoringInterval);
        serverState.setMonitoringInterval(null);
    }
}

// Add SSE endpoint for drone state updates
app.get('/drone-state-stream', (req, res) => { // Each client gets their own 'res' object
    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    // Then flush them immediately to establish the SSE connection
    res.flushHeaders();

    // Send initial state whoever is connected to the SSE endpoint will receive the initial state
    const initialState = serverState.getDroneState();
    res.write(`data: ${JSON.stringify(initialState)}\n\n`); // The double newline (\n\n) is crucial - it marks the end of an SSE message

    // This function is created in the scope where it has access to THIS CLIENT'S 'res' object
    const sendUpdate = (state) => {
        if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify(state)}\n\n`);
        }
    };

    // Store the client's send function
    const clientId = Date.now();
    serverState.addSSEClient(clientId, sendUpdate);

    // Remove client when connection closes
    req.on('close', () => {
        serverState.removeSSEClient(clientId);
    });
});

// Update the message handler to store state
droneClient.on('message', (msg) => {
    try {
        const response = msg.toString().trim();
        
        // Update state based on response
        if (!isNaN(response)) { // is a Number
            serverState.updateDroneState('battery', parseInt(response));
        } else if (response.includes('cm/s')) {
            serverState.updateDroneState('speed', response);
        } else if (response.includes('s')) {
            serverState.updateDroneState('time', response);
        }
        
        // Send update to all SSE clients
        const state = serverState.getDroneState();
        serverState.broadcastSSEUpdate(state);
        
        console.log('Drone response:', response);
    } catch (error) {
        console.error('Error processing drone response:', error);
    }
});


// Add route for drone commands
app.get('/drone/:command', async (req, res) => {
    try {
        const command = req.params.command;
        
        if (command === 'command') {
            try {
                droneClient.send('command', 0, 7, TELLO_PORT, TELLO_IP, (err) => {
                    if (err) throw err;
                    droneClient.once('message', (msg) => {
                        const response = msg.toString().trim();
                        startDroneMonitoring();
                        res.json({ status: response === 'ok' ? 'connected' : 'failed', response });
                    });
                });
            } catch (error) {
                res.json({ status: 'failed', response: error.message });
            }
        } else if (command === 'streamon') {
            droneClient.send(command, 0, command.length, TELLO_PORT, TELLO_IP, (err) => {
                if (err) { // if there is an error sending the command
                    return res.status(500).json({ error: err.message });
                }
                
                try {
                    droneClient.once('message', (msg) => {
                        const response = msg.toString().trim();
                        if (response === 'ok') {
                            // Start FFmpeg if not already running
                            if (!serverState.getVideoStreamProcess()) {
                                startFFmpeg();
                            }
                            serverState.setLastCommand(command);
                            serverState.setVideoStreamActive(true);
                            res.json({ status: 'ok', response });
                        }
                    });
                } catch (error) {
                    return res.status(500).json({ error: 'Error starting video stream' });
                }
            });
        } else if (command === 'streamoff') {
            droneClient.send(command, 0, command.length, TELLO_PORT, TELLO_IP, (err) => {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }
                droneClient.once('message', (msg) => {
                    const response = msg.toString().trim();
                    serverState.setLastCommand(command);
                    res.json({ status: 'ok', response });
                });
            });
        } else {
            // Send other commands normally
            droneClient.send(command, 0, command.length, TELLO_PORT, TELLO_IP, (err) => {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }
                droneClient.once('message', (msg) => {
                    const response = msg.toString().trim();
                    serverState.setLastCommand(command);
                    res.json({ status: 'ok', response });
                });
            });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add shutdown endpoint
app.post('/drone/shutdown', async (req, res) => {
    try {
        console.log('Shutdown requested via ESC key');
        // Send response before initiating shutdown
        res.json({ status: 'ok', message: 'Shutdown initiated' });
        // Initiate graceful shutdown
        await gracefulShutdown();
    } catch (error) {
        console.error('Shutdown error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Start FFmpeg process for video streaming
function startFFmpeg() {
    console.log('Starting FFmpeg process...');
    
    // Only start if no existing process
    if (serverState.getVideoStreamProcess()) {
        console.log('FFmpeg process already running');
        return;
    }

    const ffmpeg = spawn('ffmpeg', [
        '-hide_banner',           // Hide FFmpeg compilation info
        '-loglevel', 'error',     // Only show errors in logs
        '-y',                     // Force overwrite output files

        // Input configuration
        '-fflags', '+genpts',     // Generate presentation timestamps
        '-i', `udp://0.0.0.0:${TELLO_VIDEO_PORT}?overrun_nonfatal=1&fifo_size=50000000`,

        // First output: MPEG1 video for JSMpeg streaming
        '-map', '0:v:0',         // Map video stream
        '-c:v', 'mpeg1video',    // Use MPEG1 video codec (works well with JSMpeg)
        '-b:v', '2000k',         // Increased base bitrate to 2 Mbps
        '-maxrate', '4000k',     // Increased max bitrate to 4 Mbps
        '-bufsize', '8000k',     // Doubled buffer size relative to maxrate
        '-minrate', '1000k',     // Added minimum bitrate constraint
        '-an',                   // Remove audio (drone has no audio)
        '-f', 'mpegts',          // Output format: MPEG transport stream
        '-s', '640x480',         // Video size: 640x480 pixels
        '-r', '30',              // Frame rate: 30 fps
        '-q:v', '5',             // Video quality (1-31, lower is better)
        '-tune', 'zerolatency',  // Optimize for low latency
        '-preset', 'ultrafast',  // Fastest encoding speed
        '-pix_fmt', 'yuv420p',   // Pixel format: YUV420
        '-flush_packets', '1',    // Flush packets immediately
        '-reset_timestamps', '1', // Reset timestamps at the start
        'pipe:1',                // Output to stdout for streaming

        // Second output: JPEG frames for photo capture
        '-map', '0:v:0',         // Map video stream again
        '-c:v', 'mjpeg',         // JPEG codec for stills
        '-q:v', '2',             // High quality for stills
        '-vf', 'fps=2',          // 2 frames per second is enough for stills
        '-update', '1',          // Update the same file and continuosly overwrite it instead of creating new files
        '-f', 'image2',          // Output format for stills
        join(photosDir, 'current_frame.jpg') // make the current frame always avilable in photosdirectory
    ]);

    serverState.setVideoStreamProcess(ffmpeg);

    // Enhanced error logging
    ffmpeg.stderr.on('data', (data) => {
        const message = data.toString().trim();
        if (message && !message.includes('Last message repeated')) {
            // Filter out common non-error messages
            if (!message.includes('already exists') && 
                !message.includes('Overwrite?')) {
                console.error('FFmpeg error:', message);
            }
        }
    });

    // Handle process errors and exit
    ffmpeg.on('error', (error) => {
        console.error('FFmpeg process error:', error.message);
        if (serverState.getVideoStreamProcess() === ffmpeg) {
            serverState.setVideoStreamProcess(null);
            if (serverState.getLastCommand() === 'streamon') {
                console.log('Attempting FFmpeg restart...');
                setTimeout(startFFmpeg, 1000);
            }
        }
    });

    ffmpeg.on('exit', (code, signal) => {
        if (code !== 0) {
            console.error(`FFmpeg process exited with code ${code}, signal: ${signal}`);
        }
        if (serverState.getVideoStreamProcess() === ffmpeg) {
            serverState.setVideoStreamProcess(null);
            if (serverState.getLastCommand() === 'streamon') {
                console.log('FFmpeg process exited, attempting restart...');
                setTimeout(startFFmpeg, 1000);
            }
        }
    });

    // Stream video data directly to WebSocket clients
    // Nodejs transmits this data into chunks with the on('data') event and its standard output stream API
    ffmpeg.stdout.on('data', (chunk) => {
        if (!serverState.isVideoStreamActive()) return;

        // Send to all connected WebSocket clients
        serverState.getConnectedClients().forEach((client) => {
            try {
                client.send(chunk, { binary: true }); // websocket can only transmit data in either string format or binary format
            } catch (err) {
                console.error(`Failed to send to client: ${err}`);
                serverState.removeClient(client);
            }
        });
        
        // Send to MP4 recording if active
        if (serverState.getVideoRecordingActive() && 
            serverState.getVideoRecordingProcess()?.stdin.writable) { // check if the process is writable
            try {
                serverState.getVideoRecordingProcess().stdin.write(chunk); // write the chunk to the process
            } catch (error) {
                console.error('Failed to write to MP4 stream:', error);
                serverState.getVideoRecordingProcess().stdin.end(); // end the process

                // Clean up the process
                serverState.setVideoRecordingProcess(null);
                serverState.setVideoRecordingActive(false);
                serverState.setVideoRecordingFilePath(null);
            }
        }
    });

    return ffmpeg;
}

// Modify photo capture endpoint
app.post('/capture-photo', async (req, res) => {
    if (!serverState.isVideoStreamActive()) {
        return res.status(400).send('Video stream not active');
    }

    try {
        const timestamp = Date.now();
        const finalPhotoPath = join(photosDir, `photo_${timestamp}.jpg`);
        const currentFramePath = join(photosDir, 'current_frame.jpg');

        await fs.promises.copyFile(currentFramePath, finalPhotoPath);
        
        res.json({ 
            fileName: `photo_${timestamp}.jpg`,
            timestamp: timestamp
        });
    } catch (error) {
        console.error('Failed to capture photo:', error);
        res.status(500).send('Failed to capture photo');
    }
});

// Function to initialize MP4 process
function initializeMP4Process() {
    console.log('Starting MP4 process...');
    
    if (serverState.getVideoRecordingProcess()) {
        console.log('MP4 process already running');
        return;
    }

    const timestamp = Date.now();
    const mp4FileName = `video_${timestamp}.mp4`;
    const mp4FilePath = join(mp4Dir, mp4FileName);
    
    try {
        const Mp4Process = spawn('ffmpeg', [
            '-i', 'pipe:0',           // Input from pipe
            '-c:v', 'libx264',        // Convert to H.264
            '-preset', 'ultrafast',    // Fastest encoding
            '-tune', 'zerolatency',    // Minimize latency
            '-crf', '23',             // Balance quality/size
            '-movflags', '+faststart', // Enable streaming
            '-y',                      // Overwrite output
            mp4FilePath
        ]);

        serverState.setVideoRecordingProcess(Mp4Process);
        serverState.setVideoRecordingFilePath(mp4FilePath);

        Mp4Process.stderr.on('data', (data) => {
            const message = data.toString().trim();
            if (message.toLowerCase().includes('error') || 
                message.toLowerCase().includes('failed')) {
                console.error('MP4 FFmpeg:', message);
            }
        });

        // Handle process errors and exit
        Mp4Process.on('error', (err) => {
            console.error('MP4 process error:', err.message);
            serverState.setVideoRecordingProcess(null);
            serverState.setVideoRecordingActive(false);
            serverState.setVideoRecordingFilePath(null);
        });

        Mp4Process.on('exit', (code, signal) => {
            if (code !== 0) {
                const error = `MP4 process exited with code ${code}, signal: ${signal}`;
                console.error(error);
            }
            serverState.setVideoRecordingProcess(null);
            serverState.setVideoRecordingActive(false);
            serverState.setVideoRecordingFilePath(null);
        });

    } catch (error) {
        console.error('Failed to initialize MP4 process:', error.message);
        serverState.setVideoRecordingProcess(null);
        serverState.setVideoRecordingActive(false);
        serverState.setVideoRecordingFilePath(null);
    }
}

// Add route for saving video chunks
app.post('/start-recording', (req, res) => {
    if (serverState.getVideoRecordingActive()) {
        return res.status(400).json({ error: 'Recording already in progress' });
    }

    try {
        if (!serverState.getVideoRecordingProcess()) {
            initializeMP4Process();
        }

        if (!serverState.getVideoRecordingProcess()?.stdin.writable) {
            return res.status(500).json({ error: 'Failed to initialize MP4 process' });
        }

        serverState.setVideoRecordingActive(true);
        res.json({ status: 'ok', message: 'Recording started successfully' });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/stop-recording', (req, res) => {
    if (!serverState.getVideoRecordingActive()) {
        return res.status(400).json({ error: 'No active recording' });
    }

    try {
        // Get the whole file path
        const filePath = serverState.getVideoRecordingFilePath();
        // from file path extract the last name with basename
        const fileName = filePath ? basename(filePath) : null;

        if (serverState.getVideoRecordingProcess()) {
            serverState.getVideoRecordingProcess().stdin.end();
            serverState.getVideoRecordingProcess().kill();
            serverState.setVideoRecordingProcess(null);
        }

        serverState.setVideoRecordingActive(false);
        serverState.setVideoRecordingFilePath(null);
        
        res.json({ 
            status: 'ok', 
            message: 'Recording stopped',
            fileName: fileName
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Ensure this function handles closing droneClient, wss, and state cleanup
const gracefulShutdown = async () => {
    console.log('Starting graceful shutdown (server.js)...');

    stopDroneMonitoring();

    // Close WebSocket Server
    console.log('Closing WebSocket server...');
    await new Promise(resolve => wss.close(resolve));
    console.log('WebSocket server closed.');

    // Send emergency stop to drone if connected
    if (serverState.drone.connected) { // Check connection status from state
        console.log('Sending emergency stop to drone...');
        try {
            await new Promise((resolve, reject) => {
                // Add a timeout in case the drone doesn't respond
                const timeoutId = setTimeout(() => reject(new Error('Emergency command timeout')), 2000);
                droneClient.send('emergency', 0, 'emergency'.length, TELLO_PORT, TELLO_IP, (err) => {
                    clearTimeout(timeoutId);
                    if (err) {
                        console.error('Error sending emergency command:', err.message);
                        reject(err); // Reject promise on error
                    } else {
                        console.log('Emergency command sent.');
                        resolve(); // Resolve on success
                    }
                });
            });
        } catch (err) {
            console.error('Failed to send emergency command:', err.message);
            // Continue shutdown even if emergency fails
        }
    }

    // Close UDP Client
    console.log('Closing UDP drone client...');
    try {
       // UDP close is synchronous AFAIK, but let's be safe
       await new Promise(resolve => {
          droneClient.close(() => {
             console.log('UDP client closed.');
             resolve();
          });
       });
    } catch(err) {
        console.error('Error closing UDP client:', err);
    }


    // Clean up all server state (kills FFmpeg processes, clears intervals, etc.)
    console.log('Cleaning up server state...');
    serverState.cleanup();

    console.log('Graceful shutdown (server.js) completed.');
    // No process.exit(0) here - let the main Electron process handle exiting
};

// Handle different termination signals
// SIGINT: Interrupt from keyboard
// SIGTERM: Termination signal from OS
// SIGQUIT: Quit signal from keyboard
['SIGINT', 'SIGTERM', 'SIGQUIT'].forEach(signal => {
    process.on(signal, gracefulShutdown);
});

// Serve static files
// app.use(express.static(join(__dirname, 'dist')));

// Start servers sequentially
const startServers = () => {
    app.listen(port, () => {
        console.log(`Express server running on http://localhost:${port}`);
        
        // if the websocket server is not open, wait for it to open and then log that both servers are running
        if (wss.readyState !== wss.OPEN) {
            wss.once('listening', () => {
                console.log('Both servers Express and WebSocket are running');
            });
        } else {
            console.log('Both servers Express and WebSocket are running');
        }
    });
    // Return the path for the main process to use
    return { uploadsDir }; // Return the path
};

//startServers(); 

// --- EXPORTS ---
export { startServers, gracefulShutdown, uploadsDir }; // Export necessary 