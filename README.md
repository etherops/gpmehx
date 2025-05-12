# GPX Editor

A simple Vue 3 application for editing GPX files to mark sections of a bike ride as "paused" for Strava.

## Features

- Load GPX files from your computer
- Use the provided sample GPX file
- View the segments/points on an interactive map
- Select trackpoints to mark as "paused" (this will delete the points which is how strava "pauses")
- Export edited GPX files with custom filename and location using system file picker
- Automatic time adjustment for paused sections to maintain proper ride timing
- Export the edited GPX file for upload to Strava

## Installation

1. Clone this repository
2. Install dependencies:

```bash
npm install
```

3. Run the development server:

```bash
npm run dev
```

4. Open your browser and navigate to the URL shown in the terminal (usually http://localhost:5173)

## How to Use

1. **Load a GPX File**:
   - Click "Choose File" to upload a GPX file from your computer
   - Or click "Load Sample File" to use the provided sample

2. **Select Trackpoints to Pause**:
   - Click on trackpoints in the list on the right or on the map
   - Selected points will be highlighted in yellow
   - Use Area Selection to select multiple points at once:
     - Click "Area Selection" button
     - Draw a rectangle on the map by clicking and dragging
     - All points within the rectangle will be selected
     - Click "Exit Area Selection" to return to normal mode

3. **Mark Selected Points as Paused**:
   - Click "Mark Selected as Paused" to toggle the pause state of selected points
   - Paused points will be shown in red

4. **Export the Edited File**:
   - Click "Export GPX" to download the edited file
   - The exported file will have all paused points removed
   - Strava will recognize the gaps between points as pauses in your activity

5. **Upload to Strava**:
   - Upload the exported GPX file to Strava
   - Strava will recognize the time gaps as pauses and calculate your activity metrics accordingly
   - Strava may still give you PRs/etc for the removed/paused segment and you may have to delete those yourself. 

## How It Works

When you mark trackpoints as "paused", the application:
1. Removes all paused points from the exported GPX file
2. Creates a clean GPX file with the remaining points

This approach creates a GPX file that Strava will interpret as having paused recording during the marked sections. When Strava sees a significant time gap between consecutive points, it recognizes this as a pause in the activity.
