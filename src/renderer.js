// Receive the media path from the main process via preload script
window.electronAPI.receiveMediaPath((path) => {
    const mediaPathElement = document.getElementById('media-path');
    if (mediaPathElement) {
        mediaPathElement.textContent = path;
    }
    const openFolderLink = document.getElementById('open-folder-link');
    if (openFolderLink) {
        openFolderLink.onclick = (e) => {
            e.preventDefault();
            window.electronAPI.openPath(path); // Ask main process to open the folder
        };
    }
});