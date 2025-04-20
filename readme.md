# Tello Backend

A desktop application built with Electron and Node.js that provides a backend interface for controlling DJI Tello drones. This application handles drone communication, video streaming, and media storage.

## Features

- 🚁 Drone Control: Send commands to DJI Tello drone via UDP
- 📹 Video Streaming: Real-time video streaming from the drone
- 📸 Media Management: Store photos and video recordings
- 🔄 Real-time State Updates: Monitor drone battery, speed, and flight time
- 🌐 WebSocket Support: Stream video to multiple clients
- 📡 SSE (Server-Sent Events): Real-time drone state updates to clients

## Prerequisites

- [Node.js](https://nodejs.org/) (Latest LTS version recommended)
- [FFmpeg](https://ffmpeg.org/) installed and added to system PATH
- DJI Tello drone

## Installation

1. Clone the repository
2. Install dependencies:
```bash
npm install
```

## Usage

Start the application:
```bash
npm start
```

The application will:
1. Check for FFmpeg installation
2. Start the backend servers
3. Open the Electron window interface

### Ports Used
- Express Server: 3000 (Static file serving)
- WebSocket Server: 3001 (Video streaming)

### Drone Communication
- IP Address: 192.168.10.1
- Command Port: 8889
- Video Port: 11111

## Project Structure

- `src/` - Main Electron application files
  - `index.js` - Main process file
  - `index.html` - Application UI
  - `preload.js` - Preload script for secure IPC
  - `renderer.js` - Renderer process code
  - `index.css` - Application styles
- `server.js` - Backend server implementation
- `state.js` - Application state management
- Media storage locations are automatically created in the user's app data directory:
  - Photos: `userData/uploads/photos`
  - Video Recordings: `userData/uploads/mp4_recordings`

## Features in Detail

### Drone State Management
- Real-time monitoring of:
  - Battery level
  - Flight speed
  - Flight time
- State updates broadcast via SSE to all connected clients

### Video Capabilities
- Real-time video streaming via WebSocket
- Video recording to MP4 format
- Photo capture
- Automatic media file organization

### Client Communication
- WebSocket server for video streaming
- SSE endpoints for state updates
- Express server for static file serving and command endpoints

## Security Features

- Context isolation enabled
- Node integration disabled
- Secure IPC communication via preload scripts
- CORS protection for API endpoints

## Error Handling

- Graceful shutdown management
- FFmpeg availability checking
- Comprehensive error logging
- Automatic cleanup of resources

## Development

### Scripts
- `npm start` - Start the application
- `npm run package` - Package the application
- `npm run make` - Make platform-specific distributables
- `npm run publish` - Publish the application

### Dependencies
- `electron` - Desktop application framework
- `express` - Web server framework
- `ws` - WebSocket server
- `cors` - CORS middleware

## License

MIT License

## Author

Debashish (debashishdash03412@gmail.com)